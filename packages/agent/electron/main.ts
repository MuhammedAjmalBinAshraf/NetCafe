import { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, dialog, Tray, Menu, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { exec, execSync, spawn } from 'child_process';
import dgram from 'dgram';

let lockWindow: BrowserWindow | null = null;
let tcpSocket: net.Socket | null = null;
let isLocked = true;
let isAppQuitting = false;
let activeBlockRules: any[] = [];
let blockInterval: NodeJS.Timeout | null = null;
let metricsInterval: NodeJS.Timeout | null = null;
let lockEnforceInterval: NodeJS.Timeout | null = null;
let pendingLoginResolve: ((result: { success: boolean; message?: string }) => void) | null = null;
let currentUser: string | null = null;

const agentLogsCache: { timestamp: string, message: string }[] = [];

function logToUI(msg: string) {
  const logEntry = {
    timestamp: new Date().toISOString().substring(11, 19),
    message: msg
  };
  console.log(`[AGENT LOG] ${msg}`);
  agentLogsCache.push(logEntry);
  if (agentLogsCache.length > 50) agentLogsCache.shift();
  
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.webContents.send('agent-log-updated', logEntry);
  }
}

const configPath = path.join(app.getPath('userData'), 'config.json');
let serverUrl = '127.0.0.1:9000';   // display string (host:port)
let serverHost = '127.0.0.1';
let serverPort = 9000;
let machineId = os.hostname();

// ─── Address helpers ───────────────────────────────────────────────────────────
function parseServerAddress(raw: string): { host: string; port: number } {
  let s = raw.replace(/^(ws|wss|tcp):\/\//, '');
  const [host, portStr] = s.split(':');
  return { host: host || '127.0.0.1', port: parseInt(portStr || '9000', 10) || 9000 };
}

function loadConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data.serverUrl) {
        const parsed = parseServerAddress(data.serverUrl);
        serverHost = parsed.host;
        serverPort = parsed.port;
        serverUrl = `${serverHost}:${serverPort}`;
      }
      if (data.machineId) machineId = data.machineId;
    } else {
      fs.writeFileSync(configPath, JSON.stringify({ serverUrl: `tcp://${serverUrl}`, machineId }, null, 2), 'utf8');
    }
    logToUI(`Loaded config: serverUrl=tcp://${serverHost}:${serverPort}, machineId=${machineId}`);
  } catch (e: any) {
    console.error('Failed to load/write config:', e);
    logToUI(`Failed to load/write config: ${e.message}`);
  }
}

// ─── Lock enforcement: re-focus every 500ms ───────────────────────────────────
function startLockEnforcement() {
  if (lockEnforceInterval) return;
  lockEnforceInterval = setInterval(() => {
    if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      lockWindow.focus();
      lockWindow.moveTop();
    }
  }, 500);
}

function stopLockEnforcement() {
  if (lockEnforceInterval) {
    clearInterval(lockEnforceInterval);
    lockEnforceInterval = null;
  }
}

