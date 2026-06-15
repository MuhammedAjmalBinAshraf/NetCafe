import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import fs from 'fs'
import Database from 'better-sqlite3'
import os from 'os'
import dgram from 'dgram'
import { exec } from 'child_process'
import * as XLSX from 'xlsx'

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
    `)
    // Seed plans
    db.exec(`
      INSERT INTO plans (name, rate_type, price, duration_minutes) VALUES ('1 Hour', 'fixed', 5.00, 60);
      INSERT INTO plans (name, rate_type, price, duration_minutes) VALUES ('2 Hours', 'fixed', 9.00, 120);
    `)
  }
  // Staff table — always ensure it exists (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, role TEXT);`)
  // Always ensure admin account exists (INSERT OR IGNORE — never overwrites a changed password)
  db.exec(`INSERT OR IGNORE INTO staff (username, password_hash, role) VALUES ('admin', 'admin', 'admin');`)

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

  try {
    db.exec("ALTER TABLE machines ADD COLUMN hardware_locked INTEGER DEFAULT 0;")
  } catch {}
  try {
    // SQLite does NOT support UNIQUE on ALTER TABLE ADD COLUMN — add column without it
    db.exec("ALTER TABLE machines ADD COLUMN uuid TEXT;")
  } catch {}
  // Create partial unique index separately (WHERE uuid IS NOT NULL allows multiple NULLs)
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_uuid ON machines(uuid) WHERE uuid IS NOT NULL;")
  } catch {}


  // Session app logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_app_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      app_title TEXT,
      duration_seconds INTEGER DEFAULT 0,
      focus_count INTEGER DEFAULT 0,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
    );
  `)

  // Session process events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_process_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      machine_id INTEGER,
      event_type TEXT,
      process_name TEXT,
      timestamp TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
    );
  `)

  // Safety alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS safety_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER,
      query TEXT,
      reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  // AI safety settings defaults
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_safety_enabled', 'false');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('gemini_api_key', '');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('filter_porn', 'true');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('filter_violence', 'true');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('filter_self_harm', 'true');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('filter_illegal', 'true');")
  // Custom keyword/phrase terms that always trigger a block (stored as JSON array string)
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_filter_terms', '[]');")
  // Admin-editable extra context injected into Gemini prompt
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_custom_context', '');")
  // Operator (client-side) PIN password
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('operator_password', 'admin');")
}

