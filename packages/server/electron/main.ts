import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import fs from 'fs'
import Database from 'better-sqlite3'
import os from 'os'
import dgram from 'dgram'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null

// Initialize SQLite Database
let db: any = null;
const dbPath = path.join(app.getPath('userData'), 'netcafe.db')

function setupDatabase() {
  db = new Database(dbPath)
  const tableCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='machines'").get();
  if (tableCheck.count === 0) {
    // Create schema
    db.exec(`
      CREATE TABLE machines (id INTEGER PRIMARY KEY, name TEXT, mac_address TEXT UNIQUE, ip_address TEXT, status TEXT, notes TEXT);
      CREATE TABLE sessions (id INTEGER PRIMARY KEY, machine_id INTEGER, customer_name TEXT, plan_id INTEGER, start_time DATETIME, end_time DATETIME, paused_duration INTEGER, total_amount REAL, payment_method TEXT, mode TEXT, status TEXT);
      CREATE TABLE plans (id INTEGER PRIMARY KEY, name TEXT, rate_type TEXT, price REAL, duration_minutes INTEGER);
      CREATE TABLE block_rules (id INTEGER PRIMARY KEY, type TEXT, value TEXT, mode TEXT, is_active BOOLEAN);
      CREATE TABLE staff (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT);
    `)
    // Seed plans and staff
    db.exec(`
      INSERT INTO plans (name, rate_type, price, duration_minutes) VALUES ('1 Hour', 'fixed', 5.00, 60);
      INSERT INTO plans (name, rate_type, price, duration_minutes) VALUES ('2 Hours', 'fixed', 9.00, 120);
      INSERT INTO staff (username, password_hash, role) VALUES ('admin', 'admin', 'admin');
    `)
  }
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('lab_name', 'NetCafe Manager');")
  // Users (customer accounts) table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      phone TEXT,
      email TEXT,
      balance_minutes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN custom_duration INTEGER;")
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN discount REAL DEFAULT 0;")
  } catch {}
}

// TCP Server & Metrics Maps
const tcpServer = net.createServer()
const clients = new Map<net.Socket, number>() // socket -> machine.id
const clientMetrics = new Map<number, { cpu: number, ram: number, activeWindow: string, os: string, ip: string, uptime: number }>()
const pendingScreenshots = new Map<number, { resolve: (val: string) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>()

function broadcastBlockRulesToClients() {
  if (!db) return
  const rules = db.prepare("SELECT * FROM block_rules WHERE is_active = 1").all()
  const payload = JSON.stringify({ command: 'update-blockrules', rules })
  for (const [socket] of clients.entries()) {
    try {
      socket.write(payload + '\n')
    } catch {}
  }
}

function handleClientMessage(socket: net.Socket, data: any) {
  if (data.type === 'register') {
    const payload = data.payload
    let machine = db.prepare("SELECT * FROM machines WHERE mac_address = ?").get(payload.mac_address)
    if (!machine) {
      const stmt = db.prepare("INSERT INTO machines (name, mac_address, ip_address, status) VALUES (?, ?, ?, ?)")
      const info = stmt.run(payload.name || 'New PC', payload.mac_address, payload.ip_address, 'available')
      machine = { id: info.lastInsertRowid }
    } else {
      db.prepare("UPDATE machines SET ip_address = ?, status = ? WHERE id = ?").run(payload.ip_address, 'available', machine.id)
    }
    clients.set(socket, machine.id)

    // Send current active block rules to this client
    const rules = db.prepare("SELECT * FROM block_rules WHERE is_active = 1").all()
    socket.write(JSON.stringify({ command: 'update-blockrules', rules }) + '\n')

    broadcastMachines()
  }
  else if (data.type === 'metrics') {
    const machineId = clients.get(socket)
    if (machineId) {
      clientMetrics.set(machineId, {
        cpu: data.payload.cpu || 0,
        ram: data.payload.ram || 0,
        activeWindow: data.payload.activeWindow || '',
        os: data.payload.os || 'Windows',
        ip: data.payload.ip || socket.remoteAddress || '',
        uptime: data.payload.uptime || 0
      })
      broadcastMachines()
    }
  }
  else if (data.type === 'screenshot-response') {
    const machineId = clients.get(socket)
    if (machineId) {
      const pending = pendingScreenshots.get(machineId)
      if (pending) {
        clearTimeout(pending.timeout)
        pending.resolve(data.payload)
        pendingScreenshots.delete(machineId)
      }
    }
  }
  else if (data.type === 'user-login') {
    const machineId = clients.get(socket)
    if (machineId && db) {
      const { username, password } = data.payload || {}
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password)
      if (!user) {
        socket.write(JSON.stringify({ command: 'login-fail', message: 'Invalid username or password.' }) + '\n')
      } else if ((user.balance_minutes || 0) <= 0) {
        socket.write(JSON.stringify({ command: 'login-fail', message: 'No balance remaining. Please top up at the front desk.' }) + '\n')
      } else {
        // Close any existing open session for this machine
        db.prepare(`UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE machine_id = ? AND end_time IS NULL`).run(machineId)
        // Open a new prepaid session using the user's full balance
        db.prepare(`
          INSERT INTO sessions (machine_id, customer_name, plan_id, start_time, mode, status, custom_duration)
          VALUES (?, ?, NULL, datetime('now'), 'prepaid', 'active', ?)
        `).run(machineId, user.display_name || user.username, user.balance_minutes)
        db.prepare("UPDATE machines SET status = 'in_use' WHERE id = ?").run(machineId)
        // Deduct balance
        db.prepare('UPDATE users SET balance_minutes = 0 WHERE id = ?').run(user.id)
        socket.write(JSON.stringify({ command: 'login-success', user: user.display_name || user.username, duration: user.balance_minutes }) + '\n')
        broadcastMachines()
      }
    }
  }
}