function createLockWindow() {
  if (lockWindow) return;
  lockWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    kiosk: true,
    frame: false,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(ellipse at top, #0f172a 0%, #020617 60%);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: 'Plus Jakarta Sans', sans-serif;
      overflow: hidden;
      user-select: none;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: 
        radial-gradient(circle at 20% 30%, rgba(59,130,246,0.08) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(99,102,241,0.06) 0%, transparent 50%);
      pointer-events: none;
    }
    .container {
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.07);
      padding: 2.5rem 3rem;
      border-radius: 24px;
      text-align: center;
      box-shadow: 0 32px 64px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
      width: 440px;
      animation: fadeIn 0.5s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes fadeIn {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .logo {
      width: 52px; height: 52px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      border-radius: 16px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1rem;
      box-shadow: 0 0 24px rgba(59,130,246,0.4);
      font-size: 1.6rem;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 800;
      background: linear-gradient(135deg, #e2e8f0, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.25rem;
    }
    .pc-badge {
      display: inline-block;
      font-size: 0.75rem;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.25);
      color: #60a5fa;
      padding: 0.2rem 0.9rem;
      border-radius: 9999px;
      margin-bottom: 1.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .login-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .login-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #64748b;
      margin-bottom: 1rem;
    }
    .input-group {
      margin-bottom: 0.75rem;
      text-align: left;
    }
    .input-label {
      font-size: 0.7rem;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 0.35rem;
      display: block;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.9rem;
      background: rgba(15,23,42,0.7);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      color: #e2e8f0;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input[type="text"]:focus, input[type="password"]:focus {
      border-color: rgba(59,130,246,0.5);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
    }
    input::placeholder { color: #475569; }
    .login-btn {
      width: 100%;
      padding: 0.7rem;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      border: none;
      border-radius: 10px;
      color: white;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.15s;
      margin-top: 0.25rem;
    }
    .login-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .login-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .error-msg {
      margin-top: 0.75rem;
      padding: 0.6rem 0.9rem;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 0.8rem;
      text-align: left;
      display: none;
    }
    .status-msg {
      margin-top: 0.75rem;
      color: #60a5fa;
      font-size: 0.8rem;
      display: none;
    }
    .divider {
      color: #334155;
      font-size: 0.75rem;
      margin: 0.5rem 0 1rem;
    }
    .walk-in-hint {
      font-size: 0.82rem;
      color: #475569;
      line-height: 1.5;
    }
    .info-panel {
      margin-top: 1.25rem;
      padding: 0.75rem 1rem;
      background: rgba(0,0,0,0.2);
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.04);
      font-size: 0.7rem;
      font-family: monospace;
      text-align: left;
    }
    .info-line { display: flex; justify-content: space-between; margin-bottom: 0.2rem; }
    .info-label { color: #334155; }
    .info-value { color: #475569; word-break: break-all; max-width: 200px; }
    .footer {
      font-size: 0.72rem;
      color: #1e293b;
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(255,255,255,0.04);
    }
    
    /* Settings panel styling */
    .settings-trigger {
      position: fixed;
      top: 1.5rem;
      right: 1.5rem;
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1.25rem;
      transition: background 0.2s, transform 0.2s, border-color 0.2s;
      z-index: 100;
    }
    .settings-trigger:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
      transform: rotate(30deg);
    }
    .settings-modal {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.9);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease-in-out;
    }
    .settings-modal.active {
      opacity: 1;
      pointer-events: auto;
    }
    .settings-content {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      width: 380px;
      padding: 1.75rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      position: relative;
      animation: modalSlide 0.3s cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes modalSlide {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .settings-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding-bottom: 0.75rem;
    }
    .settings-header h3 {
      font-size: 1rem;
      font-weight: 700;
      color: white;
    }
    .settings-close {
      font-size: 1.5rem;
      color: #64748b;
      cursor: pointer;
      transition: color 0.15s;
      line-height: 1;
    }
    .settings-close:hover {
      color: white;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔒</div>
    <h1>NetCafe Terminal</h1>
    <div class="pc-badge">${machineId}</div>

    <div class="login-card">
      <div class="login-title">Member Login</div>
      <div class="input-group">
        <label class="input-label" for="username">Username</label>
        <input type="text" id="username" placeholder="Enter your username" autocomplete="off" spellcheck="false" />
      </div>
      <div class="input-group">
        <label class="input-label" for="password">Password</label>
        <input type="password" id="password" placeholder="Enter your password" autocomplete="off" />
      </div>
      <button class="login-btn" id="loginBtn">Start Session</button>
      <div class="error-msg" id="errorMsg"></div>
      <div class="status-msg" id="statusMsg">⏳ Verifying credentials...</div>
    </div>

    <div class="divider">— or —</div>
    <div class="walk-in-hint">Visit the front desk to start a walk-in session.</div>

    <div class="info-panel">
      <div class="info-line"><span class="info-label">Server</span><span class="info-value" id="infoServerUrl">tcp://${serverHost}:${serverPort}</span></div>
      <div class="info-line"><span class="info-label">Terminal</span><span class="info-value">${machineId}</span></div>
      <div class="info-line"><span class="info-label">Version</span><span class="info-value" id="infoVersion">v${app.getVersion()}</span></div>
      <div class="info-line"><span class="info-label">Config</span><span class="info-value">${configPath}</span></div>
    </div>

    <!-- Console Log Panel -->
    <div style="margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.75rem; text-align: left; width: 100%;">
      <div id="logToggle" style="font-size:0.7rem; font-weight:700; color:#64748b; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none; letter-spacing:0.05em;">
        <span>🔍 DEV SYSTEM LOGS</span>
        <span id="logArrow">▼</span>
      </div>
      <div id="logConsole" style="display:none; margin-top:0.5rem; max-height:90px; overflow-y:auto; background:rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); border-radius:6px; padding:0.5rem; font-family:monospace; font-size:0.65rem; color:#94a3b8; line-height:1.4;">
      </div>
    </div>

    <div class="footer">Do not power off this terminal.</div>
  </div>

  ${updateReady ? `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:white;padding:10px 20px;border-radius:20px;font-weight:600;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;">✅ Update downloaded — will install on next restart</div>` : `<div id="updateBar" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(37,99,235,0.9);color:white;padding:10px 24px;border-radius:20px;font-weight:600;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;">🔄 Checking for updates...</div>`}

  <!-- Settings Gear Button -->
  <div class="settings-trigger" id="settingsTrigger" title="Operator Configuration">⚙️</div>

  <!-- Settings Modal -->
  <div class="settings-modal" id="settingsModal">
    <div class="settings-content">
      <div class="settings-header">
        <h3>⚙️ Terminal Configuration</h3>
        <span class="settings-close" id="settingsClose">×</span>
      </div>

      <!-- PIN Gate -->
      <div id="pinGate">
        <div style="margin-bottom:0.75rem;">
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;display:block;margin-bottom:0.35rem;">Operator PIN</label>
          <input type="password" id="pinInput" placeholder="Enter operator PIN" autocomplete="off"
            style="width:100%;padding:0.65rem 0.9rem;background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e2e8f0;font-size:0.9rem;outline:none;" />
          <div id="pinError" style="margin-top:0.5rem;color:#fca5a5;font-size:0.78rem;display:none;"></div>
        </div>
        <button id="pinUnlockBtn"
          style="width:100%;padding:0.65rem;background:linear-gradient(135deg,#3b82f6,#6366f1);border:none;border-radius:10px;color:white;font-size:0.88rem;font-weight:700;cursor:pointer;">
          Unlock Settings
        </button>
      </div>

      <!-- Config Form (hidden until PIN passes) -->
      <div id="configForm" style="display:none;">
        <div style="margin-bottom:0.9rem;">
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;display:block;margin-bottom:0.35rem;">Server Address</label>
          <input type="text" id="cfgServerUrl" placeholder="e.g. 192.168.20.36:9000" autocomplete="off"
            style="width:100%;padding:0.65rem 0.9rem;background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e2e8f0;font-size:0.88rem;outline:none;" />
          <div style="margin-top:0.3rem;font-size:0.7rem;color:#475569;">TCP address of the NetCafe server on your LAN</div>
        </div>
        <div style="margin-bottom:1.1rem;">
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;display:block;margin-bottom:0.35rem;">Terminal Name (Machine ID)</label>
          <input type="text" id="cfgMachineId" placeholder="PC-01" autocomplete="off"
            style="width:100%;padding:0.65rem 0.9rem;background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e2e8f0;font-size:0.88rem;outline:none;" />
          <div style="margin-top:0.3rem;font-size:0.7rem;color:#475569;">Unique name for this terminal shown on the server dashboard</div>
        </div>
        <div id="cfgStatus" style="margin-bottom:0.75rem;padding:0.5rem 0.75rem;border-radius:8px;font-size:0.78rem;display:none;"></div>
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
          <button id="cfgCancelBtn"
            style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#94a3b8;font-size:0.85rem;font-weight:600;cursor:pointer;">
            Cancel
          </button>
          <button id="cfgSaveBtn"
            style="flex:2;padding:0.6rem;background:linear-gradient(135deg,#3b82f6,#6366f1);border:none;border-radius:10px;color:white;font-size:0.88rem;font-weight:700;cursor:pointer;">
            Save &amp; Reconnect
          </button>
        </div>

        <!-- Shell Replacement Section -->
        <div style="margin-top:0.5rem;padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:0.5rem;">🔧 Shell Replacement</div>
          <div id="shellStatusText" style="font-size:0.72rem;color:#475569;">Checking shell status...</div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <button id="shellInstallBtn"
              style="flex:1;padding:0.5rem 0.4rem;background:linear-gradient(135deg,#3b82f6,#6366f1);border:none;border-radius:8px;color:white;font-size:0.78rem;font-weight:600;cursor:pointer;">
              Install as Shell
            </button>
            <button id="shellRestoreBtn"
              style="flex:1;padding:0.5rem 0.4rem;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-size:0.78rem;font-weight:600;cursor:pointer;">
              Restore Explorer
            </button>
          </div>
          <div id="shellOpStatus" style="margin-top:0.4rem;font-size:0.72rem;display:none;"></div>
        </div>

        <!-- Software Update Section -->
        <div style="margin-top:0.5rem;padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:0.5rem;">⬆️ Software Update</div>
          <div style="font-size:0.72rem;color:#475569;margin-bottom:0.5rem;">Current: <span id="updateCurrentVersion" style="color:#94a3b8;font-weight:600;">v${app.getVersion()}</span></div>
          <div style="display:flex;gap:0.5rem;">
            <button id="checkUpdateBtn"
              style="flex:1;padding:0.5rem 0.4rem;background:linear-gradient(135deg,#0ea5e9,#3b82f6);border:none;border-radius:8px;color:white;font-size:0.78rem;font-weight:600;cursor:pointer;">
              🔍 Check for Update
            </button>
            <button id="downloadUpdateBtn"
              style="flex:1;padding:0.5rem 0.4rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:8px;color:#6ee7b7;font-size:0.78rem;font-weight:600;cursor:pointer;display:none;">
              ⬇️ Download Now
            </button>
          </div>
          <div id="updateStatusText" style="margin-top:0.5rem;font-size:0.72rem;color:#64748b;"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function() {
      const { ipcRenderer } = require('electron');
      const usernameEl = document.getElementById('username');
      const passwordEl = document.getElementById('password');
      const loginBtn = document.getElementById('loginBtn');
      const errorMsg = document.getElementById('errorMsg');
      const statusMsg = document.getElementById('statusMsg');

      function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
        statusMsg.style.display = 'none';
      }
      function clearMessages() {
        errorMsg.style.display = 'none';
        statusMsg.style.display = 'none';
      }

      async function attemptLogin() {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        if (!username || !password) {
          showError('Please enter your username and password.');
          return;
        }
        clearMessages();
        loginBtn.disabled = true;
        statusMsg.style.display = 'block';
        try {
          const result = await ipcRenderer.invoke('agent-user-login', username, password);
          if (!result.success) {
            showError(result.message || 'Invalid credentials.');
            passwordEl.value = '';
          }
        } catch (err) {
          showError('Connection error. Please try again.');
        } finally {
          loginBtn.disabled = false;
          statusMsg.style.display = 'none';
        }
      }

      loginBtn.addEventListener('click', attemptLogin);
      passwordEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(); });
      usernameEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') passwordEl.focus(); });

      // ── Settings Gear Logic ──────────────────────────────────────────────────
      const settingsTrigger = document.getElementById('settingsTrigger');
      const settingsModal = document.getElementById('settingsModal');
      const settingsClose = document.getElementById('settingsClose');
      const pinGate = document.getElementById('pinGate');
      const pinInput = document.getElementById('pinInput');
      const pinError = document.getElementById('pinError');
      const pinUnlockBtn = document.getElementById('pinUnlockBtn');
      const configForm = document.getElementById('configForm');
      const cfgServerUrl = document.getElementById('cfgServerUrl');
      const cfgMachineId = document.getElementById('cfgMachineId');
      const cfgSaveBtn = document.getElementById('cfgSaveBtn');
      const cfgCancelBtn = document.getElementById('cfgCancelBtn');
      const cfgStatus = document.getElementById('cfgStatus');
      const shellInstallBtn = document.getElementById('shellInstallBtn');
      const shellRestoreBtn = document.getElementById('shellRestoreBtn');
      const shellStatusText = document.getElementById('shellStatusText');
      const shellOpStatus = document.getElementById('shellOpStatus');

      const VALID_PINS = ['admin', '9999'];

      function openSettings() {
        // Reset state
        pinGate.style.display = 'block';
        configForm.style.display = 'none';
        pinInput.value = '';
        pinError.style.display = 'none';
        cfgStatus.style.display = 'none';
        settingsModal.classList.add('active');
        setTimeout(() => pinInput.focus(), 200);
      }

      function closeSettings() {
        settingsModal.classList.remove('active');
      }

      async function showConfigForm() {
        pinGate.style.display = 'none';
        configForm.style.display = 'block';
        // Pre-fill current values from the info panel
        cfgServerUrl.value = (document.getElementById('infoServerUrl').textContent || 'tcp://${serverHost}:${serverPort}').replace('tcp://', '');
        cfgMachineId.value = '${machineId}';
        setTimeout(() => cfgServerUrl.focus(), 100);
        // Load shell status
        try {
          const status = await ipcRenderer.invoke('get-shell-status');
          shellStatusText.textContent = status.isShell
            ? '\u2705 This app is currently the shell'
            : '\u26a0\ufe0f Shell is: ' + (status.current || 'explorer.exe');
        } catch {
          shellStatusText.textContent = 'Unable to check shell status.';
        }
      }

      settingsTrigger.addEventListener('click', openSettings);
      settingsClose.addEventListener('click', closeSettings);
      cfgCancelBtn.addEventListener('click', closeSettings);

      pinUnlockBtn.addEventListener('click', () => {
        const pin = pinInput.value.trim();
        if (VALID_PINS.includes(pin)) {
          pinError.style.display = 'none';
          showConfigForm();
        } else {
          pinError.textContent = 'Incorrect PIN. Please try again.';
          pinError.style.display = 'block';
          pinInput.value = '';
          pinInput.focus();
        }
      });
      pinInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') pinUnlockBtn.click(); });

      cfgSaveBtn.addEventListener('click', async () => {
        const newUrl = cfgServerUrl.value.trim();
        const newId = cfgMachineId.value.trim();
        if (!newUrl || !newId) {
          cfgStatus.textContent = 'Both fields are required.';
          cfgStatus.style.background = 'rgba(239,68,68,0.12)';
          cfgStatus.style.color = '#fca5a5';
          cfgStatus.style.border = '1px solid rgba(239,68,68,0.2)';
          cfgStatus.style.display = 'block';
          return;
        }
        cfgSaveBtn.disabled = true;
        cfgSaveBtn.textContent = 'Saving...';
        try {
          const result = await ipcRenderer.invoke('save-agent-config', newUrl, newId);
          if (result.success) {
            cfgStatus.textContent = '\u2705 Configuration saved! Reconnecting...';
            cfgStatus.style.background = 'rgba(16,185,129,0.12)';
            cfgStatus.style.color = '#6ee7b7';
            cfgStatus.style.border = '1px solid rgba(16,185,129,0.2)';
            cfgStatus.style.display = 'block';
            setTimeout(closeSettings, 1500);
          } else {
            cfgStatus.textContent = 'Error: ' + (result.error || 'Unknown error');
            cfgStatus.style.background = 'rgba(239,68,68,0.12)';
            cfgStatus.style.color = '#fca5a5';
            cfgStatus.style.border = '1px solid rgba(239,68,68,0.2)';
            cfgStatus.style.display = 'block';
          }
        } catch (e) {
          cfgStatus.textContent = 'Failed to save configuration.';
          cfgStatus.style.display = 'block';
        } finally {
          cfgSaveBtn.disabled = false;
          cfgSaveBtn.textContent = 'Save & Reconnect';
        }
      });

      // ── Shell replacement buttons ─────────────────────────────────────────────
      async function doShellOp(channel, successMsg) {
        shellInstallBtn.disabled = true;
        shellRestoreBtn.disabled = true;
        shellOpStatus.textContent = 'Working...';
        shellOpStatus.style.color = '#60a5fa';
        shellOpStatus.style.display = 'block';
        try {
          const result = await ipcRenderer.invoke(channel);
          if (result.success) {
            shellOpStatus.textContent = successMsg;
            shellOpStatus.style.color = '#6ee7b7';
            // Refresh status
            const status = await ipcRenderer.invoke('get-shell-status');
            shellStatusText.textContent = status.isShell
              ? '\u2705 This app is currently the shell'
              : '\u26a0\ufe0f Shell is: ' + (status.current || 'explorer.exe');
          } else {
            shellOpStatus.textContent = 'Failed: ' + (result.error || 'Unknown error');
            shellOpStatus.style.color = '#fca5a5';
          }
        } catch (e) {
          shellOpStatus.textContent = 'Operation failed.';
          shellOpStatus.style.color = '#fca5a5';
        } finally {
          shellInstallBtn.disabled = false;
          shellRestoreBtn.disabled = false;
        }
      }

      shellInstallBtn.addEventListener('click', () => doShellOp('install-as-shell', '\u2705 Installed as shell. Restart to take effect.'));
      shellRestoreBtn.addEventListener('click', () => doShellOp('restore-shell', '\u2705 Shell restored to explorer.exe. Restart to take effect.'));

      // ── Software Update buttons ──────────────────────────────────────────
      const checkUpdateBtn = document.getElementById('checkUpdateBtn');
      const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
      const updateStatusText = document.getElementById('updateStatusText');
      const updateBar = document.getElementById('updateBar');

      checkUpdateBtn.addEventListener('click', async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.textContent = '\ud83d\udd04 Checking...';
        updateStatusText.textContent = '';
        downloadUpdateBtn.style.display = 'none';
        try {
          await ipcRenderer.invoke('manual-check-for-updates');
        } catch(e) {
          updateStatusText.style.color = '#f87171';
          updateStatusText.textContent = 'Check failed: ' + e.message;
          checkUpdateBtn.disabled = false;
          checkUpdateBtn.textContent = '\ud83d\udd0d Check for Update';
        }
      });

      downloadUpdateBtn.addEventListener('click', async () => {
        downloadUpdateBtn.disabled = true;
        downloadUpdateBtn.textContent = '\u23f3 Downloading...';
        updateStatusText.textContent = 'Download started. App will restart when ready.';
        await ipcRenderer.invoke('manual-download-update').catch(() => {});
      });

      ipcRenderer.on('agent-update-status', (_, payload) => {
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.textContent = '\ud83d\udd0d Check for Update';
        if (payload.status === 'not-available') {
          updateStatusText.style.color = '#22c55e';
          updateStatusText.textContent = '\u2705 Already on latest version.';
        } else if (payload.status === 'available') {
          updateStatusText.style.color = '#38bdf8';
          updateStatusText.textContent = '\ud83d\udce6 New version available: ' + (payload.info?.version || '');
          downloadUpdateBtn.style.display = 'block';
          downloadUpdateBtn.disabled = false;
          downloadUpdateBtn.textContent = '\u2b07\ufe0f Download Now';
          if (updateBar) { updateBar.style.display = 'block'; updateBar.textContent = '\ud83d\udce6 Update available — click Download Now in \u2699\ufe0f settings'; }
        } else if (payload.status === 'downloading') {
          updateStatusText.style.color = '#94a3b8';
          updateStatusText.textContent = '\u23f3 Downloading ' + Math.round(payload.progress?.percent ?? 0) + '%';
        } else if (payload.status === 'downloaded') {
          updateStatusText.style.color = '#22c55e';
          updateStatusText.textContent = '\u2705 Download complete. Restart to install.';
          if (updateBar) { updateBar.style.background = 'rgba(16,185,129,0.9)'; updateBar.style.display = 'block'; updateBar.textContent = '\u2705 Update downloaded \u2014 restart to install'; }
        } else if (payload.status === 'error') {
          updateStatusText.style.color = '#f87171';
          updateStatusText.textContent = '\u274c Error: ' + (payload.message || 'unknown');
        }
      });

      // Dev System Log Console logic
      const logToggle = document.getElementById('logToggle');
      const logConsole = document.getElementById('logConsole');
      const logArrow = document.getElementById('logArrow');
      let logsExpanded = false;

      logToggle.addEventListener('click', () => {
        logsExpanded = !logsExpanded;
        logConsole.style.display = logsExpanded ? 'block' : 'none';
        logArrow.textContent = logsExpanded ? '▲' : '▼';
        if (logsExpanded) {
          logConsole.scrollTop = logConsole.scrollHeight;
        }
      });

      function appendLog(log) {
        const div = document.createElement('div');
        div.style.marginBottom = '0.2rem';
        div.innerHTML = '<span style="color:#64748b;">[' + log.timestamp + ']</span> <span style="color:#cbd5e1;">' + log.message + '</span>';
        logConsole.appendChild(div);
        if (logConsole.children.length > 50) {
          logConsole.removeChild(logConsole.firstChild);
        }
        logConsole.scrollTop = logConsole.scrollHeight;
      }

      ipcRenderer.invoke('get-agent-logs').then((logs) => {
        if (logs && Array.isArray(logs)) {
          logs.forEach(appendLog);
        }
      });

      ipcRenderer.on('agent-log-updated', (_, log) => {
        appendLog(log);
      });
    })();
  </script>
