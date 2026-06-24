import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { fileURLToPath } from 'url'
import net from 'net'
import fs from 'fs'
import Database from 'better-sqlite3'
import os from 'os'
import dgram from 'dgram'
import { exec, spawn } from 'child_process'
import * as XLSX from 'xlsx'
import express from 'express'

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Monkeypatch ipcMain.handle to collect all registered IPC handlers for the LAN web control panel
const ipcRegistry = new Map<string, Function>();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel: string, handler: Function) => {
  ipcRegistry.set(channel, handler);
  return originalHandle(channel, handler);
};

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IS_DEVELOPER_MODE = true;

let mainWindow: BrowserWindow | null = null

// Initialize SQLite Database
let db: any = null;
const dbFolder = process.platform === 'win32' ? 'C:\\NetCafe' : app.getPath('userData');
const dbPath = path.join(dbFolder, 'netcafe.db');

function refundLeftoverPrepaidTime(sessionId: number) {
  if (!db) return
  try {
    const sess = db.prepare(`
      SELECT s.id, s.customer_name, s.mode, s.status, s.custom_duration, 
             strftime('%s', s.start_time) as start_time_epoch,
             s.paused_duration
      FROM sessions s
      WHERE s.id = ?
    `).get(sessionId) as any

    if (!sess || sess.mode !== 'prepaid') return

    let elapsedSeconds = 0
    const nowEpoch = Math.floor(Date.now() / 1000)
    const startEpoch = Number(sess.start_time_epoch)

    if (sess.status === 'paused' && sess.paused_duration) {
      elapsedSeconds = Number(sess.paused_duration) - startEpoch
    } else {
      elapsedSeconds = nowEpoch - startEpoch
    }

    if (elapsedSeconds < 0) elapsedSeconds = 0

    const totalMinutes = sess.custom_duration || 0
    const totalSeconds = totalMinutes * 60
    const remainingSeconds = totalSeconds - elapsedSeconds
    const remainingMinutes = Math.max(0, Math.floor(remainingSeconds / 60))

    if (remainingMinutes > 0) {
      const user = db.prepare('SELECT id, username, balance_minutes FROM users WHERE username = ? OR display_name = ?').get(sess.customer_name, sess.customer_name) as any
      if (user) {
        const newBalance = user.balance_minutes + remainingMinutes
        db.prepare('UPDATE users SET balance_minutes = ? WHERE id = ?').run(newBalance, user.id)
        logToUI(`[Refund] Refunded ${remainingMinutes} leftover minutes to user "${user.username}" (New balance: ${newBalance} mins).`)
      } else {
        logToUI(`[Refund] No matching user found for customer name "${sess.customer_name}" to refund ${remainingMinutes} mins.`)
      }
    }
  } catch (err: any) {
    console.error('Error refunding leftover prepaid time:', err)
  }
}

