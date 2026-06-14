import { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, dialog, Tray, Menu } from 'electron';
import WebSocket from 'ws';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { exec, spawn } from 'child_process';

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
      <div class="info-line"><span class="info-label">Server</span><span class="info-value">${serverUrl}</span></div>
      <div class="info-line"><span class="info-label">Config</span><span class="info-value">${configPath}</span></div>
    </div>
    <div class="footer">Do not power off this terminal.</div>
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
  const socket = new WebSocket(serverUrl);
  ws = socket;

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
  createLockWindow();
  connectToServer();

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