</body>
</html>`;

  lockWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  lockWindow.on('close', (e) => {
    if (isLocked && !isAppQuitting) {
      e.preventDefault();
    }
  });

  // Immediately steal focus back if lock window loses it
  lockWindow.on('blur', () => {
    if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
      setTimeout(() => {
        if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
          lockWindow.focus();
          lockWindow.moveTop();
        }
      }, 100);
    }
  });

  startLockEnforcement();
}

// ─── TCP send helper ───────────────────────────────────────────────────────────
function sendToServer(data: any) {
  if (tcpSocket && !tcpSocket.destroyed) {
    tcpSocket.write(JSON.stringify(data) + '\n');
  }
}

// ─── Server message handler ────────────────────────────────────────────────────
async function handleServerMessage(msg: any) {
  try {
    logToUI(`Received server command: ${msg.command || 'unknown'}`);
    if (msg.command === 'login-success') {
      logToUI(`Server approved member login. Unlocking terminal.`);
      if (pendingLoginResolve) {
        pendingLoginResolve({ success: true });
        pendingLoginResolve = null;
      }
      currentUser = msg.user;
      isLocked = false;
      stopLockEnforcement();
      if (lockWindow) {
        logToUI(`Destroying lock screen window.`);
        lockWindow.destroy();
        lockWindow = null;
      } else {
        logToUI(`Lock screen window not present or already destroyed.`);
      }
    } else if (msg.command === 'login-fail') {
      logToUI(`Server rejected member login: ${msg.message || 'Invalid credentials'}`);
      if (pendingLoginResolve) {
        pendingLoginResolve({ success: false, message: msg.message || 'Invalid credentials.' });
        pendingLoginResolve = null;
      }
    } else if (msg.command === 'unlock') {
      logToUI(`Server requested unlock. Setting isLocked = false, currentUser = ${msg.user || 'Guest'}.`);
      isLocked = false;
      currentUser = msg.user || null;
      stopLockEnforcement();
      if (lockWindow) {
        logToUI(`Destroying lock screen window.`);
        lockWindow.destroy();
        lockWindow = null;
      } else {
        logToUI(`Lock screen window not present or already destroyed.`);
      }
    } else if (msg.command === 'lock') {
      logToUI(`Server requested lock. Setting isLocked = true.`);
      isLocked = true;
      currentUser = null;
      if (!lockWindow) {
        logToUI(`Creating new lock screen window.`);
        createLockWindow();
      } else {
        logToUI(`Lock screen window already exists. Restarting lock enforcement.`);
        startLockEnforcement();
      }
    } else if (msg.command === 'message') {
      if (!isLocked) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Message from Operator',
          message: msg.payload || ''
        });
      }
    } else if (msg.command === 'poweroff') {
      if (process.platform === 'win32') {
        exec('shutdown /s /f /t 0');
      } else {
        exec('shutdown -h now');
      }
    } else if (msg.command === 'restart') {
      if (process.platform === 'win32') {
        exec('shutdown /r /f /t 0');
      } else {
        exec('reboot');
      }
    } else if (msg.command === 'limit-bandwidth') {
      const rate = msg.payload?.rate || '2mbit';
      await applyBandwidthLimit(rate);
    } else if (msg.command === 'remove-bandwidth') {
      await removeBandwidthLimit();
    } else if (msg.command === 'capture-screenshot') {
      try {
        const base64 = await captureScreen();
        sendToServer({ type: 'screenshot-response', payload: base64 });
      } catch (err: any) {
        console.error(err);
      }
    } else if (msg.command === 'execute-command') {
      const { commandLine } = msg.payload || {};
      logToUI(`Executing remote command: ${commandLine}`);
      exec(commandLine, { timeout: 15000 }, (error, stdout, stderr) => {
        const output = stdout + (stderr ? '\n' + stderr : '') + (error ? '\nError: ' + error.message : '');
        logToUI(`Command output sent back to server.`);
        sendToServer({
          type: 'command-result',
          payload: {
            commandLine,
            output: output || 'Command executed with no output.',
            success: !error
          }
        });
      });
    } else if (msg.command === 'remote-input') {
      const { action, x, y, button, value } = msg.payload || {};
      if (process.platform === 'win32' && psProcess && psProcess.stdin && !psProcess.killed) {
        if (action === 'click') {
          psProcess.stdin.write(`Send-MouseClick "${button || 'left'}" ${x} ${y}\n`);
        } else if (action === 'mousedown') {
          psProcess.stdin.write(`Send-MouseDown "${button || 'left'}" ${x} ${y}\n`);
        } else if (action === 'mouseup') {
          psProcess.stdin.write(`Send-MouseUp "${button || 'left'}" ${x} ${y}\n`);
        } else if (action === 'move') {
          psProcess.stdin.write(`Set-MousePos ${x} ${y}\n`);
        } else if (action === 'keys') {
          const escaped = (value || '').replace(/"/g, '`"');
          psProcess.stdin.write(`Send-Keys "${escaped}"\n`);
        }
      }
    } else if (msg.command === 'update-blockrules') {
      activeBlockRules = msg.rules || [];

      // Enforce website blocking immediately
      const domains = activeBlockRules.filter(r => r.type === 'domain').map(r => r.value);
      applyHostBlocking(domains);
    } else if (msg.command === 'set-mirror-quality') {
      const highRes = !!msg.payload?.highRes;
      updateMirrorSettings(highRes);
    } else if (msg.command === 'block-inputs') {
      const block = !!msg.payload?.block;
      if (process.platform === 'win32' && psProcess && psProcess.stdin && !psProcess.killed) {
        psProcess.stdin.write(`Set-BlockInput $${block ? 'true' : 'false'}\n`);
        logToUI(`Hardware inputs block state set to: ${block}`);
      }
    }
  } catch (e) {
    console.error('handleServerMessage error:', e);
  }
}