tcpServer.on('connection', (socket) => {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        handleClientMessage(socket, data)
      } catch (e) {
        console.error('TCP parse error:', e)
      }
    }
  })
  socket.on('close', () => {
    const machineId = clients.get(socket)
    if (machineId) {
      db.prepare("UPDATE machines SET status = 'offline' WHERE id = ?").run(machineId)
      clients.delete(socket)
      clientMetrics.delete(machineId)
      broadcastMachines()
    }
  })
  socket.on('error', () => { try { socket.destroy() } catch {} })
})
tcpServer.listen(9000, '0.0.0.0', () => { console.log('TCP server listening on port 9000') })

function getMachinesData() {
  if (!db) return []
  return db.prepare(`
    SELECT m.*, 
           s.customer_name as user,
           s.plan_id,
           s.mode,
           s.custom_duration,
           COALESCE(p.duration_minutes, s.custom_duration) as duration_minutes,
           CASE 
             WHEN s.start_time IS NOT NULL THEN CAST((strftime('%s', 'now') - strftime('%s', s.start_time)) AS INTEGER)
             ELSE 0 
           END as timeElapsed
    FROM machines m 
    LEFT JOIN sessions s ON s.machine_id = m.id AND s.end_time IS NULL
    LEFT JOIN plans p ON s.plan_id = p.id
  `).all().map((m: any) => {
    let timeRemaining = 0
    if (m.mode === 'prepaid' && m.duration_minutes) {
      timeRemaining = Math.max(0, (m.duration_minutes * 60) - (m.timeElapsed || 0))
    } else if (m.mode === 'postpaid') {
      timeRemaining = m.timeElapsed || 0
    }
    const metrics = clientMetrics.get(m.id) || { cpu: 0, ram: 0, activeWindow: '', os: 'Unknown', uptime: 0 }
    return { ...m, timeRemaining, metrics }
  })
}

function broadcastMachines() {
  if (mainWindow) {
    mainWindow.webContents.send('machines-updated', getMachinesData())
  }
}