function setupDatabase() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,        -- 'message' | 'alert' | 'announcement'
      title        TEXT,                 -- used by alert state
      body         TEXT NOT NULL,
      from_label   TEXT DEFAULT 'Lab Admin',
      target       TEXT DEFAULT 'all',   -- 'all' | machine_id
      send_at      INTEGER,              -- unix timestamp, NULL = send immediately
      sent         INTEGER DEFAULT 0,    -- 0 = pending, 1 = sent
      created_at   INTEGER DEFAULT (strftime('%s','now'))
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_times (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      open_time    TEXT DEFAULT '08:00',   -- HH:MM
      close_time   TEXT DEFAULT '21:00',   -- HH:MM
      warn_minutes INTEGER DEFAULT 5,      -- minutes before close to send alert
      repeat_days  TEXT DEFAULT '1,2,3,4,5' -- comma-separated 1=Mon..7=Sun
    );
  `)
  db.exec(`INSERT OR IGNORE INTO scheduled_times (id) VALUES (1);`)

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ad_no TEXT,
      class TEXT
    );
  `)
  try {
    db.exec("ALTER TABLE users ADD COLUMN ad_no TEXT;")
  } catch {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN class TEXT;")
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN custom_duration INTEGER;")
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN discount REAL DEFAULT 0;")
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN penalty_amount REAL DEFAULT 0;")
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
  // Violation count for progressive enforcement (warn first, lock on repeat)
  try {
    db.exec("ALTER TABLE machines ADD COLUMN violation_count INTEGER DEFAULT 0;")
  } catch {}
  try {
    db.exec("ALTER TABLE machines ADD COLUMN version TEXT DEFAULT '1.0.76';")
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
      user_details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  try {
    db.exec("ALTER TABLE safety_alerts ADD COLUMN user_details TEXT;")
  } catch {}

  // Create member search logs table (Case Sensitive queries, URLs, and target website IPs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      query TEXT,
      url TEXT,
      ip TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
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
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_provider', 'gemini');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('openrouter_api_key', '');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('openrouter_model', 'google/gemini-2.5-flash');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('openrouter_url', 'https://openrouter.ai/api/v1/chat/completions');")
  // Operator (client-side) PIN password
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('operator_password', 'admin');")

  // Create safe queries table (Non-Violation List)
  db.exec(`
    CREATE TABLE IF NOT EXISTS safe_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE NOT NULL
    );
  `)

  // Create blocked queries table (Blacklist)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE NOT NULL
    );
  `)

  // Create update log table for tracking remote agent update progress
  db.exec(`
    CREATE TABLE IF NOT EXISTS update_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT NOT NULL,
      stage      TEXT NOT NULL,
      message    TEXT,
      version    TEXT,
      percent    INTEGER,
      timestamp  INTEGER DEFAULT (strftime('%s','now'))
    );
  `)

  // Default violation penalty in minutes
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('violation_penalty_minutes', '5');")
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('violation_penalty_fee', '50');")

  // Clear legacy block rules so they do not cause silent blocks without a configuration interface
  try {
    db.exec("DELETE FROM block_rules;");
  } catch {}


  // Refund and complete any active sessions at startup, set machines to available so they lock
  try {
    const activeSessions = db.prepare("SELECT id FROM sessions WHERE end_time IS NULL").all() as any[]
    for (const s of activeSessions) {
      refundLeftoverPrepaidTime(s.id)
    }
    db.prepare("UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE end_time IS NULL").run()
    db.prepare("UPDATE machines SET status = 'available' WHERE status != 'offline'").run()
  } catch (err: any) {
    console.error('Error cleaning up active sessions on startup:', err)
  }
}

// TCP Server & Metrics Maps
const tcpServer = net.createServer()
const clients = new Map<net.Socket, number>() // socket -> machine.id
const clientMetrics = new Map<number, { cpu: number, ram: number, activeWindow: string, os: string, ip: string, uptime: number, version?: string }>()
const pendingScreenshots = new Map<number, { resolve: (val: string) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>()
const latestScreenFrames = new Map<number, string>()
let activeMirrorMachineId: number | null = null;
let activeFullscreenMachineId: number | null = null;

const studentReplies: { machine_id: number, machine_name: string, text: string, timestamp: string }[] = [];
let lastClosingWarningSentDate = '';

function isLocalIp(ip?: string): boolean {
  if (!ip) return false
  const normalized = ip.trim().toLowerCase()
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1') {
    return true
  }
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.address && net.address.toLowerCase() === normalized) {
        return true
      }
    }
  }
  return false
}

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
  if (!db) {
    logToUI("Error: DB not initialized yet")
    return
  }
  if (data.event === 'update-status') {
    const machineId = clients.get(socket);
    if (!machineId) return;

    // Log to DB
    db.prepare(`
      INSERT INTO update_log (machine_id, stage, message, version, percent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      machineId.toString(),
      data.stage,
      data.message,
      data.version || null,
      data.percent || null,
      Date.now()
    );

    // Forward to admin dashboard renderer via IPC
    if (mainWindow && !mainWindow.isDestroyed()) {
      const machine = db.prepare("SELECT name FROM machines WHERE id = ?").get(machineId) as any;
      mainWindow.webContents.send('update-status', {
        machineId: machineId,
        machineName: machine ? machine.name : `PC-${machineId}`,
        stage: data.stage,
        message: data.message,
        version: data.version,
        percent: data.percent,
        timestamp: Date.now(),
      });
    }
    return;
  }
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
      const stmt = db.prepare("INSERT INTO machines (name, mac_address, uuid, ip_address, status, version) VALUES (?, ?, ?, ?, ?, ?)")
      // For cloned machines sharing a UUID/MAC, store null so they don't collide
      let storeUuid: string | null = payload.uuid || null
      let storeMac: string | null = payload.mac_address || null
      // Check if uuid/mac already in use by another machine
      if (storeUuid && db.prepare("SELECT id FROM machines WHERE uuid = ?").get(storeUuid)) storeUuid = null
      if (storeMac && db.prepare("SELECT id FROM machines WHERE mac_address = ?").get(storeMac)) storeMac = null
      const info = stmt.run(payload.name || 'New PC', storeMac, storeUuid, incomingIp, 'available', payload.version || '1.0.76')
      machine = { id: info.lastInsertRowid }
      logToUI(`Registered new machine in DB: Name=${payload.name || 'New PC'}, Mac=${payload.mac_address}, UUID=${payload.uuid || 'N/A'}, IP=${incomingIp}, Version=${payload.version || '1.0.76'}`)
    } else {
      const activeSession = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machine.id)
      const currentStatus = activeSession ? 'in_use' : 'available'
      db.prepare("UPDATE machines SET name = ?, ip_address = ?, status = ?, uuid = COALESCE(uuid, ?), version = ? WHERE id = ?").run(payload.name || machine.name, incomingIp, currentStatus, payload.uuid || null, payload.version || '1.0.76', machine.id)
      logToUI(`Client reconnected: ID=${machine.id}, Name=${payload.name || machine.name}, Status=${currentStatus}, IP=${incomingIp}, Version=${payload.version || '1.0.76'}`)
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

    // Look up active session
    const activeSession = db.prepare(`
      SELECT s.*, p.duration_minutes as plan_duration, p.price
      FROM sessions s
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE s.machine_id = ? AND s.end_time IS NULL
    `).get(machine.id)

    if (activeSession) {
      let sessionUsername = ''
      if (activeSession.mode === 'prepaid') {
        const u = db.prepare("SELECT username FROM users WHERE username = ? OR display_name = ?").get(activeSession.customer_name, activeSession.customer_name) as any
        if (u) sessionUsername = u.username
      }
      socket.write(JSON.stringify({
        command: 'unlock',
        user: activeSession.customer_name || 'Guest',
        session: {
          startTime: activeSession.start_time,
          mode: activeSession.mode || 'postpaid',
          durationMinutes: activeSession.custom_duration || activeSession.plan_duration || null,
          planPrice: activeSession.price || null,
          customDuration: activeSession.custom_duration || null,
          user: activeSession.customer_name || 'Guest',
          username: sessionUsername
        }
      }) + '\n')
    } else {
      socket.write(JSON.stringify({ command: 'lock' }) + '\n')
    }

    // Send mirror quality setting
    let highRes = false
    let ultraRes = false
    if (Number(machine.id) === activeFullscreenMachineId) {
      highRes = true
      ultraRes = true
    } else if (Number(machine.id) === activeMirrorMachineId) {
      highRes = true
      ultraRes = false
    }
    socket.write(JSON.stringify({
      command: 'set-mirror-quality',
      payload: { highRes, ultraRes }
    }) + '\n')

    broadcastMachines()
  }
  else if (data.type === 'student-reply') {
    const machineId = clients.get(socket);
    if (machineId) {
      const machine = db.prepare("SELECT name FROM machines WHERE id = ?").get(machineId) as any;
      const machineName = machine ? machine.name : `PC-${machineId}`;
      const text = data.payload?.text || '';
      
      const replyObj = {
        machine_id: machineId,
        machine_name: machineName,
        text: text,
        timestamp: new Date().toLocaleTimeString()
      };
      
      studentReplies.push(replyObj);
      if (studentReplies.length > 50) studentReplies.shift();
      
      // Forward to admin UI if running in Electron
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('student-reply', replyObj);
      }
      
      logToUI(`[Student Reply] ${machineName}: ${text}`);
    }
  }
  else if (data.type === 'get-profile-data') {
    const machineId = clients.get(socket);
    if (machineId) {
      // Fetch dynamic profile data for the active user/session on this machine
      const activeSess = db.prepare("SELECT * FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any;
      const customerName = activeSess ? activeSess.customer_name : 'Guest';
      const sessionId = activeSess ? activeSess.id : null;

      // 1. Fetch Activity
      let activity: any[] = [];
      if (sessionId) {
        // Fetch top apps
        const appLogs = db.prepare("SELECT app_title, duration_seconds FROM session_app_logs WHERE session_id = ? ORDER BY duration_seconds DESC LIMIT 2").all(sessionId) as any[];
        appLogs.forEach(app => {
          const mins = Math.round(app.duration_seconds / 60);
          activity.push({
            label: "App Usage",
            value: `${app.app_title} (${mins}m)`
          });
        });

        // Fetch safety alerts count
        const alertCount = db.prepare("SELECT COUNT(*) as cnt FROM safety_alerts WHERE machine_id = ?").get(machineId) as any;
        if (alertCount && alertCount.cnt > 0) {
          activity.push({
            label: "Safety Interceptions",
            value: `${alertCount.cnt} violations`,
            color: "#f87171"
          });
        }
      }
      
      if (activity.length === 0) {
        activity = [
          { label: "Session status", value: activeSess ? "Active (No flagged acts)" : "No session" },
          { label: "Last safety check", value: "Just now (OK)" }
        ];
      }

      // 2. Fetch Sessions history
      let sessions: any[] = [];
      if (customerName && customerName !== 'Guest') {
        const history = db.prepare(`
          SELECT start_time, total_amount, (strftime('%s', COALESCE(end_time, datetime('now'))) - strftime('%s', start_time)) as duration
          FROM sessions
          WHERE customer_name = ?
          ORDER BY start_time DESC
          LIMIT 3
        `).all(customerName) as any[];

        if (history.length > 0) {
          history.forEach((h, idx) => {
            const dateLabel = idx === 0 ? "Current Session" : new Date(h.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' });
            const mins = Math.round(h.duration / 60);
            const hrs = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            const durStr = hrs > 0 ? `${hrs}h ${remainingMins}m` : `${remainingMins}m`;
            sessions.push({
              label: dateLabel,
              value: durStr
            });
          });
        }
      }

      if (sessions.length === 0) {
        sessions = [
          { label: "Current Session", value: activeSess ? "Active" : "No active session" },
          { label: "Previous sessions", value: "None found" }
        ];
      }

      // 3. Fetch Usage graph data (Weekly & Monthly)
      const weeklyUsage = [
        { label: 'Mon', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Tue', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Wed', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Thu', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Fri', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Sat', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Sun', time: '0h 00m', value: 0, pct: 0 }
      ];

      const monthlyUsage = [
        { label: 'Wk 1', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Wk 2', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Wk 3', time: '0h 00m', value: 0, pct: 0 },
        { label: 'Wk 4', time: '0h 00m', value: 0, pct: 0 }
      ];

      if (customerName && customerName !== 'Guest') {
        try {
          const weekRows = db.prepare(`
            SELECT strftime('%w', start_time) as day_idx, SUM(strftime('%s', COALESCE(end_time, datetime('now'))) - strftime('%s', start_time)) as sec
            FROM sessions
            WHERE customer_name = ? AND start_time >= datetime('now', '-7 days')
            GROUP BY day_idx
          `).all(customerName) as any[];

          const dayMap = [6, 0, 1, 2, 3, 4, 5];
          let maxSec = 1;
          weekRows.forEach(row => {
            const idx = dayMap[Number(row.day_idx)];
            if (idx >= 0 && idx < 7) {
              const sec = Number(row.sec);
              if (sec > maxSec) maxSec = sec;
              const mins = Math.round(sec / 60);
              const hrs = Math.floor(mins / 60);
              const rem = mins % 60;
              weeklyUsage[idx].value = mins;
              weeklyUsage[idx].time = hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
            }
          });

          weeklyUsage.forEach(d => {
            const secVal = d.value * 60;
            d.pct = Math.min(100, Math.round((secVal / maxSec) * 100));
          });

          const monthRows = db.prepare(`
            SELECT strftime('%d', start_time) as day_of_month, SUM(strftime('%s', COALESCE(end_time, datetime('now'))) - strftime('%s', start_time)) as sec
            FROM sessions
            WHERE customer_name = ? AND start_time >= datetime('now', '-30 days')
            GROUP BY day_of_month
          `).all(customerName) as any[];

          let maxMins = 1;
          monthRows.forEach(row => {
            const dom = Number(row.day_of_month);
            let wkIdx = 3;
            if (dom <= 7) wkIdx = 0;
            else if (dom <= 14) wkIdx = 1;
            else if (dom <= 21) wkIdx = 2;
            
            const mins = Math.round(Number(row.sec) / 60);
            monthlyUsage[wkIdx].value += mins;
          });

          monthlyUsage.forEach(d => {
            if (d.value > maxMins) maxMins = d.value;
            const hrs = Math.floor(d.value / 60);
            const rem = d.value % 60;
            d.time = hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
          });

          monthlyUsage.forEach(d => {
            d.pct = Math.min(100, Math.round((d.value / maxMins) * 100));
          });
        } catch (e) {
          console.error("Failed to construct usage data:", e);
        }
      }

      socket.write(JSON.stringify({
        command: 'profile-data-response',
        payload: {
          customerName,
          activity,
          sessions,
          usage: {
            weekly: weeklyUsage,
            monthly: monthlyUsage
          }
        }
      }) + '\n');
    }
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
        resolution: data.payload.resolution || { width: 1920, height: 1080 },
        version: data.payload.version || '1.0.0'
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
          const title = (data.payload.activeWindow || '').trim()
          let query = ''
          
          const googleMatch = title.match(/^(.*?)(?: - Google Search)(?: - (?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Safari|Internet Explorer))?$/i)
          const youtubeMatch = title.match(/^(.*?)(?: - YouTube)(?: - (?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Safari|Internet Explorer))?$/i)
          const bingMatch = title.match(/^(.*?)(?: - Bing)(?: - (?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Safari|Internet Explorer))?$/i)
          const yahooMatch = title.match(/^(.*?)(?: - Yahoo Search| \| Yahoo Search Results)(?: - (?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Safari|Internet Explorer))?$/i)

          if (googleMatch) {
            query = googleMatch[1].trim()
          } else if (youtubeMatch) {
            query = youtubeMatch[1].trim()
          } else if (bingMatch) {
            query = bingMatch[1].trim()
          } else if (yahooMatch) {
            query = yahooMatch[1].trim()
          }

          if (query && query.trim()) {
            const lastQuery = lastCheckedQueries.get(Number(machineId))
            if (lastQuery !== query) {
              lastCheckedQueries.set(Number(machineId), query)
              const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })

              // Emit live filter log: new query received
              if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'info', message: `NEW QUERY from machine ${Number(machineId)}: "${query}"`, machineId: Number(machineId), query })

              // Safe Queries (Non-Violation List) check first
              const cleanQ = query.trim().toLowerCase()
              const safeQueryRow = db.prepare("SELECT 1 FROM safe_queries WHERE lower(query) = ?").get(cleanQ)
              if (safeQueryRow) {
                if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'allow', message: `LAYER 1 SAFE LIST PASSED — Safe query "${query}" matched`, machineId: Number(machineId), query })
                // Skip further safety checks for safe queries
              } else {
                // Layer 1 blacklist check (exact & substring)
                const isBlockedExact = db.prepare("SELECT 1 FROM blocked_queries WHERE lower(query) = ?").get(cleanQ)
                const blacklistRows = db.prepare("SELECT query FROM blocked_queries").all() as any[]
                const matchedTerm = isBlockedExact ? cleanQ : blacklistRows.find(r => r.query && cleanQ.includes(r.query.toLowerCase()))?.query
                
                if (matchedTerm) {
                  logToUI(`Safety Guard BLACKLIST MATCH on machine ID ${Number(machineId)}: "${query}" matched blacklist entry "${matchedTerm}"`)
                  
                  let windowHitUserDetails = 'Walk-in User'
                  try {
                    const activeSess = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(Number(machineId)) as any
                    if (activeSess?.customer_name) windowHitUserDetails = activeSess.customer_name
                  } catch {}

                  if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'block', message: `LAYER 1 BLOCKED — Blacklist term "${matchedTerm}" matched — User: "${windowHitUserDetails}"`, machineId: Number(machineId), query })
                  enforceViolation(Number(machineId), query, `Blacklist term: "${matchedTerm}"`, windowHitUserDetails, (lvl, msg) => {
                    if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: lvl, message: msg, machineId: Number(machineId), query })
                  })
                } else {
                  if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level: 'allow', message: `LAYER 1 PASSED — No blacklist match for "${query}"`, machineId: Number(machineId), query })
                  
                  const filterPorn = db.prepare("SELECT value FROM settings WHERE key = 'filter_porn'").get()?.value !== 'false';
                  const filterViolence = db.prepare("SELECT value FROM settings WHERE key = 'filter_violence'").get()?.value !== 'false';
                  const filterSelfHarm = db.prepare("SELECT value FROM settings WHERE key = 'filter_self_harm'").get()?.value !== 'false';
                  const filterIllegal = db.prepare("SELECT value FROM settings WHERE key = 'filter_illegal'").get()?.value !== 'false';
                  checkQuerySafety(Number(machineId), query, apiKey, {
                    porn: filterPorn,
                    violence: filterViolence,
                    selfHarm: filterSelfHarm,
                    illegal: filterIllegal
                  })
                }
              }
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
  else if (data.type === 'browser-query') {
    // Real-time query intercepted by the MITM proxy running on the client
    const machineId = clients.get(socket)
    if (!machineId || !db) return
    const query: string = data.payload?.query || ''
    if (!query || query.length < 2) return

    const aiEnabled = db.prepare("SELECT value FROM settings WHERE key = 'ai_safety_enabled'").get() as any
    const apiKey    = (db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get() as any)?.value || ''
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })

    // Don't re-check the same query from the same machine repeatedly
    const lastQ = lastCheckedQueries.get(Number(machineId))
    if (lastQ === query) return
    lastCheckedQueries.set(Number(machineId), query)

    if (mainWindow) mainWindow.webContents.send('filter-log', {
      timestamp: ts, level: 'info',
      message: `[MITM] Real-time intercept — Machine ${machineId}: "${query}"`,
      machineId: Number(machineId), query
    })

    // Layer 1: blacklist check (exact & substring)
    const cleanQ = query.trim().toLowerCase();
    const isBlockedExact = db.prepare("SELECT 1 FROM blocked_queries WHERE lower(query) = ?").get(cleanQ);
    const blacklistRows = db.prepare("SELECT query FROM blocked_queries").all() as any[];
    const hit = isBlockedExact ? cleanQ : blacklistRows.find(r => r.query && cleanQ.includes(r.query.toLowerCase()))?.query;
    if (hit) {
      // Resolve active user for this machine
      let hitUserDetails = 'Walk-in User';
      try {
        const activeSess = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(Number(machineId)) as any;
        if (activeSess?.customer_name) hitUserDetails = activeSess.customer_name;
      } catch {}

      if (mainWindow) mainWindow.webContents.send('filter-log', {
        timestamp: ts, level: 'block',
        message: `[MITM] ❌ LAYER 1 BLOCKED — term: "${hit}" — User: "${hitUserDetails}" — locking Machine ${machineId}`,
        machineId: Number(machineId), query
      });
      db.prepare("INSERT INTO safety_alerts (machine_id, query, reason, user_details) VALUES (?, ?, ?, ?)").run(Number(machineId), query, `Custom term: "${hit}"`, hitUserDetails);

      // Progressive enforcement: 1st violation = Dynamic Island warning only, 2nd+ = full lock
      const machineRow = db.prepare("SELECT violation_count FROM machines WHERE id = ?").get(Number(machineId)) as any;
      const violCount = (machineRow?.violation_count || 0) + 1;
      db.prepare("UPDATE machines SET violation_count = ? WHERE id = ?").run(violCount, Number(machineId));

      if (violCount === 1) {
        // First offence — warn only via Dynamic Island
        sendCommandToMachine(Number(machineId), { command: 'message', payload: `⚠️ Safety Violation Warning: Your search "${hit}" is not allowed. This is your first warning. Further violations will lock your terminal.` });
        if (mainWindow) mainWindow.webContents.send('safety-alert-triggered', { machineId: Number(machineId), query, reason: `Custom term: "${hit}"`, userDetails: hitUserDetails, warned: true });
        broadcastMachines();
        if (!socket.destroyed) socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId: '', allowed: false } }) + '\n');
      } else {
        // Repeat offence — lock machine
        sendCommandToMachine(Number(machineId), { command: 'lock' });
        sendCommandToMachine(Number(machineId), { command: 'message', payload: `Terminal locked: repeated blocked search detected ("${hit}"). Please visit the Lab In-Charge to continue.` });
        if (mainWindow) mainWindow.webContents.send('safety-alert-triggered', { machineId: Number(machineId), query, reason: `Custom term: "${hit}"`, userDetails: hitUserDetails });
        broadcastMachines();
      }
      return;
    }

    // Layer 2: Gemini / OpenRouter AI check (only if API key configured)
    const provider = db.prepare("SELECT value FROM settings WHERE key = 'ai_provider'").get()?.value || 'gemini';
    const openRouterKey = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'").get()?.value || '';
    const isConfigured = provider === 'openrouter' ? !!openRouterKey : !!apiKey;
    if (!isConfigured) return;
    const filterPorn     = (db.prepare("SELECT value FROM settings WHERE key = 'filter_porn'").get() as any)?.value !== 'false';
    const filterViolence = (db.prepare("SELECT value FROM settings WHERE key = 'filter_violence'").get() as any)?.value !== 'false';
    const filterSelfHarm = (db.prepare("SELECT value FROM settings WHERE key = 'filter_self_harm'").get() as any)?.value !== 'false';
    const filterIllegal  = (db.prepare("SELECT value FROM settings WHERE key = 'filter_illegal'").get() as any)?.value !== 'false';
    checkQuerySafety(Number(machineId), query, apiKey, {
      porn: filterPorn, violence: filterViolence, selfHarm: filterSelfHarm, illegal: filterIllegal
    });
  }
  else if (data.type === 'query-check-request') {
    const machineId = clients.get(socket)
    logToUI(`[MITM] Received query-check-request: machineId=${machineId}, db=${!!db}`)
    if (!machineId || !db) return
    const query: string = data.payload?.query || ''
    const url: string = data.payload?.url || ''
    const ip: string = data.payload?.ip || ''
    const requestId: string = data.payload?.requestId || ''
    const isUserInitiated: boolean = data.payload?.isUserInitiated !== false

    const activeSession = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
    if (activeSession && query && isUserInitiated) {
      try {
        db.prepare("INSERT INTO member_search_logs (session_id, query, url, ip) VALUES (?, ?, ?, ?)").run(activeSession.id, query, url, ip)
      } catch (err: any) {
        console.error('Failed to log search query:', err)
      }
    }
    
    // Check if AI safety is enabled
    const safetyEnabled = (db.prepare("SELECT value FROM settings WHERE key = 'ai_safety_enabled'").get() as any)?.value === 'true'
    if (!safetyEnabled) {
      logToUI(`[MITM] Safety filter disabled, allowing query "${query}" (Machine ${machineId})`)
      if (!socket.destroyed) {
        socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: true } }) + '\n')
      }
      return
    }

    if (!query || query.length < 2) {
      if (!socket.destroyed) {
        socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: true } }) + '\n')
      }
      return
    }

    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
    const emitLog = (level: 'info' | 'warn' | 'block' | 'allow', message: string) => {
      logToUI(`Safety Guard (Check): ${message}`)
      if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts, level, message, machineId: Number(machineId), query })
    }

    emitLog('info', `[MITM] Check request — Machine ${machineId}: "${query}" (ID: ${requestId})`)

    // Safe Queries (Non-Violation List) check first
    const cleanQ = query.trim().toLowerCase()
    const isSafe = db.prepare("SELECT 1 FROM safe_queries WHERE lower(query) = ?").get(cleanQ)
    if (isSafe) {
      emitLog('allow', `[MITM] SAFE LIST MATCHED — Query "${query}" is safe`)
      if (!socket.destroyed) {
        socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: true, message: 'Query allowed by Safe List / AI' } }) + '\n')
      }
      return
    }

    // Layer 1: Blacklist check (exact & substring)
    const isBlockedExact = db.prepare("SELECT 1 FROM blocked_queries WHERE lower(query) = ?").get(cleanQ)
    const blacklistRows = db.prepare("SELECT query FROM blocked_queries").all() as any[]
    const hit = isBlockedExact ? cleanQ : blacklistRows.find(r => r.query && cleanQ.includes(r.query.toLowerCase()))?.query

    const apiKey = (db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get() as any)?.value || ''
    if (hit) {
      // Resolve active user for this machine
      let hitUserDetails2 = 'Walk-in User'
      try {
        const activeSess = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(Number(machineId)) as any
        if (activeSess?.customer_name) hitUserDetails2 = activeSess.customer_name
      } catch {}

      if (isUserInitiated) {
        emitLog('block', `[MITM] ❌ LAYER 1 BLOCKED — Blacklist term: "${hit}" — User: "${hitUserDetails2}"`)
        enforceViolation(Number(machineId), query, `Blacklist term: "${hit}"`, hitUserDetails2, emitLog)
      } else {
        emitLog('block', `[MITM] ❌ LAYER 1 BLOCKED (BACKGROUND) — Blacklist term: "${hit}" — User: "${hitUserDetails2}" — Blocked silently`)
      }

      if (!socket.destroyed) {
        socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: false, serverIssue: false } }) + '\n')
      }
      return
    }

    // Layer 2: Gemini / OpenRouter AI check (only if API key configured)
    const provider = db.prepare("SELECT value FROM settings WHERE key = 'ai_provider'").get()?.value || 'gemini';
    const openRouterKey = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'").get()?.value || '';
    const isConfigured = provider === 'openrouter' ? !!openRouterKey : !!apiKey;
    if (!isConfigured) {
      emitLog('allow', `[MITM] LAYER 2 SKIPPED — No API key configured for ${provider}`);
      if (!socket.destroyed) {
        socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: true } }) + '\n');
      }
      return;
    }

    const filterPorn     = (db.prepare("SELECT value FROM settings WHERE key = 'filter_porn'").get() as any)?.value !== 'false';
    const filterViolence = (db.prepare("SELECT value FROM settings WHERE key = 'filter_violence'").get() as any)?.value !== 'false';
    const filterSelfHarm = (db.prepare("SELECT value FROM settings WHERE key = 'filter_self_harm'").get() as any)?.value !== 'false';
    const filterIllegal  = (db.prepare("SELECT value FROM settings WHERE key = 'filter_illegal'").get() as any)?.value !== 'false';

    // Run AI evaluation asynchronously so we don't block the main event loop
    (async () => {
      try {
        emitLog('info', `[MITM] LAYER 2: Evaluating query safety via Gemini for Machine ${machineId}: "${query}"`)
        const result = await evaluateQuerySafety(query, apiKey, {
          porn: filterPorn, violence: filterViolence, selfHarm: filterSelfHarm, illegal: filterIllegal
        }, [], emitLog)

        if (result.isUnsafe) {
          // Auto add to blacklist
          try {
            db.prepare("INSERT OR IGNORE INTO blocked_queries (query) VALUES (?)").run(cleanQ);
            logToUI(`[Safety Guard] Automatically added "${cleanQ}" to Blocked Queries (Blacklist)`);
          } catch (dbErr) {
            console.error('Failed to auto-blacklist query:', dbErr);
          }

          // Resolve active user
          let l2UserDetails = 'Walk-in User'
          try {
            const activeSess = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(Number(machineId)) as any
            if (activeSess?.customer_name) l2UserDetails = activeSess.customer_name
          } catch {}

          if (isUserInitiated) {
            emitLog('block', `[MITM] ❌ LAYER 2 UNSAFE — User: "${l2UserDetails}" — Category: "${result.category}"`)
            enforceViolation(Number(machineId), query, result.category || 'Unsafe content', l2UserDetails, emitLog)
          } else {
            emitLog('block', `[MITM] ❌ LAYER 2 UNSAFE (BACKGROUND) — User: "${l2UserDetails}" — Category: "${result.category}" — Blocked silently`)
          }

          if (!socket.destroyed) {
            socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: false, serverIssue: false } }) + '\n')
          }
        } else {
          // Auto add to whitelist
          try {
            db.prepare("INSERT OR IGNORE INTO safe_queries (query) VALUES (?)").run(cleanQ);
            logToUI(`[Safety Guard] Automatically added "${cleanQ}" to Safe Queries (Whitelist)`);
          } catch (dbErr) {
            console.error('Failed to auto-whitelist query:', dbErr);
          }

          emitLog('allow', `[MITM] LAYER 2 ALLOWED — Query "${query}" is safe (${result.reason || 'No issues'})`)
          if (!socket.destroyed) {
            socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: true, message: 'Query allowed by AI safety check' } }) + '\n')
          }
        }
      } catch (err: any) {
        emitLog('warn', `[MITM] LAYER 2 ERROR: ${err.message}. Showing Server Issue fallback page.`)
        console.error('Safety check failed:', err)
        if (!socket.destroyed) {
          socket.write(JSON.stringify({ type: 'query-check-response', payload: { query, requestId, allowed: false, serverIssue: true } }) + '\n')
        }
      }
    })()
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
        const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
        if (activeSess) {
          refundLeftoverPrepaidTime(activeSess.id)
        }
        db.prepare(`UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE machine_id = ? AND end_time IS NULL`).run(machineId)
        // Open a new prepaid session using the user's full balance
        db.prepare(`
          INSERT INTO sessions (machine_id, customer_name, plan_id, start_time, mode, status, custom_duration)
          VALUES (?, ?, NULL, datetime('now', '+9 seconds'), 'prepaid', 'active', ?)
        `).run(machineId, user.username, user.balance_minutes)
        db.prepare("UPDATE machines SET status = 'in_use' WHERE id = ?").run(machineId)
        // Deduct balance
        db.prepare('UPDATE users SET balance_minutes = 0 WHERE id = ?').run(user.id)
        socket.write(JSON.stringify({ command: 'login-success', user: user.display_name || user.username, username: user.username, duration: user.balance_minutes }) + '\n')
        broadcastMachines()
      }
    }
  }
  else if (data.type === 'change-member-password') {
    const machineId = clients.get(socket);
    if (machineId && db) {
      const { username, oldPassword, newPassword } = data.payload || {};
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, oldPassword) as any;
      if (!user) {
        socket.write(JSON.stringify({ command: 'change-password-fail', message: 'Incorrect current password.' }) + '\n');
      } else {
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, user.id);
        socket.write(JSON.stringify({ command: 'change-password-success', message: 'Password updated successfully!' }) + '\n');
        emitLog('info', `Member ${username} updated their password successfully.`);
      }
    }
  }
  else if (data.type === 'client-request-close') {
    const machineId = clients.get(socket)
    if (machineId && db) {
      const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
      if (activeSess) {
        refundLeftoverPrepaidTime(activeSess.id)
      }
      db.prepare("UPDATE machines SET status = 'available' WHERE id = ?").run(machineId)
      db.prepare(`
        UPDATE sessions 
        SET end_time = datetime('now'), 
            status = 'completed' 
        WHERE machine_id = ? AND end_time IS NULL
      `).run(machineId)
      socket.write(JSON.stringify({ command: 'lock' }) + '\n')
      broadcastMachines()
    }
  }
  else if (data.type === 'agent-log' && IS_DEVELOPER_MODE) {
    const machineId = clients.get(socket)
    if (machineId && mainWindow && !mainWindow.isDestroyed() && db) {
      const machine = db.prepare("SELECT name FROM machines WHERE id = ?").get(machineId)
      const machineName = machine ? machine.name : `PC-${machineId}`
      const logEntry = {
        timestamp: data.payload.timestamp,
        message: `[${machineName}] ${data.payload.message}`
      }
      mainWindow.webContents.send('server-log', logEntry)
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
      try {
        const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
        if (activeSess) {
          refundLeftoverPrepaidTime(activeSess.id)
        }
        db.prepare(`UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE machine_id = ? AND end_time IS NULL`).run(machineId)
        logToUI(`Automatically ended active billing session for machine ID ${machineId} on disconnect.`)
      } catch (err: any) {
        logToUI(`Error auto-closing session for machine ID ${machineId}: ${err.message}`)
      }
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

// tcpServer.listen moved inside app.whenReady()

function getMachinesData() {
  if (!db) return []
  return db.prepare(`
    SELECT m.*, 
           s.customer_name as user,
           s.plan_id,
           s.mode,
           s.custom_duration,
           COALESCE(s.penalty_amount, 0) as penalty_amount,
           COALESCE(p.duration_minutes, s.custom_duration) as duration_minutes,
           CASE 
             WHEN s.start_time IS NOT NULL THEN
               CASE 
                 WHEN s.status = 'paused' AND s.paused_duration IS NOT NULL THEN
                   CAST((s.paused_duration - strftime('%s', s.start_time)) AS INTEGER)
                 ELSE
                   CASE 
                     WHEN CAST((strftime('%s', 'now') - strftime('%s', s.start_time)) AS INTEGER) < 0 THEN 0
                     ELSE CAST((strftime('%s', 'now') - strftime('%s', s.start_time)) AS INTEGER)
                   END
               END
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
    const metrics = clientMetrics.get(m.id) || { cpu: 0, ram: 0, activeWindow: '', os: 'Unknown', uptime: 0, version: 'Unknown' }
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
        if (cmd && (cmd.command === 'poweroff' || cmd.command === 'restart')) {
          if (isLocalIp(socket.remoteAddress)) {
            logToUI(`Blocked '${cmd.command}' command for local machine (Server host)`)
            return
          }
        }
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

function dispatchBroadcastToTarget(target: string, payload: any) {
  const cmd = {
    command: 'broadcast-receive',
    payload
  };
  if (target === 'all') {
    for (const [socket] of clients.entries()) {
      if (socket.writable && !socket.destroyed) {
        try {
          socket.write(JSON.stringify(cmd) + '\n');
        } catch {}
      }
    }
    logToUI(`Broadcast sent to all connected PCs: type=${payload.type}`);
  } else {
    const targetMachineId = Number(target);
    sendCommandToMachine(targetMachineId, cmd);
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

function startWebServer() {
  const webApp = express();
  
  // CORS Middleware
  webApp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  webApp.use(express.json({ limit: '50mb' }));

  // IPC Bridge Endpoint
  webApp.post('/api/ipc', async (req, res) => {
    const { channel, args } = req.body;
    const handler = ipcRegistry.get(channel);
    if (handler) {
      try {
        const mockEvent = { sender: { send: () => {} } };
        const result = await handler(mockEvent, ...args);
        res.json(result === undefined ? null : result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    } else {
      res.status(404).json({ error: `IPC channel ${channel} not found` });
    }
  });

  // Broadcast endpoints (REST)
  webApp.get('/api/broadcast/schedule', (req, res) => {
    try {
      const row = db.prepare("SELECT * FROM scheduled_times WHERE id = 1").get();
      res.json(row || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  webApp.put('/api/broadcast/schedule', (req, res) => {
    try {
      const { open_time, close_time, warn_minutes, repeat_days } = req.body;
      db.prepare(`
        UPDATE scheduled_times
        SET open_time = ?, close_time = ?, warn_minutes = ?, repeat_days = ?
        WHERE id = 1
      `).run(open_time, close_time, Number(warn_minutes), repeat_days);

      // Reset warning check and dismiss alert on all connected clients
      lastClosingWarningSentDate = '';
      dispatchBroadcastToTarget('all', { type: 'compact' });
      logToUI(`Broadcast closing-alert schedule updated via API. Active alerts dismissed.`);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  webApp.post('/api/broadcast/send', (req, res) => {
    try {
      const { type, title, body, from_label, target, send_at } = req.body;
      const now = Math.floor(Date.now() / 1000);
      const isImmediate = !send_at || Number(send_at) <= now;
      const sentVal = isImmediate ? 1 : 0;

      const stmt = db.prepare(`
        INSERT INTO broadcasts (type, title, body, from_label, target, send_at, sent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(type, title || null, body, from_label || 'Lab Admin', target || 'all', send_at || null, sentVal);
      const broadcastId = info.lastInsertRowid;

      if (isImmediate) {
        const payload = {
          type,
          title: title || undefined,
          body,
          text: body,
          from_label: from_label || 'Lab Admin',
          seconds: type === 'alert' ? 300 : undefined
        };
        dispatchBroadcastToTarget(target || 'all', payload);
      }

      res.json({ success: true, id: broadcastId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  webApp.delete('/api/broadcast/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = db.prepare("DELETE FROM broadcasts WHERE id = ? AND sent = 0").run(id);
      if (result.changes > 0) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Pending broadcast not found or already sent" });
      }
    } catch (err: any) {
      res.status(550).json({ error: err.message });
    }
  });

  webApp.get('/api/broadcast/queue', (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM broadcasts WHERE sent = 0 ORDER BY send_at ASC").all();
      res.json(rows);
    } catch (err: any) {
      res.status(550).json({ error: err.message });
    }
  });

  webApp.get('/api/broadcast/replies', (req, res) => {
    res.json(studentReplies);
  });

  // Client Web Installation Pages
  webApp.get('/install', (req, res) => {
    const ip = getLanIPAddress();
    const command = `Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; iex ((New-Object System.Net.WebClient).DownloadString('http://${ip}:9001/api/install.ps1'))`;
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>NetCafe Agent Setup</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0; padding: 0;
      background: #020617; color: #f8fafc;
      font-family: 'Plus Jakarta Sans', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 600px; width: 100%;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px; padding: 2.5rem;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    h1 { font-family: 'Outfit', sans-serif; font-size: 2rem; margin-bottom: 0.5rem; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 2rem; }
    .card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;
      text-align: left; transition: transform 0.2s;
    }
    .card:hover { transform: translateY(-2px); }
    h3 { margin-top: 0; font-family: 'Outfit', sans-serif; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 100%; padding: 0.75rem; border-radius: 12px;
      font-weight: 700; text-decoration: none; font-size: 0.9rem;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-primary { background: linear-gradient(135deg, #0ea5e9, #2563eb); color: white; border: none; }
    .btn-primary:hover { opacity: 0.9; }
    .code-box {
      background: #090d16; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 0.75rem; font-family: monospace;
      font-size: 0.75rem; color: #38bdf8; word-break: break-all;
      margin-bottom: 1rem; position: relative;
    }
    .copy-btn {
      position: absolute; right: 8px; top: 8px;
      background: rgba(255,255,255,0.1); border: none; color: white;
      padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;
    }
    .copy-btn:hover { background: rgba(255,255,255,0.2); }
  </style>
</head>
<body>
  <div class="container">
    <h1>NetCafe Agent Setup</h1>
    <p>Choose your kiosk client installation method for this PC terminal.</p>
    
    <div class="card">
      <h3 style="color:#10b981;">🛡️ Option 1: Create New CafeKiosk User (Recommended)</h3>
      <p style="font-size:0.85rem; margin-bottom:1rem;">Creates a secure, dedicated standard user account named 'CafeKiosk' on this PC. Configures auto-logon to boot directly into the NetCafe member login screen.</p>
      <a class="btn btn-primary" href="https://github.com/MuhammedAjmalBinAshraf/NetCafe/releases/latest/download/NetCafe-Agent-Setup.exe">Download Kiosk Installer (.exe)</a>
    </div>

    <div class="card">
      <h3 style="color:#0ea5e9;">💻 Option 2: Use Current Standard User</h3>
      <p style="font-size:0.85rem; margin-bottom:1rem;">Configures the client only for the currently logged-in standard user. No new user account is created. Run this in PowerShell (Admin):</p>
      <div class="code-box">
        <span id="cmdText">${command}</span>
        <button class="copy-btn" onclick="copyCmd()">Copy</button>
      </div>
    </div>
  </div>
  <script>
    function copyCmd() {
      navigator.clipboard.writeText(document.getElementById('cmdText').innerText);
      alert('Command copied to clipboard!');
    }
  </script>
</body>
</html>`);
  });

  webApp.get('/api/install.ps1', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`#Requires -RunAsAdministrator
$currUser = $env:USERNAME
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "           NetCafe Agent Client Installer" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Detected current user: $currUser" -ForegroundColor Yellow
Write-Host "This will configure NetCafe Agent for the current user ONLY." -ForegroundColor Yellow
Write-Host "NO new CafeKiosk user account will be created." -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Do you want to continue? (Y/N)"
if ($confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "Installation aborted." -ForegroundColor Red
    Exit
}

Write-Host "Creating C:\\NetCafe folder..."
New-Item -ItemType Directory -Path "C:\\NetCafe" -Force | Out-Null

Write-Host "Writing kiosk.ini configuration override..."
$iniContent = @"
KioskUser=$currUser
KioskPassword=SKIP
"@
Set-Content -Path "C:\\NetCafe\\kiosk.ini" -Value $iniContent -Force

Write-Host "Downloading NetCafe Agent installer..." -ForegroundColor Green
$installerUrl = "https://github.com/MuhammedAjmalBinAshraf/NetCafe/releases/latest/download/NetCafe-Agent-Setup.exe"
$tempInstaller = "$env:TEMP\\NetCafe-Agent-Setup.exe"
(New-Object System.Net.WebClient).DownloadFile($installerUrl, $tempInstaller)

Write-Host "Running Agent Installer in the background..." -ForegroundColor Green
Start-Process -FilePath $tempInstaller -ArgumentList "/S" -Wait

Write-Host "NetCafe Agent installation completed!" -ForegroundColor Green
Write-Host "The PC will restart in 5 seconds to apply settings." -ForegroundColor Yellow
Start-Sleep -Seconds 5
Restart-Computer -Force
`);
  });

  // Serve local agent updates statically
  const serverAgentUpdateDir = 'C:\\NetCafe\\updates\\agent';
  try {
    if (!fs.existsSync(serverAgentUpdateDir)) {
      fs.mkdirSync(serverAgentUpdateDir, { recursive: true });
    }
  } catch (e: any) {
    console.error('Failed to create updates directory:', e);
  }
  webApp.use('/updates/agent', express.static(serverAgentUpdateDir));

  // GET /api/updates/health
  // Returns whether the update files are correctly in place
  webApp.get('/api/updates/health', (_req, res) => {
    const updateDir = 'C:\\NetCafe\\updates\\agent';
    const ymlPath   = path.join(updateDir, 'latest-agent.yml');
    const ymlExists = fs.existsSync(ymlPath);

    let version = null;
    let exeFile = null;

    if (ymlExists) {
      try {
        const yml = fs.readFileSync(ymlPath, 'utf-8');
        const versionMatch = yml.match(/^version:\s*(.+)$/m);
        const pathMatch    = yml.match(/^path:\s*(.+)$/m);
        version = versionMatch ? versionMatch[1].trim() : null;
        exeFile = pathMatch    ? pathMatch[1].trim()    : null;
      } catch {}
    }

    const exeExists = exeFile
      ? fs.existsSync(path.join(updateDir, exeFile))
      : false;

    res.json({
      ready:      ymlExists && exeExists,
      ymlExists,
      exeExists,
      version,
      exeFile,
      updateDir,
    });
  });

  // Serve static UI assets in production/packaged app
  const distPath = path.join(__dirname, '../dist');
  if (fs.existsSync(distPath)) {
    webApp.use(express.static(distPath));
    webApp.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development fallback
    webApp.get('/', (req, res) => {
      res.send(`NetCafe Server API running. Serve UI via Vite in development.`);
    });
  }

  const port = 9001;
  webApp.listen(port, '0.0.0.0', () => {
    logToUI(`Web server started on port ${port} (Available on LAN for mobile control)`);
  });
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

let publicUrl: string | null = null;
let sshProcess: any = null;

function broadcastPublicUrl() {
  if (mainWindow) {
    mainWindow.webContents.send('public-url-updated', publicUrl);
  }
}

function startPublicTunnel() {
  if (sshProcess) return;

  logToUI('Starting public reverse tunnel via localhost.run...');
  const sshCmd = process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh';
  
  sshProcess = spawn(sshCmd, [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', '80:localhost:9001',
    'nokey@localhost.run'
  ]);

  sshProcess.stdout.on('data', (data: Buffer) => {
    const output = data.toString('utf8');
    logToUI(`[Tunnel] ${output.trim()}`);
    
    // Parse URL (e.g. "https://xxxx.lhr.life")
    const match = output.match(/https:\/\/[a-zA-Z0-9.-]+\.lhr\.life/);
    if (match) {
      publicUrl = match[0];
      logToUI(`[Tunnel] Public URL resolved: ${publicUrl}`);
      broadcastPublicUrl();
    }
  });

  sshProcess.stderr.on('data', (data: Buffer) => {
    logToUI(`[Tunnel Stderr] ${data.toString('utf8').trim()}`);
  });

  sshProcess.on('close', (code: number) => {
    logToUI(`[Tunnel] Process exited with code ${code}. Reconnecting in 5s...`);
    publicUrl = null;
    sshProcess = null;
    broadcastPublicUrl();
    setTimeout(startPublicTunnel, 5000);
  });
}

function startPrepaidSessionMonitor() {
  setInterval(() => {
    if (!db) return
    try {
      const expiredSessions = db.prepare(`
        SELECT s.id as session_id, s.machine_id, s.customer_name, 
               COALESCE(p.duration_minutes, s.custom_duration) as duration_minutes,
               (strftime('%s', 'now') - strftime('%s', s.start_time)) as elapsed_seconds
        FROM sessions s
        LEFT JOIN plans p ON s.plan_id = p.id
        WHERE s.status = 'active' AND s.mode = 'prepaid' AND s.end_time IS NULL
      `).all() as any[]

      for (const sess of expiredSessions) {
        const durationSec = (sess.duration_minutes || 0) * 60
        if (sess.elapsed_seconds >= durationSec) {
          logToUI(`[Monitor] Prepaid session expired for user "${sess.customer_name}" on machine ID ${sess.machine_id}. Automatically locking terminal.`)
          
          db.prepare(`
            UPDATE sessions 
            SET end_time = datetime('now'), 
                status = 'completed' 
            WHERE id = ?
          `).run(sess.session_id)
          
          db.prepare("UPDATE machines SET status = 'available' WHERE id = ?").run(sess.machine_id)
          
          sendCommandToMachine(sess.machine_id, { command: 'lock' })
          sendCommandToMachine(sess.machine_id, { command: 'message', payload: "Your prepaid session has ended. Please visit the front desk to extend your time." })
          broadcastMachines()
        }
      }
    } catch (err: any) {
      console.error('Prepaid session monitor error:', err)
    }
  }, 2000)
}

function startScheduledBroadcastMonitor() {
  setInterval(() => {
    if (!db) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      const pending = db.prepare("SELECT * FROM broadcasts WHERE sent = 0 AND send_at <= ?").all() as any[];
      for (const b of pending) {
        const payload = {
          type: b.type,
          title: b.title || undefined,
          body: b.body,
          text: b.body, // message state
          from_label: b.from_label || 'Lab Admin',
          seconds: b.type === 'alert' ? 300 : undefined
        };
        dispatchBroadcastToTarget(b.target, payload);
        db.prepare("UPDATE broadcasts SET sent = 1 WHERE id = ?").run(b.id);
        logToUI(`Sent scheduled broadcast to ${b.target}: type=${b.type}, id=${b.id}`);
      }
    } catch (err) {
      console.error("Scheduled broadcast runner error:", err);
    }
    
    // Check closing warning schedule
    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      if (lastClosingWarningSentDate === dateStr) return; // already sent today
      
      const sched = db.prepare("SELECT * FROM scheduled_times WHERE id = 1").get() as any;
      if (!sched) return;
      
      const currentDay = today.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
      const dayNumber = currentDay === 0 ? 7 : currentDay;
      if (!sched.repeat_days) return; // No repeat days selected, closing alert is disabled
      const days = sched.repeat_days.split(',').map(Number);
      if (!days.includes(dayNumber)) return;
      
      const [closeH, closeM] = (sched.close_time || '21:00').split(':').map(Number);
      const closeTimeMs = new Date(today).setHours(closeH, closeM, 0, 0);
      const warnMs = (sched.warn_minutes || 5) * 60 * 1000;
      const targetWarnTimeMs = closeTimeMs - warnMs;
      
      const nowMs = today.getTime();
      
      // Check if current time has passed the warning time but is before close time
      if (nowMs >= targetWarnTimeMs && nowMs < closeTimeMs) {
        const payload = {
          type: 'alert',
          title: 'Lab closing soon',
          body: `Please save your work. The lab will close at ${sched.close_time}.`,
          text: `Please save your work. The lab will close at ${sched.close_time}.`,
          from_label: 'System',
          seconds: (sched.warn_minutes || 5) * 60
        };
        dispatchBroadcastToTarget('all', payload);
        lastClosingWarningSentDate = dateStr;
        logToUI(`Auto closing-warning alert sent to all PCs.`);
      }
    } catch (err) {
      console.error("Closing warning check error:", err);
    }
  }, 30000);
}

app.whenReady().then(async () => {
  setupDatabase()
  
  tcpServer.listen(9000, '0.0.0.0', () => { 
    logToUI('TCP server listening on port 9000') 
    setupWindowsFirewall()
  })
  
  // Register get-server-ip handler
  ipcMain.handle('get-server-ip', () => {
    return getLanIPAddress();
  });

  // Register get-public-url handler
  ipcMain.handle('get-public-url', () => {
    return publicUrl;
  });

  // Register get-app-version handler
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  createWindow()
  startUdpBroadcast()
  startWebServer()
  startPublicTunnel()
  startPrepaidSessionMonitor()
  startScheduledBroadcastMonitor()

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
    
    // Log the download event to Server install log
    const logPath = "C:\\NetCafeServer_Install.log";
    try {
      const fs = require('fs');
      fs.appendFileSync(logPath, `\r\n[${new Date().toISOString()}] UPDATE DOWNLOADED: NetCafe Server version ${info?.version || 'unknown'} downloaded successfully. Restarting to install update...\r\n`, 'utf8');
    } catch {}

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
  if (db) {
    const connectedIds = Array.from(clients.values()).map(Number)
    const allMachines = db.prepare("SELECT id, status FROM machines").all()
    for (const mach of allMachines) {
      const machId = Number(mach.id)
      const isConnected = connectedIds.includes(machId)
      if (!isConnected) {
        const activeSession = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machId)
        if (!activeSession) {
          db.prepare("DELETE FROM machines WHERE id = ?").run(machId)
          logToUI(`Removed stale/offline machine ID ${machId} from database during reload.`)
        } else {
          db.prepare("UPDATE machines SET status = 'offline' WHERE id = ?").run(machId)
          logToUI(`Updated disconnected machine ID ${machId} with active session to offline status.`)
        }
      }
    }
  }
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
  const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
  if (activeSess) {
    refundLeftoverPrepaidTime(activeSess.id)
  }
  const closeResult = db.prepare(`UPDATE sessions SET end_time = datetime('now'), status = 'completed' WHERE machine_id = ? AND end_time IS NULL`).run(machineId)
  if (closeResult.changes > 0) {
    logToUI(`Cleaned up ${closeResult.changes} stale active sessions for machine ID ${machineId}`)
  }
  
  db.prepare(`
    INSERT INTO sessions (machine_id, customer_name, plan_id, start_time, mode, status, custom_duration) 
    VALUES (?, ?, ?, datetime('now', '+9 seconds'), ?, 'active', ?)
  `).run(machineId, customerName || 'Walk-in', planId || null, mode || 'postpaid', duration)

  db.prepare("UPDATE machines SET status = 'in_use', violation_count = 0 WHERE id = ?").run(machineId)
  logToUI(`Opening session on machine ID ${machineId} for user ${customerName || 'Walk-in'} — violation count reset`)

  const activeSession = db.prepare(`
    SELECT s.*, p.duration_minutes as plan_duration, p.price
    FROM sessions s
    LEFT JOIN plans p ON s.plan_id = p.id
    WHERE s.machine_id = ? AND s.end_time IS NULL
  `).get(machineId)

  if (activeSession) {
    let sessionUsername = ''
    if (activeSession.mode === 'prepaid') {
      const u = db.prepare("SELECT username FROM users WHERE username = ? OR display_name = ?").get(activeSession.customer_name, activeSession.customer_name) as any
      if (u) sessionUsername = u.username
    }
    sendCommandToMachine(machineId, {
      command: 'unlock',
      user: activeSession.customer_name || 'Guest',
      session: {
        startTime: activeSession.start_time,
        mode: activeSession.mode || 'postpaid',
        durationMinutes: activeSession.custom_duration || activeSession.plan_duration || null,
        planPrice: activeSession.price || null,
        customDuration: activeSession.custom_duration || null,
        user: activeSession.customer_name || 'Guest',
        username: sessionUsername
      }
    })
  } else {
    sendCommandToMachine(machineId, { command: 'unlock', user: customerName || 'Guest' })
  }
  
  broadcastMachines()
})

ipcMain.handle('pause-session', (_, machineId) => {
  db.prepare("UPDATE machines SET status = 'paused' WHERE id = ?").run(machineId)
  const now = Math.floor(Date.now() / 1000)
  db.prepare("UPDATE sessions SET status = 'paused', paused_duration = ? WHERE machine_id = ? AND end_time IS NULL").run(now, machineId)
  sendCommandToMachine(machineId, { command: 'lock' })
  broadcastMachines()
})

ipcMain.handle('resume-session', (_, machineId) => {
  db.prepare("UPDATE machines SET status = 'in_use', violation_count = 0 WHERE id = ?").run(machineId)
  
  const sess = db.prepare("SELECT id, start_time, paused_duration FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId)
  if (sess) {
    if (sess.paused_duration) {
      const now = Math.floor(Date.now() / 1000)
      const diff = now - sess.paused_duration
      const shift = diff > 0 ? diff + 9 : 9
      db.prepare("UPDATE sessions SET start_time = datetime(start_time, '+' || ? || ' seconds'), paused_duration = NULL, status = 'active' WHERE id = ?").run(shift, sess.id)
    } else {
      db.prepare("UPDATE sessions SET status = 'active' WHERE id = ?").run(sess.id)
    }

    const activeSession = db.prepare(`
      SELECT s.*, p.duration_minutes as plan_duration, p.price
      FROM sessions s
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE s.id = ?
    `).get(sess.id)

    if (activeSession) {
      sendCommandToMachine(machineId, {
        command: 'unlock',
        user: activeSession.customer_name || 'Guest',
        session: {
          startTime: activeSession.start_time,
          mode: activeSession.mode || 'postpaid',
          durationMinutes: activeSession.custom_duration || activeSession.plan_duration || null,
          planPrice: activeSession.price || null,
          customDuration: activeSession.custom_duration || null
        }
      })
    }
  } else {
    sendCommandToMachine(machineId, { command: 'unlock', user: 'Guest' })
  }

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

    const activeSession = db.prepare(`
      SELECT s.*, p.duration_minutes as plan_duration, p.price
      FROM sessions s
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE s.machine_id = ? AND s.end_time IS NULL
    `).get(machineId)

    if (activeSession) {
      sendCommandToMachine(machineId, {
        command: 'sync-session',
        session: {
          startTime: activeSession.start_time,
          mode: activeSession.mode || 'postpaid',
          durationMinutes: activeSession.custom_duration || activeSession.plan_duration || null,
          planPrice: activeSession.price || null,
          customDuration: activeSession.custom_duration || null
        }
      })
    }

    broadcastMachines()
    return { success: true }
  }
  return { success: false, error: 'No active session' }
})

ipcMain.handle('close-session', (_, machineId, totalAmount, discount, paymentMethod) => {
  db.prepare("UPDATE machines SET status = 'available' WHERE id = ?").run(machineId)
  const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
  if (activeSess) {
    refundLeftoverPrepaidTime(activeSess.id)
  }
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
  const activeSession = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
  if (activeSession) {
    db.prepare("UPDATE machines SET status = 'paused' WHERE id = ?").run(machineId)
    const now = Math.floor(Date.now() / 1000)
    db.prepare("UPDATE sessions SET status = 'paused', paused_duration = ? WHERE machine_id = ? AND end_time IS NULL").run(now, machineId)
    logToUI(`[Lock Screen] Paused active session for machine ID ${machineId}`)
  } else {
    db.prepare("UPDATE machines SET status = 'available' WHERE id = ?").run(machineId)
  }
  sendCommandToMachine(machineId, { command: 'lock' })
  broadcastMachines()
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

ipcMain.handle('trigger-client-update', (_, machineId) => {
  const serverIp = getLanIPAddress();
  const command = {
    command: 'trigger-update',
    serverIp: serverIp,
    serverPort: 9001,
  };

  if (machineId === 'all') {
    for (const socket of clients.keys()) {
      try {
        socket.write(JSON.stringify(command) + '\n')
      } catch {}
    }
    return { success: true }
  } else {
    sendCommandToMachine(machineId, command)
    return { success: true }
  }
})

ipcMain.handle('trigger-client-update-batch', (_, machineIds: number[]) => {
  const serverIp = getLanIPAddress();
  const command = {
    command: 'trigger-update',
    serverIp: serverIp,
    serverPort: 9001,
  };
  for (const id of machineIds) {
    sendCommandToMachine(id, command)
  }
  return { success: true }
})

ipcMain.handle('check-updates-health', () => {
  const updateDir = 'C:\\NetCafe\\updates\\agent';
  const ymlPath   = path.join(updateDir, 'latest-agent.yml');
  const ymlExists = fs.existsSync(ymlPath);

  let version = null;
  let exeFile = null;

  if (ymlExists) {
    try {
      const yml = fs.readFileSync(ymlPath, 'utf-8');
      const versionMatch = yml.match(/^version:\s*(.+)$/m);
      const pathMatch    = yml.match(/^path:\s*(.+)$/m);
      version = versionMatch ? versionMatch[1].trim() : null;
      exeFile = pathMatch    ? pathMatch[1].trim()    : null;
    } catch {}
  }

  const exeExists = exeFile
    ? fs.existsSync(path.join(updateDir, exeFile))
    : false;

  return {
    ready:      ymlExists && exeExists,
    ymlExists,
    exeExists,
    version,
    exeFile,
    updateDir,
  };
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
    if (isLocalIp(socket.remoteAddress)) {
      continue
    }
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

ipcMain.handle('get-safe-queries', () => {
  if (!db) return []
  return db.prepare("SELECT * FROM safe_queries ORDER BY query ASC").all()
})

ipcMain.handle('add-safe-query', (_, query) => {
  if (!db) return { success: false }
  try {
    const info = db.prepare("INSERT INTO safe_queries (query) VALUES (?)").run(query.trim())
    return { success: true, id: info.lastInsertRowid }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('delete-safe-query', (_, id) => {
  if (!db) return { success: false }
  db.prepare("DELETE FROM safe_queries WHERE id = ?").run(id)
  return { success: true }
})

ipcMain.handle('update-safe-query', (_, id, query) => {
  if (!db) return { success: false }
  try {
    db.prepare("UPDATE safe_queries SET query = ? WHERE id = ?").run(query.trim(), id)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// Blocked Queries (Blacklist) CRUD Handlers
ipcMain.handle('get-blocked-queries', () => {
  if (!db) return []
  return db.prepare("SELECT * FROM blocked_queries ORDER BY query ASC").all()
})

ipcMain.handle('add-blocked-query', (_, query) => {
  if (!db) return { success: false }
  try {
    const info = db.prepare("INSERT INTO blocked_queries (query) VALUES (?)").run(query.trim())
    return { success: true, id: info.lastInsertRowid }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('delete-blocked-query', (_, id) => {
  if (!db) return { success: false }
  db.prepare("DELETE FROM blocked_queries WHERE id = ?").run(id)
  return { success: true }
})

ipcMain.handle('update-blocked-query', (_, id, query) => {
  if (!db) return { success: false }
  try {
    db.prepare("UPDATE blocked_queries SET query = ? WHERE id = ?").run(query.trim(), id)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})


ipcMain.handle('get-broadcast-schedule', () => {
  if (!db) return null
  return db.prepare("SELECT * FROM scheduled_times WHERE id = 1").get()
})

ipcMain.handle('update-broadcast-schedule', (_, { open_time, close_time, warn_minutes, repeat_days }) => {
  if (!db) return { success: false }
  db.prepare(`
    UPDATE scheduled_times
    SET open_time = ?, close_time = ?, warn_minutes = ?, repeat_days = ?
    WHERE id = 1
  `).run(open_time, close_time, Number(warn_minutes), repeat_days)

  // Reset warning check and dismiss alert on all connected clients
  lastClosingWarningSentDate = ''
  dispatchBroadcastToTarget('all', { type: 'compact' })
  logToUI(`Broadcast closing-alert schedule updated. Active alerts dismissed.`)

  return { success: true }
})

ipcMain.handle('send-broadcast', (_, { type, title, body, from_label, target, send_at }) => {
  if (!db) return { success: false }
  const now = Math.floor(Date.now() / 1000)
  const isImmediate = !send_at || Number(send_at) <= now
  const sentVal = isImmediate ? 1 : 0

  const stmt = db.prepare(`
    INSERT INTO broadcasts (type, title, body, from_label, target, send_at, sent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const info = stmt.run(type, title || null, body, from_label || 'Lab Admin', target || 'all', send_at || null, sentVal)
  const broadcastId = info.lastInsertRowid

  if (isImmediate) {
    const payload = {
      type,
      title: title || undefined,
      body,
      text: body,
      from_label: from_label || 'Lab Admin',
      seconds: type === 'alert' ? 300 : undefined
    }
    dispatchBroadcastToTarget(target || 'all', payload)
  }

  return { success: true, id: broadcastId }
})

ipcMain.handle('delete-broadcast', (_, id) => {
  if (!db) return { success: false }
  db.prepare("DELETE FROM broadcasts WHERE id = ? AND sent = 0").run(Number(id))
  return { success: true }
})

ipcMain.handle('get-broadcast-queue', () => {
  if (!db) return []
  return db.prepare("SELECT * FROM broadcasts WHERE sent = 0 ORDER BY send_at ASC").all()
})

ipcMain.handle('get-student-replies', () => {
  return studentReplies
})

ipcMain.handle('operator-message', (_, machineId, text) => {
  sendCommandToMachine(machineId, {
    command: 'broadcast-receive',
    payload: {
      type: 'message',
      text: text,
      from_label: 'Operator'
    }
  })
  return { success: true }
})

ipcMain.handle('backup-db', async (_, targetPath) => {
  try {
    let finalPath = targetPath
    if (!finalPath) {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Backup Database',
        defaultPath: 'netcafe_backup.db',
        filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }]
      })
      if (canceled || !filePath) {
        return { success: false, error: 'Backup canceled by user' }
      }
      finalPath = filePath
    }
    fs.copyFileSync(dbPath, finalPath)
    return { success: true, filePath: finalPath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('restore-db', async (_, sourcePath) => {
  try {
    let finalPath = sourcePath
    if (!finalPath) {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Restore Database',
        filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, error: 'Restore canceled by user' }
      }
      finalPath = filePaths[0]
    }
    db.close()
    fs.copyFileSync(finalPath, dbPath)
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
  return db.prepare('SELECT id, username, password, display_name, phone, email, balance_minutes, created_at, ad_no, class FROM users ORDER BY created_at DESC').all()
})

ipcMain.handle('create-user', (_, username: string, password: string, displayName: string, phone: string, email: string, balanceMinutes: number, adNo: string, className: string) => {
  try {
    const info = db.prepare('INSERT INTO users (username, password, display_name, phone, email, balance_minutes, ad_no, class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(username, password, displayName || null, phone || null, email || null, balanceMinutes || 0, adNo || null, className || null)
    return { success: true, id: info.lastInsertRowid }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('update-user', (_, id: number, username: string, password: string, displayName: string, phone: string, email: string, balanceMinutes: number, adNo: string, className: string) => {
  try {
    if (password && password.trim() !== '') {
      db.prepare('UPDATE users SET username = ?, password = ?, display_name = ?, phone = ?, email = ?, balance_minutes = ?, ad_no = ?, class = ? WHERE id = ?').run(username, password, displayName || null, phone || null, email || null, balanceMinutes || 0, adNo || null, className || null, id)
    } else {
      db.prepare('UPDATE users SET username = ?, display_name = ?, phone = ?, email = ?, balance_minutes = ?, ad_no = ?, class = ? WHERE id = ?').run(username, displayName || null, phone || null, email || null, balanceMinutes || 0, adNo || null, className || null, id)
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
    const user = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(id) as any
    if (user) {
      const activeSession = db.prepare(`
        SELECT id, machine_id, custom_duration, start_time, mode
        FROM sessions
        WHERE (customer_name = ? OR customer_name = ?) AND end_time IS NULL
      `).get(user.username, user.display_name) as any

      if (activeSession) {
        const newDuration = (activeSession.custom_duration || 0) + minutes
        db.prepare("UPDATE sessions SET custom_duration = ? WHERE id = ?").run(newDuration, activeSession.id)
        
        let sessionUsername = ''
        if (activeSession.mode === 'prepaid') {
          const u = db.prepare("SELECT username FROM users WHERE username = ? OR display_name = ?").get(activeSession.customer_name, activeSession.customer_name) as any
          if (u) sessionUsername = u.username
        }
        sendCommandToMachine(activeSession.machine_id, {
          command: 'sync-session',
          session: {
            startTime: activeSession.start_time,
            mode: activeSession.mode || 'postpaid',
            durationMinutes: newDuration,
            planPrice: null,
            customDuration: newDuration,
            user: activeSession.customer_name || 'Guest',
            username: sessionUsername
          }
        })
        logToUI(`[Topup] Extended active session for user "${user.username}" by ${minutes} minutes.`)
      } else {
        db.prepare('UPDATE users SET balance_minutes = balance_minutes + ? WHERE id = ?').run(minutes, id)
        logToUI(`[Topup] Added ${minutes} minutes to user "${user.username}" balance.`)
      }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('bulk-delete-users', (_, ids: number[]) => {
  try {
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('bulk-topup-users', (_, ids: number[], minutes: number) => {
  try {
    for (const id of ids) {
      const user = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(id) as any
      if (user) {
        const activeSession = db.prepare(`
          SELECT id, machine_id, custom_duration, start_time, mode
          FROM sessions
          WHERE (customer_name = ? OR customer_name = ?) AND end_time IS NULL
        `).get(user.username, user.display_name) as any

        if (activeSession) {
          const newDuration = (activeSession.custom_duration || 0) + minutes
          db.prepare("UPDATE sessions SET custom_duration = ? WHERE id = ?").run(newDuration, activeSession.id)
          
          let sessionUsername = ''
          if (activeSession.mode === 'prepaid') {
            const u = db.prepare("SELECT username FROM users WHERE username = ? OR display_name = ?").get(activeSession.customer_name, activeSession.customer_name) as any
            if (u) sessionUsername = u.username
          }
          sendCommandToMachine(activeSession.machine_id, {
            command: 'sync-session',
            session: {
              startTime: activeSession.start_time,
              mode: activeSession.mode || 'postpaid',
              durationMinutes: newDuration,
              planPrice: null,
              customDuration: newDuration,
              user: activeSession.customer_name || 'Guest',
              username: sessionUsername
            }
          })
          logToUI(`[Bulk Topup] Extended active session for user "${user.username}" by ${minutes} minutes.`)
        } else {
          db.prepare('UPDATE users SET balance_minutes = balance_minutes + ? WHERE id = ?').run(minutes, id)
          logToUI(`[Bulk Topup] Added ${minutes} minutes to user "${user.username}" balance.`)
        }
      }
    }
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

    // Helper to get case-insensitive, space-insensitive, and punctuation-insensitive values
    const getVal = (r: any, expectedKeys: string[]) => {
      const normalizedExpected = expectedKeys.map(k => k.toLowerCase().replace(/[^a-z0-9]/g, ''))
      for (const k of Object.keys(r)) {
        const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (normalizedExpected.includes(normK)) {
          return r[k]
        }
      }
      return ''
    }

    for (const row of rows) {
      const adNo = getVal(row, ['ad.no', 'ad_no', 'ad no', 'adno', 'id', 'admissionno', 'admission_no', 'admission no']).toString().trim()
      const name = getVal(row, ['name', 'display_name', 'displayName', 'displayname', 'fullname', 'full name', 'studentname', 'student name']).toString().trim()
      const className = getVal(row, ['class', 'classname', 'class name', 'grade', 'division']).toString().trim()
      const username = getVal(row, ['username', 'user_name', 'user name', 'login', 'user', 'userid', 'user_id', 'user id']).toString().trim()
      const password = getVal(row, ['password', 'pass_word', 'pass word', 'pass']).toString().trim()
      const email = getVal(row, ['email', 'email_address', 'email address', 'mail']).toString().trim()
      const phone = getVal(row, ['phone', 'phone_number', 'phone number', 'mobile', 'mobile_number', 'mobile number', 'contact']).toString().trim()

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
        db.prepare('INSERT INTO users (username, password, display_name, email, phone, ad_no, class) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(username, password || 'changeme', name || username, email, phone, adNo, className)
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

ipcMain.handle('download-user-template', async () => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save User Template',
      defaultPath: 'netcafe_users_template.xlsx',
      filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) {
      return { success: false, canceled: true }
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['ad.no', 'name', 'class', 'username', 'password', 'email', 'phone'],
      ['1001', 'John Doe', '10-A', 'john_doe', 'pass123', 'john@example.com', '9876543210'],
      ['1002', 'Jane Smith', '10-B', 'jane_smith', 'pass456', 'jane@example.com', '9123456789'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Users')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(filePath, buf)
    return { success: true, filePath }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
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

function enforceViolation(
  machineId: number,
  query: string,
  reasonText: string,
  userDetails: string,
  emitLog: (level: 'info' | 'warn' | 'block' | 'allow', message: string) => void
) {
  // Insert alert into safety_alerts
  db.prepare("INSERT INTO safety_alerts (machine_id, query, reason, user_details) VALUES (?, ?, ?, ?)")
    .run(machineId, query, reasonText, userDetails)

  // Progressive enforcement
  const machineRow = db.prepare("SELECT violation_count FROM machines WHERE id = ?").get(machineId) as any
  const violCount = (machineRow?.violation_count || 0) + 1
  db.prepare("UPDATE machines SET violation_count = ? WHERE id = ?").run(violCount, machineId)

  // Check if registered user (not guest / walk-in)
  let isRegisteredUser = false
  if (userDetails && userDetails !== 'Walk-in' && userDetails !== 'Walk-in User' && userDetails !== 'Guest') {
    const dbUser = db.prepare("SELECT id FROM users WHERE username = ? OR display_name = ?").get(userDetails, userDetails) as any
    if (dbUser) {
      isRegisteredUser = true
    }
  }

  // Get penalty setting
  const penaltyFeeSetting = db.prepare("SELECT value FROM settings WHERE key = 'violation_penalty_fee'").get() as any
  const penaltyFee = Number(penaltyFeeSetting?.value || '50')

  if (violCount === 1) {
    // 1st violation: warning
    emitLog('block', `❌ 1st VIOLATION WARNING — User: "${userDetails}" — Query: "${query}" — warning Machine ${machineId}`)
    sendCommandToMachine(machineId, { 
      command: 'message', 
      payload: `⚠️ Safety Violation Warning: Your search "${query}" is not allowed. This is your first warning. Further violations will incur ₹${penaltyFee} penalty fee.` 
    })
    if (mainWindow) mainWindow.webContents.send('safety-alert-triggered', { 
      machineId, 
      query, 
      reason: reasonText, 
      userDetails, 
      warned: true 
    })
    broadcastMachines()
  } else {
    // 2nd or subsequent violation: Fine penalty fee in Rupees (NO lock / NO pause / NO lock for walk-ins/guests)
    emitLog('block', `❌ REPEATED VIOLATION (Penalty Fine) — User: "${userDetails}" — Charging ₹${penaltyFee} — Machine ${machineId}`)
    
    const activeSess = db.prepare("SELECT id FROM sessions WHERE machine_id = ? AND end_time IS NULL").get(machineId) as any
    if (activeSess) {
      db.prepare("UPDATE sessions SET penalty_amount = COALESCE(penalty_amount, 0) + ? WHERE id = ?").run(penaltyFee, activeSess.id)
      
      sendCommandToMachine(machineId, { 
        command: 'message', 
        payload: `⚠️ Safety Violation Penalty: Search "${query}" is not allowed. A penalty fine of ₹${penaltyFee} has been charged to your session.` 
      })
    }
    
    if (mainWindow) mainWindow.webContents.send('safety-alert-triggered', { 
      machineId, 
      query, 
      reason: `${reasonText} (Penalty: ₹${penaltyFee} fee charged)`, 
      userDetails, 
      warned: true
    })
    broadcastMachines()
  }
}

const lastCheckedQueries = new Map<number, string>()
const lastActiveAppMap = new Map<number, string>()


async function checkQuerySafety(
  machineId: number,
  query: string,
  apiKey: string,
  filters: { porn: boolean; violence: boolean; selfHarm: boolean; illegal: boolean }
) {
  const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false })
  const emitLog = (level: 'info' | 'warn' | 'block' | 'allow', message: string) => {
    logToUI(`Safety Guard: ${message}`)
    if (mainWindow) mainWindow.webContents.send('filter-log', { timestamp: ts(), level, message, machineId, query })
  }

  const cleanQ = query.trim().toLowerCase();
  emitLog('info', `LAYER 2: Evaluating query on machine ${machineId}: "${query}"`)
  try {
    const result = await evaluateQuerySafety(query, apiKey, filters, [], emitLog)
    if (result.isUnsafe) {
      // Auto add to blacklist
      try {
        db.prepare("INSERT OR IGNORE INTO blocked_queries (query) VALUES (?)").run(cleanQ);
        logToUI(`[Safety Guard] Automatically added "${cleanQ}" to Blocked Queries (Blacklist)`);
      } catch (dbErr) {
        console.error('Failed to auto-blacklist query:', dbErr);
      }

      let userDetails = 'Walk-in User'
      try {
        const activeSession = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(machineId) as any
        if (activeSession && activeSession.customer_name) {
          userDetails = activeSession.customer_name
        }
      } catch (err) {
        console.error('Failed to fetch user details for safety alert:', err)
      }

      emitLog('block', `LAYER 2 UNSAFE — User: "${userDetails}" — Category: "${result.category}" — Reason: "${result.reason || 'Prohibited content'}"`)
      enforceViolation(machineId, query, result.category || 'Unsafe content', userDetails, emitLog)
    } else {
      // Auto add to whitelist
      try {
        db.prepare("INSERT OR IGNORE INTO safe_queries (query) VALUES (?)").run(cleanQ);
        logToUI(`[Safety Guard] Automatically added "${cleanQ}" to Safe Queries (Whitelist)`);
      } catch (dbErr) {
        console.error('Failed to auto-whitelist query:', dbErr);
      }

      let userDetails = 'Walk-in User'
      try {
        const activeSession = db.prepare("SELECT customer_name FROM sessions WHERE machine_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1").get(machineId) as any
        if (activeSession && activeSession.customer_name) {
          userDetails = activeSession.customer_name
        }
      } catch {}
      emitLog('allow', `LAYER 2 ALLOWED — User: "${userDetails}" — Query "${query}" is safe (Reason: "${result.reason || 'No safety hazards detected'}")`)
    }
  } catch (err: any) {
    emitLog('warn', `LAYER 2 ERROR: ${err.message}`)
    console.error('Safety check failed:', err)
  }
}

let cachedBestModel = 'models/gemini-2.5-flash';
let cachedApiKeyForModel = '';

async function refreshBestModel(apiKey: string) {
  if (!apiKey) return;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 seconds timeout for model lookup
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    if (data && Array.isArray(data.models)) {
      const candidates = data.models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name);

      if (candidates.length > 0) {
        const priorities = [
          'models/gemini-3.5-flash',
          'models/gemini-3.1-flash-lite',
          'models/gemini-3-flash-preview',
          'models/gemini-2.5-flash',
          'models/gemini-2.0-flash',
          'models/gemini-flash-latest',
          'models/gemini-2.5-flash-lite',
          'models/gemini-2.0-flash-lite',
          'models/gemini-flash-lite-latest',
          'models/gemini-2.5-pro',
          'models/gemini-2.0-pro',
          'models/gemini-pro-latest',
          'models/gemini-1.5-flash',
          'models/gemini-1.5-flash-latest'
        ];
        for (const priority of priorities) {
          if (candidates.includes(priority)) {
            cachedBestModel = priority;
            cachedApiKeyForModel = apiKey;
            return;
          }
        }
        const flashCandidate = candidates.find((name: string) => name.toLowerCase().includes('flash'));
        if (flashCandidate) {
          cachedBestModel = flashCandidate;
          cachedApiKeyForModel = apiKey;
          return;
        }
        cachedBestModel = candidates[0];
        cachedApiKeyForModel = apiKey;
      }
    }
  } catch (err) {
    console.error('Failed to auto-detect best model, using fallback:', err);
  }
}

async function getBestModel(apiKey: string): Promise<string> {
  if (cachedApiKeyForModel !== apiKey) {
    // Trigger update in background, do not await it
    refreshBestModel(apiKey);
  }
  return cachedBestModel;
}

async function evaluateQuerySafety(
  query: string,
  apiKey: string,
  filters: { porn: boolean; violence: boolean; selfHarm: boolean; illegal: boolean },
  customTerms: string[] = [],
  emitLog?: (level: 'info' | 'warn' | 'block' | 'allow', msg: string) => void
): Promise<{ isUnsafe: boolean, category: string, reason?: string }> {
  let topics: string[] = [];
  if (filters.porn) topics.push("pornography/adult content");
  if (filters.violence) topics.push("severe violence/gore/terrorist activities");
  if (filters.selfHarm) topics.push("self-harm/suicide instructions");
  if (filters.illegal) topics.push("illegal acts/weapons/hacking guides");
  if (customTerms.length > 0) topics.push(`any of these specific blocked terms/topics: ${customTerms.join(', ')}`);

  if (topics.length === 0) {
    emitLog?.('warn', 'LAYER 2 SKIPPED — No filter categories enabled')
    return { isUnsafe: false, category: "", reason: "No filter categories active" };
  }

  // Load admin-supplied extra context
  const customContext = db.prepare("SELECT value FROM settings WHERE key = 'ai_custom_context'").get()?.value || ''
  const contextLine = customContext.trim() ? `\nAdditional instructions from administrator: ${customContext.trim()}` : ''

  const prompt = `You are a safety filter for a cybercafe. Analyze this search query and decide if it is unsafe or violates safety rules. Unsafe topics to filter: ${topics.join(", ")}.${contextLine}
  Respond strictly in JSON format:
  {
    "isUnsafe": true or false,
    "category": "Reason/category if unsafe, otherwise empty string",
    "reason": "Brief explanation of why this query is allowed or blocked (e.g. why it is safe or unsafe)"
  }
  Query: "${query}"`;

  const provider = db.prepare("SELECT value FROM settings WHERE key = 'ai_provider'").get()?.value || 'gemini';
  const openRouterKey = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'").get()?.value || '';
  const openRouterModel = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_model'").get()?.value || 'google/gemini-2.5-flash';
  const openRouterUrl = db.prepare("SELECT value FROM settings WHERE key = 'openrouter_url'").get()?.value || 'https://openrouter.ai/api/v1/chat/completions';

  emitLog?.('info', `LAYER 2: Sending to ${provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} (${topics.length} categories active)${customContext.trim() ? ' + custom context' : ''}`)

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 12000);

  const fetchOptions: any = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal
  };

  let requestUrl = '';
  if (provider === 'openrouter') {
    requestUrl = openRouterUrl;
    fetchOptions.headers['Authorization'] = `Bearer ${openRouterKey}`;
    fetchOptions.headers['HTTP-Referer'] = 'https://github.com/MuhammedAjmalBinAshraf/NetCafe';
    fetchOptions.headers['X-Title'] = 'NetCafe Safety Guard';
    fetchOptions.body = JSON.stringify({
      model: openRouterModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 150
    });
  } else {
    const model = await getBestModel(apiKey);
    requestUrl = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;
    fetchOptions.body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });
  }

  try {
    let res = await fetch(requestUrl, fetchOptions);

    if (res.status === 503 || res.status === 429) {
      const status = res.status;
      let errMsg = '';
      try { errMsg = await res.text(); } catch {}
      emitLog?.('warn', `LAYER 2 ERROR: HTTP ${status}: ${errMsg || 'Unavailable'}. Retrying query in 1000ms...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      res = await fetch(requestUrl, fetchOptions);
    }

    clearTimeout(timeoutId);
    emitLog?.('info', `LAYER 2: ${provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} responded (HTTP ${res.status})`)
    if (res.ok) {
      const data: any = await res.json();
      let text = '';
      if (provider === 'openrouter') {
        text = data.choices?.[0]?.message?.content || '';
      } else {
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
      // Clean JSON formatting if enclosed in code blocks
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } else {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
    console.error(`${provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} API call failed:`, e);
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
  activeFullscreenMachineId = targetId
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

ipcMain.handle('get-all-activity-logs', () => {
  if (!db) return []
  try {
    return db.prepare(`
      SELECT 
        'app_' || sal.id as id,
        sal.session_id,
        sal.app_title,
        sal.duration_seconds,
        sal.focus_count,
        sal.first_seen,
        sal.last_seen,
        s.customer_name,
        s.start_time,
        s.machine_id,
        m.name as machine_name,
        u.class,
        u.ad_no,
        u.username,
        NULL as search_query,
        NULL as search_url,
        NULL as search_ip,
        'app' as type
      FROM session_app_logs sal
      JOIN sessions s ON sal.session_id = s.id
      LEFT JOIN machines m ON s.machine_id = m.id
      LEFT JOIN users u ON (u.username = s.customer_name OR u.display_name = s.customer_name)
      
      UNION ALL
      
      SELECT 
        'search_' || msl.id as id,
        msl.session_id,
        'Search: ' || msl.query as app_title,
        0 as duration_seconds,
        1 as focus_count,
        msl.timestamp as first_seen,
        msl.timestamp as last_seen,
        s.customer_name,
        s.start_time,
        s.machine_id,
        m.name as machine_name,
        u.class,
        u.ad_no,
        u.username,
        msl.query as search_query,
        msl.url as search_url,
        msl.ip as search_ip,
        'search' as type
      FROM member_search_logs msl
      JOIN sessions s ON msl.session_id = s.id
      LEFT JOIN machines m ON s.machine_id = m.id
      LEFT JOIN users u ON (u.username = s.customer_name OR u.display_name = s.customer_name)
      
      ORDER BY last_seen DESC
      LIMIT 2000
    `).all()
  } catch (e: any) {
    console.error('get-all-activity-logs failed:', e)
    return []
  }
})

ipcMain.handle('open-external-url', (_, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    try {
      shell.openExternal(url)
    } catch (err) {
      console.error('Failed to open external url:', err)
    }
  }
})

ipcMain.handle('ai-search-logs', async (_event, searchQuery: string, logs: any[]) => {
  if (!db) throw new Error('Database not connected')
  const apiKeySetting = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get() as any
  const apiKey = apiKeySetting?.value || ''
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please add it in Settings.')
  }

  const model = await getBestModel(apiKey);
  const url = `https://generativelanguage.googleapis.com/v1/${model}:generateContent?key=${apiKey}`;
  const prompt = `You are an AI assistant analyzing computer lab activity logs.
The administrator wants to filter/search the logs using this request: "${searchQuery}".

Activity Logs JSON data:
${JSON.stringify(logs)}

Analyze which log entries match the request (for example, if they request "browsers", match Chrome, Firefox, Edge; if "video", match YouTube, Netflix; etc.).
Respond strictly in JSON format containing an array of matched log IDs:
{
  "matchedIds": [1, 2, 3]
}
If nothing matches, return:
{
  "matchedIds": []
}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gemini API error: ${res.status} ${text}`)
    }
    const data: any = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return parsed.matchedIds || []
  } catch (err: any) {
    clearTimeout(timeoutId)
    console.error('AI log search failed:', err)
    throw err
  }
})