// ─── IPC: User login bridge ────────────────────────────────────────────────────
ipcMain.handle('agent-user-login', (_event, username: string, password: string): Promise<{ success: boolean; message?: string }> => {
  return new Promise((resolve) => {
    if (!tcpSocket || tcpSocket.destroyed) {
      resolve({ success: false, message: 'Not connected to server. Please try again.' });
      return;
    }
    // Store resolver to be called when server responds
    pendingLoginResolve = resolve;
    // Set a timeout in case server doesn't respond
    const timeout = setTimeout(() => {
      if (pendingLoginResolve === resolve) {
        pendingLoginResolve = null;
        resolve({ success: false, message: 'Server did not respond. Please try again.' });
      }
    }, 8000);
    sendToServer({ type: 'user-login', payload: { username, password } });
    // Clear timeout if resolved early
    const origResolve = resolve;
    pendingLoginResolve = (result) => {
      clearTimeout(timeout);
      pendingLoginResolve = null;
      origResolve(result);
    };
  });
});

ipcMain.handle('save-agent-config', (_event, newServerUrl: string, newMachineId: string) => {
  try {
    const { host, port } = parseServerAddress(newServerUrl.trim());
    serverHost = host;
    serverPort = port;
    serverUrl = `${serverHost}:${serverPort}`;
    machineId = newMachineId;
    fs.writeFileSync(configPath, JSON.stringify({ serverUrl: `tcp://${serverUrl}`, machineId }, null, 2), 'utf8');

    // Close existing socket and reconnect immediately
    if (tcpSocket) {
      try {
        tcpSocket.removeAllListeners('close');
        tcpSocket.destroy();
      } catch {}
      tcpSocket = null;
    }
    connectToServer();

    // Destroy and recreate lock screen window to reflect new config
    if (lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.destroy();
      lockWindow = null;
      createLockWindow();
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// ─── Shell replacement IPC handlers ───────────────────────────────────────────
ipcMain.handle('install-as-shell', () => {
  installAsShell();
  return { success: true };
});

ipcMain.handle('restore-shell', () => {
  restoreShell();
  return { success: true };
});

ipcMain.handle('get-shell-status', () => {
  try {
    const current = execSync('reg query "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell 2>nul').toString();
    const isShell = current.includes(process.execPath);
    return { isShell, current };
  } catch {
    return { isShell: false, current: 'explorer.exe' };
  }
});

// ─── Shell replacement functions ───────────────────────────────────────────────
function installAsShell() {
  try {
    const exePath = process.execPath;
    // Set shell for current user
    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell /t REG_SZ /d "${exePath}" /f`);
    console.log('Shell replacement installed for current user');
  } catch (e) {
    console.error('Failed to install as shell:', e);
  }
}

function restoreShell() {
  try {
    execSync(`reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell /t REG_SZ /d "explorer.exe" /f`);
    console.log('Shell restored to explorer.exe');
  } catch (e) {
    console.error('Failed to restore shell:', e);
  }
}

// ─── OS metrics Helpers ────────────────────────────────────────────────────────
function cpuAverage() {
  let totalIdle = 0, totalTick = 0;
  const cpus = os.cpus();
  for (let i = 0, len = cpus.length; i < len; i++) {
    const cpu = cpus[i];
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function getCPUUsage(): Promise<number> {
  return new Promise((resolve) => {
    const startMeasure = cpuAverage();
    setTimeout(() => {
      const endMeasure = cpuAverage();
      const idleDifference = endMeasure.idle - startMeasure.idle;
      const totalDifference = endMeasure.total - startMeasure.total;
      const percentageCPU = 100 - Math.round((100 * idleDifference) / totalDifference);
      resolve(percentageCPU);
    }, 100);
  });
}

function getActiveWindowTitle(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const psCmd = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); }'; $fg = [Win32]::GetForegroundWindow(); (Get-Process | Where-Object { $_.MainWindowHandle -eq $fg }).MainWindowTitle"`;
      exec(psCmd, (err, stdout) => {
        if (err) {
          resolve('System');
        } else {
          resolve(stdout.trim() || 'Desktop');
        }
      });
    } else {
      exec('xdotool getactivewindow getwindowname', (err, stdout) => {
        if (err || !stdout) {
          resolve('Desktop / Shell');
        } else {
          resolve(stdout.trim());
        }
      });
    }
  });
}

async function captureScreen(): Promise<string> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
  if (sources.length > 0) {
    const pngBuffer = sources[0].thumbnail.toPNG();
    return pngBuffer.toString('base64');
  }
  throw new Error('No screen sources found');
}

function applyHostBlocking(domains: string[]) {
  const hostsPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';
  try {
    if (!fs.existsSync(hostsPath)) return;
    let content = fs.readFileSync(hostsPath, 'utf8');
    
    const startMarker = '# === NETCAFE BLOCKLIST START ===';
    const endMarker = '# === NETCAFE BLOCKLIST END ===';
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    
    if (startIndex !== -1 && endIndex !== -1) {
      content = content.substring(0, startIndex) + content.substring(endIndex + endMarker.length);
    }
    
    if (domains.length > 0) {
      let blockSection = `\n${startMarker}\n`;
      domains.forEach((d) => {
        blockSection += `127.0.0.1 ${d}\n`;
        if (!d.startsWith('www.')) {
          blockSection += `127.0.0.1 www.${d}\n`;
        }
      });
      blockSection += `${endMarker}\n`;
      content = content.trim() + blockSection;
    }
    
    fs.writeFileSync(hostsPath, content, 'utf8');
  } catch (e) {
    console.error('Failed to write hosts file (requires root/admin privileges):', e);
  }
}

function enforceAppBlocking(executables: string[]) {
  if (executables.length === 0) return;
  if (process.platform === 'win32') {
    executables.forEach((exe) => {
      exec(`taskkill /F /IM ${exe}`, () => {});
    });
  } else {
    executables.forEach((exe) => {
      const name = exe.toLowerCase().endsWith('.exe') ? exe.slice(0, -4) : exe;
      exec(`pkill -f ${name}`, () => {});
    });
  }
}

function getDefaultInterface(): Promise<string> {
  return new Promise((resolve) => {
    exec("ip route | grep default", (err, stdout) => {
      if (err || !stdout) {
        return resolve('eth0');
      }
      const parts = stdout.trim().split(/\s+/);
      const devIndex = parts.indexOf('dev');
      if (devIndex !== -1 && parts[devIndex + 1]) {
        resolve(parts[devIndex + 1]);
      } else {
        resolve('eth0');
      }
    });
  });
}

function applyBandwidthLimit(rate: string): Promise<void> {
  return new Promise(async (resolve) => {
    if (process.platform !== 'linux') return resolve();
    const iface = await getDefaultInterface();
    exec(`tc qdisc del dev ${iface} root`, () => {
      exec(`tc qdisc add dev ${iface} root tbf rate ${rate} burst 32kbit latency 400ms`, (err) => {
        if (err) console.error(`Failed to apply bandwidth limit on ${iface}:`, err);
        resolve();
      });
    });
  });
}

function removeBandwidthLimit(): Promise<void> {
  return new Promise(async (resolve) => {
    if (process.platform !== 'linux') return resolve();
    const iface = await getDefaultInterface();
    exec(`tc qdisc del dev ${iface} root`, (err) => {
      if (err) {
        // Safe to ignore errors if no limit was set
      }
      resolve();
    });
  });
}

let mirrorInterval: NodeJS.Timeout | null = null;
let mirrorWidth = 400;
let mirrorHeight = 225;
let mirrorQuality = 40;
let mirrorIntervalMs = 1500;

function startScreenMirroring() {
  if (mirrorInterval) return;
  mirrorInterval = setInterval(async () => {
    if (tcpSocket && !tcpSocket.destroyed) {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: mirrorWidth, height: mirrorHeight }
        });
        if (sources.length > 0) {
          const jpegBase64 = sources[0].thumbnail.toJPEG(mirrorQuality).toString('base64');
          sendToServer({ type: 'screen-frame', payload: jpegBase64 });
        }
      } catch (err) {
        // silently ignore capture errors
      }
    }
  }, mirrorIntervalMs);
}

