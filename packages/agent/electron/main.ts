import { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, dialog, Tray, Menu } from 'electron';
import { autoUpdater } from 'electron-updater';
import WebSocket from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import dgram from 'dgram';

let lockWindow: BrowserWindow | null = null;
let ws: WebSocket | null = null;
let isLocked = true;
let activeBlockRules: any[] = [];
let blockInterval: NodeJS.Timeout | null = null;
let metricsInterval: NodeJS.Timeout | null = null;
let lockEnforceInterval: NodeJS.Timeout | null = null;
let pendingLoginResolve: ((result: { success: boolean; message?: string }) => void) | null = null;
let currentUser: string | null = null;

const configPath = path.join(app.getPath('userData'), 'config.json');
let serverUrl = 'ws://127.0.0.1:9000';
let machineId = os.hostname();

function loadConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data.serverUrl) serverUrl = data.serverUrl;
      if (data.machineId) machineId = data.machineId;
    } else {
      fs.writeFileSync(configPath, JSON.stringify({ serverUrl, machineId }, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Failed to load/write config:', e);
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
      <div class="info-line"><span class="info-label">Server</span><span class="info-value" id="infoServerUrl">${serverUrl}</span></div>
      <div class="info-line"><span class="info-label">Terminal</span><span class="info-value">${machineId}</span></div>
      <div class="info-line"><span class="info-label">Config</span><span class="info-value">${configPath}</span></div>
    </div>
    <div class="footer">Do not power off this terminal.</div>
  </div>

  ${updateReady ? `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:white;padding:10px 20px;border-radius:20px;font-weight:600;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;">✅ Update downloaded — will install on next restart</div>` : ''}

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
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;display:block;margin-bottom:0.35rem;">Server URL</label>
          <input type="text" id="cfgServerUrl" placeholder="ws://192.168.1.10:9000" autocomplete="off"
            style="width:100%;padding:0.65rem 0.9rem;background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e2e8f0;font-size:0.88rem;outline:none;" />
          <div style="margin-top:0.3rem;font-size:0.7rem;color:#475569;">WebSocket address of the NetCafe server on your LAN</div>
        </div>
        <div style="margin-bottom:1.1rem;">
          <label style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;display:block;margin-bottom:0.35rem;">Terminal Name (Machine ID)</label>
          <input type="text" id="cfgMachineId" placeholder="PC-01" autocomplete="off"
            style="width:100%;padding:0.65rem 0.9rem;background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e2e8f0;font-size:0.88rem;outline:none;" />
          <div style="margin-top:0.3rem;font-size:0.7rem;color:#475569;">Unique name for this terminal shown on the server dashboard</div>
        </div>
        <div id="cfgStatus" style="margin-bottom:0.75rem;padding:0.5rem 0.75rem;border-radius:8px;font-size:0.78rem;display:none;"></div>
        <div style="display:flex;gap:0.5rem;">
          <button id="cfgCancelBtn"
            style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#94a3b8;font-size:0.85rem;font-weight:600;cursor:pointer;">
            Cancel
          </button>
          <button id="cfgSaveBtn"
            style="flex:2;padding:0.6rem;background:linear-gradient(135deg,#3b82f6,#6366f1);border:none;border-radius:10px;color:white;font-size:0.88rem;font-weight:700;cursor:pointer;">
            Save &amp; Reconnect
          </button>
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

      function showConfigForm() {
        pinGate.style.display = 'none';
        configForm.style.display = 'block';
        // Pre-fill current values from the info panel
        cfgServerUrl.value = document.getElementById('infoServerUrl').textContent || '${serverUrl}';
        cfgMachineId.value = '${machineId}';
        setTimeout(() => cfgServerUrl.focus(), 100);
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
            cfgStatus.textContent = '✅ Configuration saved! Reconnecting...';
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
    })();
  </script>
</body>
</html>`;

  lockWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  lockWindow.on('close', (e) => {
    if (isLocked) {
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

// ─── IPC: User login bridge ────────────────────────────────────────────────────
ipcMain.handle('agent-user-login', (_event, username: string, password: string): Promise<{ success: boolean; message?: string }> => {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
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
    ws.send(JSON.stringify({ type: 'user-login', payload: { username, password } }));
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
    let normalizedUrl = newServerUrl.trim();
    if (!normalizedUrl.startsWith('ws://') && !normalizedUrl.startsWith('wss://')) {
      normalizedUrl = 'ws://' + normalizedUrl;
    }
    
    // Auto-append port :9000 if not specified
    try {
      const parsed = new URL(normalizedUrl);
      if (!parsed.port) {
        normalizedUrl = `${parsed.protocol}//${parsed.hostname}:9000${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/$/, '');
      }
    } catch (e) {
      if (!/:[0-9]+$/.test(normalizedUrl)) {
        normalizedUrl = normalizedUrl + ':9000';
      }
    }

    serverUrl = normalizedUrl;
    machineId = newMachineId;
    fs.writeFileSync(configPath, JSON.stringify({ serverUrl, machineId }, null, 2), 'utf8');
    
    // Close existing socket and reconnect immediately
    if (ws) {
      try {
        ws.removeAllListeners('close');
        ws.close();
      } catch {}
      ws = null;
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

function connectToServer() {
  let socket: WebSocket;
  try {
    socket = new WebSocket(serverUrl);
    ws = socket;
  } catch (err) {
    console.error('WebSocket connection failed synchronously:', err);
    setTimeout(connectToServer, 5000);
    return;
  }

  socket.on('open', () => {
    console.log('Connected to server');
    socket.send(JSON.stringify({
      type: 'register',
      payload: { mac_address: machineId, name: machineId, ip_address: getIPAddress() }
    }));
  });

  socket.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.command === 'login-success') {
        // User successfully authenticated via lock screen form
        if (pendingLoginResolve) {
          pendingLoginResolve({ success: true });
        }
        currentUser = msg.user;
        isLocked = false;
        stopLockEnforcement();
        if (lockWindow) {
          lockWindow.destroy();
          lockWindow = null;
        }
      } else if (msg.command === 'login-fail') {
        // User authentication failed
        if (pendingLoginResolve) {
          pendingLoginResolve({ success: false, message: msg.message || 'Invalid credentials.' });
        }
      } else if (msg.command === 'unlock') {
        isLocked = false;
        currentUser = msg.user || null;
        stopLockEnforcement();
        if (lockWindow) {
          lockWindow.destroy();
          lockWindow = null;
        }
      } else if (msg.command === 'lock') {
        isLocked = true;
        currentUser = null;
        if (!lockWindow) {
          createLockWindow();
        } else {
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
          socket.send(JSON.stringify({
            type: 'screenshot-response',
            payload: base64
          }));
        } catch (err: any) {
          console.error(err);
        }
      } else if (msg.command === 'update-blockrules') {
        activeBlockRules = msg.rules || [];
        
        // Enforce website blocking immediately
        const domains = activeBlockRules.filter(r => r.type === 'domain').map(r => r.value);
        applyHostBlocking(domains);
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('close', () => {
    console.log('Disconnected, retrying in 5s');
    setTimeout(connectToServer, 5000);
  });
  
  socket.on('error', () => {});
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

let udpListener: dgram.Socket | null = null;
let updateReady = false;
function startUdpDiscovery() {
  if (udpListener) return;
  const socket = dgram.createSocket('udp4');
  
  socket.on('message', (msg, rinfo) => {
    // If we're already connected to the server, ignore UDP broadcasts
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }
    
    try {
      const data = JSON.parse(msg.toString());
      if (data.service === 'netcafe-server' && data.wsUrl) {
        if (serverUrl !== data.wsUrl) {
          console.log(`Auto-discovered new NetCafe Server at ${data.wsUrl}. Updating configuration.`);
          serverUrl = data.wsUrl;
          try {
            fs.writeFileSync(configPath, JSON.stringify({ serverUrl, machineId }, null, 2), 'utf8');
            
            // Re-create the lock screen to update variables in the template literal
            if (lockWindow && !lockWindow.isDestroyed()) {
              lockWindow.destroy();
              lockWindow = null;
              createLockWindow();
            }
          } catch (e) {
            console.error('Failed to save discovered config:', e);
          }
          
          if (ws) {
            ws.close();
          } else {
            connectToServer();
          }
        }
      }
    } catch (e) {
      // Ignore invalid JSON or malformed packets
    }
  });

  socket.on('error', (err) => {
    console.error('UDP Listener error:', err);
    try {
      socket.close();
    } catch {}
    udpListener = null;
    setTimeout(startUdpDiscovery, 10000);
  });

  try {
    socket.bind(9090, () => {
      console.log('UDP Discovery Listener bound on port 9090');
    });
    udpListener = socket;
  } catch (err) {
    console.error('Failed to bind UDP Listener:', err);
    udpListener = null;
  }
}

app.whenReady().then(() => {
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
  startUdpDiscovery();
  createLockWindow();
  connectToServer();

  // Auto Updater logic for Agent
  autoUpdater.autoDownload = true;
  autoUpdater.checkForUpdates().catch(err => console.error("Agent update check failed:", err));

  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    if (isLocked) {
      createLockWindow();
    }
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
    const currentWs = ws;
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      const cpu = await getCPUUsage();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const ram = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);
      const activeWindow = await getActiveWindowTitle();
      
      currentWs.send(JSON.stringify({
        type: 'metrics',
        payload: {
          cpu,
          ram,
          activeWindow,
          os: `${os.type()} ${os.release()}`,
          uptime: os.uptime(),
          ip: getIPAddress()
        }
      }));
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