function sendCommandToMachine(machineId: number, cmd: any) {
  for (const [socket, mId] of clients.entries()) {
    if (mId === machineId) {
      try {
        socket.write(JSON.stringify(cmd) + '\n')
      } catch {}
      break
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Register F12 toggle DevTools shortcut
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile('dist/index.html')
  }
}

function getLanIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

let udpServer: dgram.Socket | null = null;
function startUdpBroadcast() {
  const socket = dgram.createSocket('udp4');
  socket.bind(() => {
    socket.setBroadcast(true);
  });
  
  setInterval(() => {
    try {
      const serverIP = getLanIPAddress();
      const payload = JSON.stringify({
        service: 'netcafe-server',
        wsUrl: `tcp://${serverIP}:9000`
      });
      socket.send(payload, 0, payload.length, 9090, '255.255.255.255');
    } catch (err) {
      console.error('UDP Broadcast error:', err);
    }
  }, 3000);
  
  udpServer = socket;
}

app.whenReady().then(async () => {
  setupDatabase()
  createWindow()
  startUdpBroadcast()

  // Auto Updater logic for Server
  autoUpdater.channel = 'latest-server';   // ← must NOT pick up latest-agent.yml
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', async (info) => {
    mainWindow?.webContents.send('update-status', { status: 'available', info });
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Yes, download and install', 'Later'],
      title: 'Update Available',
      message: `NetCafe Server v${info.version} is available. Do you want to download and install it now?`,
    });
    if (response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update-status', { status: 'not-available', info });
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-status', { status: 'error', message: err.message });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update-status', { status: 'downloading', progress: progressObj });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-status', { status: 'downloaded', info });
    dialog.showMessageBox({
      title: 'Install Update',
      message: 'Update downloaded. The application will restart to install it.'
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC Handlers
ipcMain.handle('login-staff', (_, username, password) => {
  const user = db.prepare("SELECT * FROM staff WHERE username = ?").get(username)
  if (user && user.password_hash === password) {
    return { success: true, user: { username: user.username, role: user.role } }
  }
  return { success: false, error: 'Invalid username or password' }
})

ipcMain.handle('get-machines', () => {
  return getMachinesData()
})

ipcMain.handle('open-session', (_, machineId, customerName, planId, mode, customDuration) => {
  let duration = customDuration || null
  if (planId) {
    const plan = db.prepare("SELECT duration_minutes FROM plans WHERE id = ?").get(planId)
    if (plan) {
      duration = plan.duration_minutes
    }
  }
  
  db.prepare(`
    INSERT INTO sessions (machine_id, customer_name, plan_id, start_time, mode, status, custom_duration) 
    VALUES (?, ?, ?, datetime('now'), ?, 'active', ?)
  `).run(machineId, customerName || 'Walk-in', planId || null, mode || 'postpaid', duration)

  db.prepare("UPDATE machines SET status = 'in_use' WHERE id = ?").run(machineId)
  sendCommandToMachine(machineId, { command: 'unlock', user: customerName || 'Guest' })
  broadcastMachines()
})

ipcMain.handle('pause-session', (_, machineId) => {
  db.prepare("UPDATE machines SET status = 'paused' WHERE id = ?").run(machineId)
  db.prepare("UPDATE sessions SET status = 'paused' WHERE machine_id = ? AND end_time IS NULL").run(machineId)
  sendCommandToMachine(machineId, { command: 'lock' })
  broadcastMachines()
})

ipcMain.handle('resume-session', (_, machineId) => {
  db.prepare("UPDATE machines SET status = 'in_use' WHERE id = ?").run(machineId)
  db.prepare("UPDATE sessions SET status = 'active' WHERE machine_id = ? AND end_time IS NULL").run(machineId)
  sendCommandToMachine(machineId, { command: 'unlock' })
  broadcastMachines()
})

ipcMain.handle('extend-session', (_, machineId, extraMinutes) => {
  const session = db.prepare("SELECT * FROM sessions WHERE machine_id = ? AND status = 'active' AND end_time IS NULL").get(machineId)
  if (session) {
    if (session.plan_id) {
      const plan = db.prepare("SELECT duration_minutes FROM plans WHERE id = ?").get(session.plan_id)
      const currentDuration = plan ? plan.duration_minutes : 0
      const newDuration = currentDuration + extraMinutes
      db.prepare("UPDATE sessions SET plan_id = NULL, custom_duration = ? WHERE id = ?").run(newDuration, session.id)
    } else {
      const currentDuration = session.custom_duration || 0
      const newDuration = currentDuration + extraMinutes
      db.prepare("UPDATE sessions SET custom_duration = ? WHERE id = ?").run(newDuration, session.id)
    }
    broadcastMachines()
    return { success: true }
  }
  return { success: false, error: 'No active session' }
})

ipcMain.handle('close-session', (_, machineId, totalAmount, discount, paymentMethod) => {
  db.prepare("UPDATE machines SET status = 'available' WHERE id = ?").run(machineId)
  db.prepare(`
    UPDATE sessions 
    SET end_time = datetime('now'), 
        total_amount = ?, 
        discount = ?, 
        payment_method = ?, 
        status = 'completed' 
    WHERE machine_id = ? AND end_time IS NULL
  `).run(totalAmount || 0, discount || 0, paymentMethod || 'Cash', machineId)
  sendCommandToMachine(machineId, { command: 'lock' })
  broadcastMachines()
})

ipcMain.handle('lock-machine', (_, machineId) => {
  sendCommandToMachine(machineId, { command: 'lock' })
})

ipcMain.handle('message-machine', (_, machineId, message) => {
  sendCommandToMachine(machineId, { command: 'message', payload: message })
})

ipcMain.handle('power-machine', (_, machineId) => {
  sendCommandToMachine(machineId, { command: 'poweroff' })
})

ipcMain.handle('restart-machine', (_, machineId) => {
  sendCommandToMachine(machineId, { command: 'restart' })
})

ipcMain.handle('limit-bandwidth', (_, machineId, rate) => {
  sendCommandToMachine(machineId, { command: 'limit-bandwidth', payload: { rate: rate || '2mbit' } })
})

ipcMain.handle('remove-bandwidth', (_, machineId) => {
  sendCommandToMachine(machineId, { command: 'remove-bandwidth' })
})

// Global Actions
ipcMain.handle('lock-all', () => {
  for (const [socket, machineId] of clients.entries()) {
    try {
      socket.write(JSON.stringify({ command: 'lock' }) + '\n')
      db.prepare("UPDATE machines SET status = 'paused' WHERE id = ?").run(machineId)
      db.prepare("UPDATE sessions SET status = 'paused' WHERE machine_id = ? AND end_time IS NULL").run(machineId)
    } catch {}
  }
  broadcastMachines()
})

ipcMain.handle('message-all', (_, message) => {
  const payload = JSON.stringify({ command: 'message', payload: message })
  for (const [socket] of clients.entries()) {
    try {
      socket.write(payload + '\n')
    } catch {}
  }
})

ipcMain.handle('power-all', () => {
  const payload = JSON.stringify({ command: 'poweroff' })
  for (const [socket] of clients.entries()) {
    try {
      socket.write(payload + '\n')
    } catch {}
  }
})

// Plans CRUD
ipcMain.handle('get-plans', () => {
  return db.prepare("SELECT * FROM plans").all()
})

ipcMain.handle('create-plan', (_, name, rateType, price, durationMinutes) => {
  return db.prepare("INSERT INTO plans (name, rate_type, price, duration_minutes) VALUES (?, ?, ?, ?)").run(name, rateType, price, durationMinutes)
})

ipcMain.handle('update-plan', (_, id, name, rateType, price, durationMinutes) => {
  return db.prepare("UPDATE plans SET name = ?, rate_type = ?, price = ?, duration_minutes = ? WHERE id = ?").run(name, rateType, price, durationMinutes, id)
})

ipcMain.handle('delete-plan', (_, id) => {
  return db.prepare("DELETE FROM plans WHERE id = ?").run(id)
})

// Block Rules CRUD
ipcMain.handle('get-block-rules', () => {
  return db.prepare("SELECT * FROM block_rules").all()
})

ipcMain.handle('add-block-rule', (_, type, value, mode) => {
  const info = db.prepare("INSERT INTO block_rules (type, value, mode, is_active) VALUES (?, ?, ?, 1)").run(type, value, mode)
  broadcastBlockRulesToClients()
  return info
})

ipcMain.handle('toggle-block-rule', (_, id, isActive) => {
  const info = db.prepare("UPDATE block_rules SET is_active = ? WHERE id = ?").run(isActive ? 1 : 0, id)
  broadcastBlockRulesToClients()
  return info
})

ipcMain.handle('delete-block-rule', (_, id) => {
  const info = db.prepare("DELETE FROM block_rules WHERE id = ?").run(id)
  broadcastBlockRulesToClients()
  return info
})

// Settings
ipcMain.handle('get-settings', () => {
  const rows = db.prepare("SELECT * FROM settings").all()
  const settings: any = {}
  rows.forEach((r: any) => { settings[r.key] = r.value })
  return settings
})

ipcMain.handle('update-settings', (_, key, value) => {
  return db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value)
})

ipcMain.handle('backup-db', async (_, targetPath) => {
  try {
    fs.copyFileSync(dbPath, targetPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('restore-db', async (_, sourcePath) => {
  try {
    db.close()
    fs.copyFileSync(sourcePath, dbPath)
    setupDatabase()
    broadcastMachines()
    return { success: true }
  } catch (e: any) {
    try { setupDatabase() } catch {}
    return { success: false, error: e.message }
  }
})

// Reports & History
ipcMain.handle('get-reports-summary', () => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_sessions,
      SUM(total_amount) as total_revenue,
      AVG(CASE WHEN end_time IS NOT NULL THEN (strftime('%s', end_time) - strftime('%s', start_time)) ELSE 0 END) as avg_duration
    FROM sessions 
    WHERE date(start_time) = date('now')
  `).get()
  
  const chartData = db.prepare(`
    SELECT date(start_time) as date, SUM(total_amount) as revenue
    FROM sessions
    WHERE start_time >= date('now', '-7 days')
    GROUP BY date(start_time)
    ORDER BY date
  `).all()

  const machineUsage = db.prepare(`
    SELECT m.name, COUNT(s.id) as sessions_count, COALESCE(SUM(s.total_amount), 0) as total_revenue
    FROM machines m
    LEFT JOIN sessions s ON s.machine_id = m.id
    GROUP BY m.id
  `).all()

  const sessionsHistory = db.prepare(`
    SELECT s.*, m.name as machine_name, p.name as plan_name
    FROM sessions s
    LEFT JOIN machines m ON s.machine_id = m.id
    LEFT JOIN plans p ON s.plan_id = p.id
    ORDER BY s.start_time DESC
  `).all()

  return {
    totalSessions: stats.total_sessions || 0,
    totalRevenue: stats.total_revenue || 0,
    avgDuration: Math.round((stats.avg_duration || 0) / 60),
    chartData,
    machineUsage,
    sessionsHistory
  }
})

// Async Screenshot Request
ipcMain.handle('capture-screenshot', async (_, machineId) => {
  return new Promise((resolve, reject) => {
    let clientSocket: net.Socket | null = null
    for (const [socket, mId] of clients.entries()) {
      if (mId === machineId) {
        clientSocket = socket
        break
      }
    }

    if (!clientSocket) {
      return reject(new Error('Machine is offline'))
    }

    const timeout = setTimeout(() => {
      pendingScreenshots.delete(machineId)
      reject(new Error('Screenshot request timed out'))
    }, 7000)

    pendingScreenshots.set(machineId, { resolve, reject, timeout })

    try {
      clientSocket.write(JSON.stringify({ command: 'capture-screenshot' }) + '\n')
    } catch (e) {
      clearTimeout(timeout)
      pendingScreenshots.delete(machineId)
      reject(e)
    }
  })
})

// ─── User Account Management IPC Handlers ─────────────────────────────────────
ipcMain.handle('get-users', () => {
  return db.prepare('SELECT id, username, display_name, phone, email, balance_minutes, created_at FROM users ORDER BY created_at DESC').all()
})

ipcMain.handle('create-user', (_, username: string, password: string, displayName: string, phone: string, email: string, balanceMinutes: number) => {
  try {
    const info = db.prepare('INSERT INTO users (username, password, display_name, phone, email, balance_minutes) VALUES (?, ?, ?, ?, ?, ?)').run(username, password, displayName || null, phone || null, email || null, balanceMinutes || 0)
    return { success: true, id: info.lastInsertRowid }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('update-user', (_, id: number, username: string, password: string, displayName: string, phone: string, email: string, balanceMinutes: number) => {
  try {
    if (password && password.trim() !== '') {
      db.prepare('UPDATE users SET username = ?, password = ?, display_name = ?, phone = ?, email = ?, balance_minutes = ? WHERE id = ?').run(username, password, displayName || null, phone || null, email || null, balanceMinutes || 0, id)
    } else {
      db.prepare('UPDATE users SET username = ?, display_name = ?, phone = ?, email = ?, balance_minutes = ? WHERE id = ?').run(username, displayName || null, phone || null, email || null, balanceMinutes || 0, id)
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('delete-user', (_, id: number) => {
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('topup-user', (_, id: number, minutes: number) => {
  try {
    db.prepare('UPDATE users SET balance_minutes = balance_minutes + ? WHERE id = ?').run(minutes, id)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('bulk-create-users', (_, users: { username: string; password: string; display_name: string; balance_minutes: number }[]) => {
  const results: { username: string; success: boolean; error?: string }[] = []
  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password, display_name, balance_minutes) VALUES (?, ?, ?, ?)')
  for (const u of users) {
    try {
      stmt.run(u.username, u.password, u.display_name || null, u.balance_minutes || 0)
      results.push({ username: u.username, success: true })
    } catch (e: any) {
      results.push({ username: u.username, success: false, error: e.message })
    }
  }
  return results
})

// ─── Machine Management IPC Handlers ──────────────────────────────────────────
ipcMain.handle('rename-machine', (_, id: number, newName: string) => {
  try {
    db.prepare('UPDATE machines SET name = ? WHERE id = ?').run(newName, id)
    broadcastMachines()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('delete-machine', (_, id: number) => {
  try {
    db.prepare('DELETE FROM machines WHERE id = ?').run(id)
    broadcastMachines()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ─── Auto Updater IPC ──────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(err => {
    mainWindow?.webContents.send('update-status', { status: 'error', message: err.message })
  })
})

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate().catch(err => {
    mainWindow?.webContents.send('update-status', { status: 'error', message: err.message })
  })
})

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall()
})