function stopScreenMirroring() {
  if (mirrorInterval) {
    clearInterval(mirrorInterval);
    mirrorInterval = null;
  }
}

function updateMirrorSettings(highRes: boolean) {
  const newWidth = highRes ? 1024 : 400;
  const newHeight = highRes ? 576 : 225;
  const newQuality = highRes ? 70 : 40;
  const newInterval = highRes ? 1000 : 1500;

  if (newWidth !== mirrorWidth || newHeight !== mirrorHeight || newQuality !== mirrorQuality || newInterval !== mirrorIntervalMs) {
    mirrorWidth = newWidth;
    mirrorHeight = newHeight;
    mirrorQuality = newQuality;
    mirrorIntervalMs = newInterval;
    
    if (mirrorInterval) {
      stopScreenMirroring();
      startScreenMirroring();
    }
    logToUI(`Updated mirror settings: highRes=${highRes} (${mirrorWidth}x${mirrorHeight}, quality=${mirrorQuality}, interval=${mirrorIntervalMs}ms)`);
  }
}

// ─── TCP Connection ────────────────────────────────────────────────────────────
function connectToServer() {
  const socket = new net.Socket();
  tcpSocket = socket;
  let buffer = '';

  logToUI(`Attempting to connect to server at tcp://${serverHost}:${serverPort}...`);
  socket.connect(serverPort, serverHost, () => {
    logToUI(`Connected to server successfully!`);
    const mac = getMACAddress() || machineId;
    sendToServer({ type: 'register', payload: { mac_address: mac, name: machineId, ip_address: getIPAddress() } });
    startScreenMirroring();
  });

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleServerMessage(JSON.parse(line));
      } catch (e: any) { 
        logToUI(`TCP parse error: ${e.message}`);
        console.error('TCP parse error:', e); 
      }
    }
  });

  socket.on('close', () => {
    logToUI('Disconnected from server. Retrying in 5 seconds...');
    tcpSocket = null;
    stopScreenMirroring();
    
    // Safety unblock of hardware inputs on connection loss
    if (process.platform === 'win32' && psProcess && psProcess.stdin && !psProcess.killed) {
      psProcess.stdin.write("Set-BlockInput $false\n");
    }
    
    // Enforce lock immediately upon server disconnection
    isLocked = true;
    currentUser = null;
    if (!lockWindow || lockWindow.isDestroyed()) {
      lockWindow = null;
      createLockWindow();
    } else {
      startLockEnforcement();
    }
    
    setTimeout(connectToServer, 5000);
  });

  socket.on('error', (err: any) => {
    let explanation = '';
    if (err.code === 'ETIMEDOUT') {
      explanation = ' (Connection timed out. Check Windows Firewall on the Server PC and verify port 9000 TCP is allowed/open.)';
    } else if (err.code === 'ECONNREFUSED') {
      explanation = ' (Connection refused. Check if NetCafe Server is actually running on the target PC.)';
    } else if (err.code === 'EHOSTUNREACH') {
      explanation = ' (Host unreachable. Verify both computers are connected to the same LAN / network.)';
    }
    logToUI(`TCP connection error: ${err.message}${explanation}`);
    console.error('TCP error:', err.message);
    // close event will handle reconnect
  });
}