// TCP Server & Metrics Maps
const tcpServer = net.createServer()
const clients = new Map<net.Socket, number>() // socket -> machine.id
const clientMetrics = new Map<number, { cpu: number, ram: number, activeWindow: string, os: string, ip: string, uptime: number }>()
const pendingScreenshots = new Map<number, { resolve: (val: string) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>()
const latestScreenFrames = new Map<number, string>()
let activeMirrorMachineId: number | null = null;
const serverLogsCache: { timestamp: string, message: string }[] = []

function logToUI(msg: string) {
  const logEntry = {
    timestamp: new Date().toISOString().substring(11, 19),
    message: msg
  }
  console.log(`[SYS LOG] ${msg}`)
  serverLogsCache.push(logEntry)
  if (serverLogsCache.length > 100) serverLogsCache.shift()
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-log', logEntry)
  }
}

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
    let machine: any = null
    const incomingIp = payload.ip_address || socket.remoteAddress || ''

    if (payload.uuid) {
      machine = db.prepare("SELECT * FROM machines WHERE uuid = ?").get(payload.uuid)
    }
    if (!machine && payload.mac_address) {
      machine = db.prepare("SELECT * FROM machines WHERE mac_address = ?").get(payload.mac_address)
    }

    // If we found a match by UUID/MAC but that slot is ALREADY occupied by an active
    // socket from a DIFFERENT IP, treat this as a distinct machine (cloned VM scenario).
    if (machine) {
      const existingMachineId = Number(machine.id)
      let alreadyConnectedFromDifferentIp = false
      for (const [s, mId] of clients.entries()) {
        if (Number(mId) === existingMachineId && s !== socket) {
          const existingIp = (s as any).remoteAddress || ''
          if (existingIp && incomingIp && existingIp !== incomingIp) {
            alreadyConnectedFromDifferentIp = true
            break
          }
        }
      }
      if (alreadyConnectedFromDifferentIp) {
        machine = null // Force creation of a new record for this different physical machine
        logToUI(`Duplicate UUID/MAC from different IP (${incomingIp}). Creating separate machine entry.`)
      }
    }

    if (!machine) {
      const stmt = db.prepare("INSERT INTO machines (name, mac_address, uuid, ip_address, status) VALUES (?, ?, ?, ?, ?)")
      // For cloned machines sharing a UUID/MAC, store null so they don't collide
      let storeUuid: string | null = payload.uuid || null
      let storeMac: string | null = payload.mac_address || null
      // Check if uuid/mac already in use by another machine
      if (storeUuid && db.prepare("SELECT id FROM machines WHERE uuid = ?").get(storeUuid)) storeUuid = null
      if (storeMac && db.prepare("SELECT id FROM machines WHERE mac_address = ?").get(storeMac)) storeMac = null
      const info = stmt.run(payload.name || 'New PC', storeMac, storeUuid, incomingIp, 'available')
      machine = { id: info.lastInsertRowid }
      logToUI(`Registered new machine in DB: Name=${payload.name || 'New PC'}, Mac=${payload.mac_address}, UUID=${payload.uuid || 'N/A'}, IP=${incomingIp}`)
    } else {
      db.prepare("UPDATE machines SET name = ?, ip_address = ?, status = ?, uuid = COALESCE(uuid, ?) WHERE id = ?").run(payload.name || machine.name, incomingIp, 'available', payload.uuid || null, machine.id)
      logToUI(`Client reconnected: ID=${machine.id}, Name=${payload.name || machine.name}, IP=${incomingIp}`)
    }

    // Clean up stale sockets for this machine ID
    const targetId = Number(machine.id)
    for (const [s, mId] of clients.entries()) {
      if (Number(mId) === targetId && s !== socket) {
        logToUI(`Closing stale TCP socket for machine ID ${targetId}`)
        clients.delete(s)
        try { s.destroy() } catch {}
      }
    }

    clients.set(socket, machine.id)
    logToUI(`Mapped client socket to machine ID ${machine.id}`)

    // Enforce hardware lock state on registration if enabled
    const machineRow = db.prepare("SELECT hardware_locked FROM machines WHERE id = ?").get(machine.id)
    if (machineRow && machineRow.hardware_locked) {
      socket.write(JSON.stringify({ command: 'block-inputs', payload: { block: true } }) + '\n')
      logToUI(`Enforcing hardware input lock on machine ID ${machine.id} on reconnection.`)
    }

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
        uptime: data.payload.uptime || 0,
        resolution: data.payload.resolution || { width: 1920, height: 1080 }
      })
      broadcastMachines()

      // Log application usage to active session log
      try {
        const activeSession = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId)
        if (activeSession) {
          const sessionId = activeSession.id
          const appTitle = data.payload.activeWindow || 'Desktop'
          
          const existingLog = db.prepare("SELECT id FROM session_app_logs WHERE session_id = ? AND app_title = ?").get(sessionId, appTitle)
          const lastApp = lastActiveAppMap.get(Number(machineId))
          const isNewFocus = lastApp !== appTitle

          if (existingLog) {
            db.prepare(`
              UPDATE session_app_logs 
              SET duration_seconds = duration_seconds + 10,
                  focus_count = focus_count + ?,
                  last_seen = datetime('now')
              WHERE id = ?
            `).run(isNewFocus ? 1 : 0, existingLog.id)
          } else {
            db.prepare(`
              INSERT INTO session_app_logs (session_id, app_title, duration_seconds, focus_count)
              VALUES (?, ?, 10, 1)
            `).run(sessionId, appTitle)
          }
          lastActiveAppMap.set(Number(machineId), appTitle)

          // Log process start/stop events
          const IGNORED = new Set(['conhost.exe','svchost.exe','csrss.exe','smss.exe','lsass.exe','services.exe','winlogon.exe','wininit.exe','system idle process','system','registry','tasklist.exe','cmd.exe','wmic.exe','wmiprvse.exe'])
          const evtTs = data.payload.timestamp || new Date().toISOString()
          for (const proc of (data.payload.processesStarted || []) as string[]) {
            if (!IGNORED.has(proc.toLowerCase())) {
              db.prepare(`INSERT INTO session_process_events (session_id, machine_id, event_type, process_name, timestamp) VALUES (?,?,?,?,?)`)
                .run(sessionId, Number(machineId), 'started', proc, evtTs)
            }
          }
          for (const proc of (data.payload.processesClosed || []) as string[]) {
            if (!IGNORED.has(proc.toLowerCase())) {
              db.prepare(`INSERT INTO session_process_events (session_id, machine_id, event_type, process_name, timestamp) VALUES (?,?,?,?,?)`)
                .run(sessionId, Number(machineId), 'closed', proc, evtTs)
            }
          }
        }
      } catch (err) {
        console.error('Failed to log session app usage:', err)
      }

      // AI Safety Guard: search query extraction & safety check
      try {
        const safetyEnabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_safety_enabled'").get()?.value === 'true'
        const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get()?.value
        
        if (safetyEnabled && apiKey && apiKey.trim()) {
          const title = data.payload.activeWindow || ''
          let query = ''
          if (title.endsWith(' - Google Search')) {
            query = title.substring(0, title.length - ' - Google Search'.length)
          } else if (title.endsWith(' - YouTube')) {
            query = title.substring(0, title.length - ' - YouTube'.length)
          } else if (title.endsWith(' - Bing')) {
            query = title.substring(0, title.length - ' - Bing'.length)
          } else if (title.includes(' - Yahoo Search') || title.includes('| Yahoo Search Results')) {
            query = title.replace(' - Yahoo Search', '').replace('| Yahoo Search Results', '').trim()
          }

          if (query && query.trim()) {
            const lastQuery = lastCheckedQueries.get(Number(machineId))
            if (lastQuery !== query) {
              lastCheckedQueries.set(Number(machineId), query)
              const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })

              // Emit live filter log: new query received
              if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'info', message: `NEW QUERY from machine ${Number(machineId)}: "${query}"`, machineId: Number(machineId), query })

              // Synchronous custom-term check (Layer 1 — no API call needed)
              let customTermsRaw = db.prepare("SELECT value FROM settings WHERE key = 'custom_filter_terms'").get()?.value || '[]'
              let customTerms: string[] = []
              try { customTerms = JSON.parse(customTermsRaw) } catch {}
              const lowerQuery = query.toLowerCase()
              const matchedTerm = customTerms.find((t: string) => t && lowerQuery.includes(t.toLowerCase()))
              if (matchedTerm) {
                logToUI(`Safety Guard CUSTOM TERM MATCH on machine ID ${Number(machineId)}: "${query}" matched term "${matchedTerm}"`)
                if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'block', message: `LAYER 1 BLOCKED — Custom term "${matchedTerm}" matched — Locking machine ${Number(machineId)}`, machineId: Number(machineId), query })
                db.prepare("INSERT INTO safety_alerts (machine_id, query, reason) VALUES (?, ?, ?)").run(Number(machineId), query, `Custom blocked term: "${matchedTerm}"`)
                sendCommandToMachine(Number(machineId), { command: 'lock' })
                sendCommandToMachine(Number(machineId), { command: 'message', payload: `Your terminal has been locked: blocked search term detected ("${matchedTerm}").` })
                if (mainWindow) mainWindow.webContents.send('safety-alert-triggered', { machineId: Number(machineId), query, reason: `Custom term: "${matchedTerm}"` })
                broadcastMachines()
              } else {
                if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'allow', message: `LAYER 1 PASSED — No custom term match for "${query}"`, machineId: Number(machineId), query })
              }

              const filterPorn = db.prepare("SELECT value FROM settings WHERE key = 'filter_porn'").get()?.value !== 'false'
              const filterViolence = db.prepare("SELECT value FROM settings WHERE key = 'filter_violence'").get()?.value !== 'false'
              const filterSelfHarm = db.prepare("SELECT value FROM settings WHERE key = 'filter_self_harm'").get()?.value !== 'false'
              const filterIllegal = db.prepare("SELECT value FROM settings WHERE key = 'filter_illegal'").get()?.value !== 'false'
              checkQuerySafety(Number(machineId), query, apiKey, {
                porn: filterPorn,
                violence: filterViolence,
                selfHarm: filterSelfHarm,
                illegal: filterIllegal,
                customTerms
              })
            }
          }
        }
      } catch (err) {
        console.error('Safety Guard trigger error:', err)
      }
    }
  }
  else if (data.type === 'screen-frame') {
    const machineId = clients.get(socket)
    if (machineId) {
      latestScreenFrames.set(machineId, data.payload)
      if (mainWindow) {
        mainWindow.webContents.send('screen-frame-updated', { machineId, base64: data.payload })
      }
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
  else if (data.type === 'command-result') {
    const machineId = clients.get(socket)
    if (machineId && mainWindow) {
      mainWindow.webContents.send('remote-command-result', {
        machineId,
        commandLine: data.payload.commandLine,
        output: data.payload.output,
        success: data.payload.success
      })
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
  logToUI(`New incoming TCP connection from ${socket.remoteAddress}:${socket.remotePort}`)
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
      } catch (e: any) {
        logToUI(`TCP parse error from ${socket.remoteAddress}: ${e.message}`)
      }
    }
  })
  socket.on('close', () => {
    const machineId = clients.get(socket)
    logToUI(`TCP connection closed for machine ID ${machineId || 'unregistered'}`)
    if (machineId) {
      db.prepare("UPDATE machines SET status = 'offline' WHERE id = ?").run(machineId)
      clients.delete(socket)
      clientMetrics.delete(machineId)
      latestScreenFrames.delete(machineId)
      if (activeMirrorMachineId === Number(machineId)) {
        activeMirrorMachineId = null
      }
      broadcastMachines()
    }
  })
  socket.on('error', (err) => { 
    logToUI(`TCP socket error: ${err.message}`)
    try { socket.destroy() } catch {} 
  })
})
function setupWindowsFirewall() {
  if (process.platform !== 'win32') return
  
  logToUI('Checking Windows Firewall rules for NetCafe Server...')
  
  // Rule for TCP 9000
  exec('netsh advfirewall firewall show rule name="NetCafe Server TCP"', (err, stdout) => {
    if (err || !stdout.includes('NetCafe Server TCP')) {
      logToUI('Firewall rule "NetCafe Server TCP" not found. Attempting to add...')
      exec('netsh advfirewall firewall add rule name="NetCafe Server TCP" dir=in action=allow protocol=TCP localport=9000 profile=any', (addErr) => {
        if (addErr) {
          logToUI(`Warning: Failed to add TCP firewall rule: ${addErr.message}`)
        } else {
          logToUI('Successfully added Windows Firewall rule for TCP port 9000 (all profiles).')
        }
      })
    } else {
      logToUI('Windows Firewall rule for TCP port 9000 already exists.')
    }
  })

  // Rule for UDP 9090
  exec('netsh advfirewall firewall show rule name="NetCafe Server UDP"', (err, stdout) => {
    if (err || !stdout.includes('NetCafe Server UDP')) {
      logToUI('Firewall rule "NetCafe Server UDP" not found. Attempting to add...')
      exec('netsh advfirewall firewall add rule name="NetCafe Server UDP" dir=in action=allow protocol=UDP localport=9090 profile=any', (addErr) => {
        if (addErr) {
          logToUI(`Warning: Failed to add UDP firewall rule: ${addErr.message}`)
        } else {
          logToUI('Successfully added Windows Firewall rule for UDP port 9090 (all profiles).')
        }
      })
    } else {
      logToUI('Windows Firewall rule for UDP port 9090 already exists.')
    }
  })
}