function getIPAddress() {
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

function getMACAddress() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac.toLowerCase();
        }
      }
    }
  } catch (e) {
    console.error('Failed to get MAC address:', e);
  }
  return '';
}

function setupWindowsFirewall() {
  if (process.platform !== 'win32') return;
  logToUI('Checking Windows Firewall rules for NetCafe Agent...');
  exec('netsh advfirewall firewall show rule name="NetCafe Agent UDP"', (err, stdout) => {
    if (err || !stdout.includes('NetCafe Agent UDP')) {
      logToUI('Firewall rule "NetCafe Agent UDP" not found. Attempting to add...');
      exec('netsh advfirewall firewall add rule name="NetCafe Agent UDP" dir=in action=allow protocol=UDP localport=9090 profile=any', (addErr) => {
        if (addErr) {
          logToUI(`Warning: Failed to add UDP firewall rule: ${addErr.message}`);
        } else {
          logToUI('Successfully added Windows Firewall rule for UDP port 9090 (all profiles).');
        }
      });
    } else {
      logToUI('Windows Firewall rule for UDP port 9090 already exists.');
    }
  });
}

let udpListener: dgram.Socket | null = null;
let updateReady = false;
function startUdpDiscovery() {
  if (udpListener) return;
  logToUI('Starting UDP Discovery Listener on port 9090...');
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    // If we're already connected to the server, ignore UDP broadcasts
    if (tcpSocket && !tcpSocket.destroyed) return;

    try {
      const data = JSON.parse(msg.toString());
      logToUI(`UDP Discovery: Received broadcast from ${rinfo.address}:${rinfo.port} (service: ${data.service})`);
      if (data.service === 'netcafe-server' && data.wsUrl) {
        const { host, port } = parseServerAddress(data.wsUrl);
        if (host !== serverHost || port !== serverPort) {
          logToUI(`UDP Discovery: New NetCafe Server discovered at tcp://${host}:${port}. Updating configuration.`);
          serverHost = host;
          serverPort = port;
          serverUrl = `${host}:${port}`;
          try {
            fs.writeFileSync(configPath, JSON.stringify({ serverUrl: `tcp://${serverUrl}`, machineId }, null, 2), 'utf8');

            // Re-create the lock screen to update variables in the template literal
            if (lockWindow && !lockWindow.isDestroyed()) {
              logToUI('UDP Discovery: Re-creating lock screen window to apply updated server IP.');
              lockWindow.destroy();
              lockWindow = null;
              createLockWindow();
            }
          } catch (e: any) {
            logToUI(`UDP Discovery: Failed to save config: ${e.message}`);
            console.error('Failed to save discovered config:', e);
          }

          if (tcpSocket) {
            try { 
              logToUI('UDP Discovery: Disconnecting existing TCP socket for new connection.');
              tcpSocket.removeAllListeners('close'); 
              tcpSocket.destroy(); 
              tcpSocket = null; 
            } catch {}
          }
          connectToServer();
        }
      }
    } catch (e: any) {
      logToUI(`UDP Discovery: Failed to parse broadcast packet: ${e.message}`);
    }
  });

  socket.on('error', (err) => {
    logToUI(`UDP Discovery Listener error: ${err.message}`);
    console.error('UDP Listener error:', err);
    try {
      socket.close();
    } catch {}
    udpListener = null;
    setTimeout(startUdpDiscovery, 10000);
  });

  try {
    socket.bind(9090, () => {
      logToUI('UDP Discovery Listener bound successfully on port 9090.');
    });
    udpListener = socket;
  } catch (err: any) {
    logToUI(`Failed to bind UDP Discovery Listener on port 9090: ${err.message}`);
    console.error('Failed to bind UDP Listener:', err);
    udpListener = null;
  }
}

let psProcess: any = null;

function initPowerShell() {
  if (process.platform !== 'win32') return;
  try {
    psProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    psProcess.stdin.write(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$memberDefinition = @'
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
[DllImport("user32.dll")]
public static extern bool BlockInput(bool fBlockIt);
'@
$type = Add-Type -MemberDefinition $memberDefinition -Name "Win32Mouse" -Namespace "Win32" -PassThru
function Set-MousePos($x, $y) {
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
}
function Set-BlockInput($block) {
  $type::BlockInput($block)
}
function Send-MouseClick($btn, $x, $y) {
  if ($x -ne $null -and $y -ne $null) {
    Set-MousePos $x $y
  }
  if ($btn -eq "left") {
    $type::mouse_event(0x0002, 0, 0, 0, 0)
    $type::mouse_event(0x0004, 0, 0, 0, 0)
  } elseif ($btn -eq "right") {
    $type::mouse_event(0x0008, 0, 0, 0, 0)
    $type::mouse_event(0x0010, 0, 0, 0, 0)
  } elseif ($btn -eq "double") {
    $type::mouse_event(0x0002, 0, 0, 0, 0)
    $type::mouse_event(0x0004, 0, 0, 0, 0)
    $type::mouse_event(0x0002, 0, 0, 0, 0)
    $type::mouse_event(0x0004, 0, 0, 0, 0)
  }
}
function Send-MouseDown($btn, $x, $y) {
  if ($x -ne $null -and $y -ne $null) {
    Set-MousePos $x $y
  }
  if ($btn -eq "left") {
    $type::mouse_event(0x0002, 0, 0, 0, 0)
  } elseif ($btn -eq "right") {
    $type::mouse_event(0x0008, 0, 0, 0, 0)
  } elseif ($btn -eq "middle") {
    $type::mouse_event(0x0020, 0, 0, 0, 0)
  }
}
function Send-MouseUp($btn, $x, $y) {
  if ($x -ne $null -and $y -ne $null) {
    Set-MousePos $x $y
  }
  if ($btn -eq "left") {
    $type::mouse_event(0x0004, 0, 0, 0, 0)
  } elseif ($btn -eq "right") {
    $type::mouse_event(0x0010, 0, 0, 0, 0)
  } elseif ($btn -eq "middle") {
    $type::mouse_event(0x0040, 0, 0, 0, 0)
  }
}
function Send-Keys($keys) {
  try {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
  } catch {}
}
\n`);
    psProcess.on('exit', () => {
      psProcess = null;
      setTimeout(initPowerShell, 1000);
    });
    psProcess.on('error', (err: any) => {
      console.error('PowerShell process error:', err);
    });
  } catch (err) {
    console.error('Failed to init PowerShell process:', err);
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    initPowerShell();
  }
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    const args = [process.execPath, ...process.argv.slice(1)];
    const child = spawn('pkexec', args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    app.quit();
    return;
  }

  loadConfig();
  setupWindowsFirewall();
  startUdpDiscovery();
  createLockWindow();
  connectToServer();

  // Auto Updater logic for Agent
  autoUpdater.channel = 'latest-agent';   // ← must NOT pick up latest-server.yml
  autoUpdater.autoDownload = false;       // manual download from operator panel
  autoUpdater.checkForUpdates().catch((err: unknown) => console.error("Agent update check failed:", err));

  function sendUpdateStatus(payload: object) {
    if (lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.webContents.send('agent-update-status', payload);
    }
  }

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
  autoUpdater.on('update-available', (info: any) => sendUpdateStatus({ status: 'available', info }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ status: 'not-available' }));
  autoUpdater.on('error', (err: Error) => sendUpdateStatus({ status: 'error', message: err.message }));
  autoUpdater.on('download-progress', (progress: any) => sendUpdateStatus({ status: 'downloading', progress }));
  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    sendUpdateStatus({ status: 'downloaded' });
    // Rebuild lock window to show the downloaded banner
    if (isLocked) {
      createLockWindow();
    }
    // Automatically apply update and restart after 3 seconds
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 3000);
  });

  // Manual IPC from operator panel
  ipcMain.handle('manual-check-for-updates', () => {
    autoUpdater.checkForUpdates().catch((err: Error) => sendUpdateStatus({ status: 'error', message: err.message }));
  });
  ipcMain.handle('manual-download-update', () => {
    autoUpdater.downloadUpdate().catch((err: Error) => sendUpdateStatus({ status: 'error', message: err.message }));
  });
  ipcMain.handle('get-agent-logs', () => {
    return agentLogsCache;
  });

  // ─── Block common keyboard bypass shortcuts ────────────────────────────────
  // Ctrl+Shift+Escape: Task Manager
  globalShortcut.register('Control+Shift+Escape', () => {
    if (isLocked) return false;
  });
  // Alt+F4: Close application
  globalShortcut.register('Alt+F4', () => {
    if (isLocked) return false;
  });
  // Win+D: Show Desktop
  globalShortcut.register('Super+D', () => {
    if (isLocked) return false;
  });
  // Win+L: Lock Windows (prevents double-lock confusion)
  globalShortcut.register('Super+L', () => {
    if (isLocked) return false;
  });
  // Alt+Tab: Switch windows
  globalShortcut.register('Alt+Tab', () => {
    if (isLocked) return false;
  });
  // Ctrl+Alt+Tab
  globalShortcut.register('Control+Alt+Tab', () => {
    if (isLocked) return false;
  });
  // Win+Tab: Task View
  globalShortcut.register('Super+Tab', () => {
    if (isLocked) return false;
  });

  // ─── Steal focus back if any other window gets focus while locked ──────────
  app.on('browser-window-focus', (_event, win) => {
    if (isLocked && lockWindow && !lockWindow.isDestroyed() && win !== lockWindow) {
      setTimeout(() => {
        if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
          lockWindow.focus();
          lockWindow.moveTop();
        }
      }, 50);
    }
  });

  // ─── Metrics interval (10 seconds) ────────────────────────────────────────
  metricsInterval = setInterval(async () => {
    if (tcpSocket && !tcpSocket.destroyed) {
      const cpu = await getCPUUsage();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const ram = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);
      const activeWindow = await getActiveWindowTitle();

      let resolution = { width: 1920, height: 1080 };
      try {
        const primaryDisplay = screen.getPrimaryDisplay();
        resolution = primaryDisplay.size;
      } catch (err) {}

      sendToServer({
        type: 'metrics',
        payload: {
          cpu,
          ram,
          activeWindow,
          os: `${os.type()} ${os.release()}`,
          uptime: os.uptime(),
          ip: getIPAddress(),
          resolution
        }
      });
    }
  }, 10000);

  // ─── App blocking interval (3 seconds) ────────────────────────────────────
  blockInterval = setInterval(() => {
    const blockedExes = activeBlockRules.filter(r => r.type === 'executable').map(r => r.value);
    if (blockedExes.length > 0) {
      enforceAppBlocking(blockedExes);
    }
  }, 3000);
});

app.on('window-all-closed', () => {
  // Prevent quitting when lock window is closed
});

app.on('before-quit', () => {
  isAppQuitting = true;
});