tcpServer.listen(9000, '0.0.0.0', () => { 
  logToUI('TCP server listening on port 9000') 
  setupWindowsFirewall()
})

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

function sendCommandToMachine(machineId: number | string, cmd: any) {
  const targetId = Number(machineId)
  let found = false
  for (const [socket, mId] of clients.entries()) {
    if (Number(mId) === targetId) {
      found = true
      if (socket.writable && !socket.destroyed) {
        try {
          socket.write(JSON.stringify(cmd) + '\n')
          logToUI(`Successfully sent command '${cmd.command}' to machine ID ${machineId} (${socket.remoteAddress || 'unknown'}:${socket.remotePort || 'unknown'})`)
        } catch (e: any) {
          logToUI(`Error sending command '${cmd.command}' to machine ID ${machineId}: ${e.message}`)
          console.error(`Failed to send command to machine ${machineId}:`, e)
        }
      } else {
        logToUI(`Found TCP socket for machine ID ${machineId}, but it is not writable or is destroyed.`)
      }
      break
    }
  }
  if (!found) {
    logToUI(`Failed to send command '${cmd.command}' to machine ID ${machineId}: client PC is not connected (no TCP socket found).`)
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
  logToUI('Starting UDP broadcast on port 9090 (interval: 3s)...');
  const socket = dgram.createSocket('udp4');
  socket.bind(() => {
    socket.setBroadcast(true);
    logToUI('UDP broadcast socket bound and set to broadcast mode.');
  });
  
  let broadcastCount = 0;
  setInterval(() => {
    try {
      const serverIP = getLanIPAddress();
      const payload = JSON.stringify({
        service: 'netcafe-server',
        wsUrl: `tcp://${serverIP}:9000`
      });
      socket.send(payload, 0, payload.length, 9090, '255.255.255.255');
      broadcastCount++;
      if (broadcastCount % 20 === 1) { // Log once every 60s to avoid console clutter
        logToUI(`UDP Broadcast: active. Broadcasting service info: ${payload}`);
      }
    } catch (err: any) {
      logToUI(`UDP Broadcast error: ${err.message}`);
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

ipcMain.handle('change-staff-password', (_, username, currentPassword, newPassword) => {
  const user = db.prepare("SELECT * FROM staff WHERE username = ?").get(username)
  if (!user || user.password_hash !== currentPassword) {
    return { success: false, error: 'Current password is incorrect' }
  }
  if (!newPassword || newPassword.trim().length < 3) {
    return { success: false, error: 'New password must be at least 3 characters' }
  }
  db.prepare("UPDATE staff SET password_hash = ? WHERE username = ?").run(newPassword.trim(), username)
  return { success: true }
})

ipcMain.handle('change-staff-username', (_, currentUsername, password, newUsername) => {
  const user = db.prepare("SELECT * FROM staff WHERE username = ?").get(currentUsername)
  if (!user || user.password_hash !== password) {
    return { success: false, error: 'Password is incorrect' }
  }
  if (!newUsername || newUsername.trim().length < 3) {
    return { success: false, error: 'New username must be at least 3 characters' }
  }
  const existing = db.prepare("SELECT id FROM staff WHERE username = ?").get(newUsername.trim())
  if (existing) {
    return { success: false, error: 'Username already taken' }
  }
  db.prepare("UPDATE staff SET username = ? WHERE username = ?").run(newUsername.trim(), currentUsername)
  return { success: true }
})

ipcMain.handle('get-operator-password', () => {
  return (db.prepare("SELECT value FROM settings WHERE key = 'operator_password'").get() as any)?.value || 'admin'
})

ipcMain.handle('set-operator-password', (_, currentPassword, newPassword) => {
  const stored = (db.prepare("SELECT value FROM settings WHERE key = 'operator_password'").get() as any)?.value || 'admin'
  if (stored !== currentPassword) {
    return { success: false, error: 'Current operator password is incorrect' }
  }
  if (!newPassword || newPassword.trim().length < 3) {
    return { success: false, error: 'New password must be at least 3 characters' }
  }
  db.prepare("UPDATE settings SET value = ? WHERE key = 'operator_password'").run(newPassword.trim())
  // Broadcast updated operator password to all connected clients
  const payload = JSON.stringify({ command: 'update-operator-password', payload: { password: newPassword.trim() } })
  for (const [socket] of clients.entries()) {
    try { socket.write(payload + '\n') } catch {}
  }
  return { success: true }
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
  
  // Close any existing active sessions to prevent duplicate cards
  const closeResult = db.prepare(`UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE machine_id = ? AND end_time IS NULL`).run(machineId)
  if (closeResult.changes > 0) {
    logToUI(`Cleaned up ${closeResult.changes} stale active sessions for machine ID ${machineId}`)
  }
  
  db.prepare(`
    INSERT INTO sessions (machine_id, customer_name, plan_id, start_time, mode, status, custom_duration) 
    VALUES (?, ?, ?, datetime('now'), ?, 'active', ?)
  `).run(machineId, customerName || 'Walk-in', planId || null, mode || 'postpaid', duration)

  db.prepare("UPDATE machines SET status = 'in_use' WHERE id = ?").run(machineId)
  logToUI(`Opening session on machine ID ${machineId} for user ${customerName || 'Walk-in'}`)
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

ipcMain.handle('get-safety-alerts', () => {
  if (!db) return []
  return db.prepare("SELECT sa.*, m.name as machine_name FROM safety_alerts sa LEFT JOIN machines m ON sa.machine_id = m.id ORDER BY sa.timestamp DESC").all()
})

ipcMain.handle('clear-safety-alerts', () => {
  if (!db) return { success: false }
  db.prepare("DELETE FROM safety_alerts").run()
  return { success: true }
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
    const targetId = Number(machineId)
    for (const [socket, mId] of clients.entries()) {
      if (Number(mId) === targetId) {
        if (socket.writable && !socket.destroyed) {
          clientSocket = socket
          break
        }
      }
    }

    if (!clientSocket) {
      return reject(new Error('Machine is offline'))
    }

    const timeout = setTimeout(() => {
      pendingScreenshots.delete(targetId)
      reject(new Error('Screenshot request timed out'))
    }, 7000)

    pendingScreenshots.set(targetId, { resolve, reject, timeout })

    try {
      clientSocket.write(JSON.stringify({ command: 'capture-screenshot' }) + '\n')
    } catch (e) {
      clearTimeout(timeout)
      pendingScreenshots.delete(targetId)
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

ipcMain.handle('bulk-import-users', (_, xlsxBase64: string) => {
  try {
    const buffer = Buffer.from(xlsxBase64, 'base64')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    const results = { success: 0, skipped: 0, errors: [] as string[] }

    for (const row of rows) {
      // Support columns: username/Username/name, password/Password, email/Email, phone/Phone
      const username = (row.username || row.Username || row.name || row.Name || '').toString().trim()
      const password = (row.password || row.Password || '').toString().trim()
      const email = (row.email || row.Email || '').toString().trim()
      const phone = (row.phone || row.Phone || row.mobile || row.Mobile || '').toString().trim()

      if (!username) {
        results.skipped++
        continue
      }

      try {
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
        if (existing) {
          results.skipped++
          continue
        }
        db.prepare('INSERT INTO users (username, password, email, phone) VALUES (?, ?, ?, ?)')
          .run(username, password || 'changeme', email, phone)
        results.success++
      } catch (e: any) {
        results.errors.push(`${username}: ${e.message}`)
      }
    }

    return { ok: true, ...results, total: rows.length }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('download-user-template', () => {
  // Return a sample xlsx as base64 for the user to download
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['username', 'password', 'email', 'phone'],
    ['john_doe', 'pass123', 'john@example.com', '9876543210'],
    ['jane_smith', 'pass456', 'jane@example.com', '9123456789'],
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Users')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(buf).toString('base64')
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

// ─── Remote Screen & Input Control IPC Handlers ──────────────────────────────
ipcMain.handle('get-latest-screen-frames', () => {
  const obj: Record<number, string> = {}
  for (const [mId, frame] of latestScreenFrames.entries()) {
    obj[mId] = frame
  }
  return obj
})

ipcMain.handle('send-remote-input', (_, machineId, inputEvent) => {
  sendCommandToMachine(machineId, { command: 'remote-input', payload: inputEvent })
})

ipcMain.handle('execute-remote-command', (_, machineId, commandLine) => {
  sendCommandToMachine(machineId, { command: 'execute-command', payload: { commandLine } })
})

const lastCheckedQueries = new Map<number, string>()
const lastActiveAppMap = new Map<number, string>()

async function checkQuerySafety(
  machineId: number,
  query: string,
  apiKey: string,
  filters: { porn: boolean; violence: boolean; selfHarm: boolean; illegal: boolean; customTerms?: string[] }
) {
  const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false })
  const emitLog = (level: 'info' | 'warn' | 'block' | 'allow', message: string) => {
    logToUI(`Safety Guard: ${message}`)
    if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts(), level, message, machineId, query })
  }

  emitLog('info', `LAYER 2: Evaluating query on machine ${machineId}: "${query}"`)
  try {
    const result = await evaluateQuerySafety(query, apiKey, filters, filters.customTerms || [], emitLog)
    if (result.isUnsafe) {
      emitLog('block', `LAYER 2 UNSAFE — Category: "${result.category}" — Locking machine ${machineId}`)
      db.prepare("INSERT INTO safety_alerts (machine_id, query, reason) VALUES (?, ?, ?)")
        .run(machineId, query, result.category || 'Unsafe content')
      sendCommandToMachine(machineId, { command: 'lock' })
      sendCommandToMachine(machineId, { 
        command: 'message', 
        payload: `Your terminal has been locked due to a safety violation. Prohibited search query detected: "${query}" (Safety Category: ${result.category || 'Inappropriate Content'}).`
      })
      if (mainWindow) {
        mainWindow.webContents.send('safety-alert-triggered', {
          machineId, query, reason: result.category || 'Unsafe content', timestamp: new Date().toISOString()
        })
      }
      broadcastMachines()
    } else {
      emitLog('allow', `LAYER 2 ALLOWED — Query "${query}" is safe`)
    }
  } catch (err: any) {
    emitLog('warn', `LAYER 2 ERROR: ${err.message}`)
    console.error('Safety check failed:', err)
  }
}

async function evaluateQuerySafety(
  query: string,
  apiKey: string,
  filters: { porn: boolean; violence: boolean; selfHarm: boolean; illegal: boolean },
  customTerms: string[] = [],
  emitLog?: (level: 'info' | 'warn' | 'block' | 'allow', msg: string) => void
): Promise<{ isUnsafe: boolean, category: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  let topics: string[] = [];
  if (filters.porn) topics.push("pornography/adult content");
  if (filters.violence) topics.push("severe violence/gore/terrorist activities");
  if (filters.selfHarm) topics.push("self-harm/suicide instructions");
  if (filters.illegal) topics.push("illegal acts/weapons/hacking guides");
  if (customTerms.length > 0) topics.push(`any of these specific blocked terms/topics: ${customTerms.join(', ')}`);

  if (topics.length === 0) {
    emitLog?.('warn', 'LAYER 2 SKIPPED — No filter categories enabled')
    return { isUnsafe: false, category: "" };
  }

  // Load admin-supplied extra context
  const customContext = db.prepare("SELECT value FROM settings WHERE key = 'ai_custom_context'").get()?.value || ''
  const contextLine = customContext.trim() ? `\nAdditional instructions from administrator: ${customContext.trim()}` : ''

  const prompt = `You are a safety filter for a cybercafe. Analyze this search query and decide if it is unsafe or violates safety rules. Unsafe topics to filter: ${topics.join(", ")}.${contextLine}
  Respond strictly in JSON format:
  {
    "isUnsafe": true or false,
    "category": "Reason/category if unsafe, otherwise empty string"
  }
  Query: "${query}"`;

  emitLog?.('info', `LAYER 2: Sending to Gemini (${topics.length} categories active)${customContext.trim() ? ' + custom context' : ''}`)
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    emitLog?.('info', `LAYER 2: Gemini responded (HTTP ${res.status})`)
    if (res.ok) {
      const data: any = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // Clean JSON formatting if enclosed in code blocks
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } else {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
  } catch (e: any) {
    console.error('Gemini API call failed:', e);
    throw e;
  }
}

ipcMain.handle('get-server-logs', () => {
  return serverLogsCache
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

ipcMain.handle('set-fullscreen', (_, flag: boolean) => {
  if (mainWindow) {
    mainWindow.setFullScreen(flag)
    mainWindow.setMenuBarVisibility(!flag)
  }
})

ipcMain.handle('set-active-mirror', (_, machineId: number | null) => {
  const targetId = machineId !== null ? Number(machineId) : null
  if (activeMirrorMachineId !== null && activeMirrorMachineId !== targetId) {
    sendCommandToMachine(activeMirrorMachineId, { command: 'set-mirror-quality', payload: { highRes: false } })
  }
  activeMirrorMachineId = targetId
  if (activeMirrorMachineId !== null) {
    sendCommandToMachine(activeMirrorMachineId, { command: 'set-mirror-quality', payload: { highRes: true } })
  }
  return { success: true }
})

ipcMain.handle('set-fullscreen-mirror', (_, machineId: number | null) => {
  const targetId = machineId !== null ? Number(machineId) : null
  if (targetId !== null) {
    sendCommandToMachine(targetId, { command: 'set-mirror-quality', payload: { highRes: true, ultraRes: true } })
    logToUI(`Ultra-res mirror activated for machine ${targetId}`)
  } else if (activeMirrorMachineId !== null) {
    // Exiting fullscreen — revert to highRes
    sendCommandToMachine(activeMirrorMachineId, { command: 'set-mirror-quality', payload: { highRes: true, ultraRes: false } })
  }
  return { success: true }
})

ipcMain.handle('toggle-hardware-lock', (_, machineId, block: boolean) => {
  db.prepare("UPDATE machines SET hardware_locked = ? WHERE id = ?").run(block ? 1 : 0, machineId)
  sendCommandToMachine(machineId, { command: 'block-inputs', payload: { block } })
  broadcastMachines()
  return { success: true }
})

ipcMain.handle('get-session-app-logs', (_, sessionId) => {
  if (!db) return []
  return db.prepare("SELECT * FROM session_app_logs WHERE session_id = ? ORDER BY duration_seconds DESC").all(sessionId)
})

ipcMain.handle('get-session-process-events', (_, sessionId) => {
  if (!db) return []
  return db.prepare('SELECT * FROM session_process_events WHERE session_id = ? ORDER BY id DESC LIMIT 500').all(sessionId)
})
