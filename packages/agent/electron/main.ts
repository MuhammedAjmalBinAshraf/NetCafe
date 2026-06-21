import { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, dialog, Tray, Menu, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { exec, execSync, spawn, execFileSync } from 'child_process';
import dgram from 'dgram';
import { MitmProxy } from './mitm-proxy';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance of NetCafe Agent is already running. Exiting.');
  app.quit();
  process.exit(0);
}

const IS_DEVELOPER_MODE = false;

let mitmProxy: MitmProxy | null = null;

let lockWindow: BrowserWindow | null = null;
let tcpSocket: net.Socket | null = null;
let isConnecting = false;
let isTcpConnected = false;
let isLocked = true;
let isAppQuitting = false;
let activeBlockRules: any[] = [];
let blockInterval: NodeJS.Timeout | null = null;
let metricsInterval: NodeJS.Timeout | null = null;
let lockEnforceInterval: NodeJS.Timeout | null = null;
let pendingLoginResolve: ((result: { success: boolean; message?: string }) => void) | null = null;
let currentUser: string | null = null;
let islandWindow: BrowserWindow | null = null;
let currentSessionData: any = null;
let pendingPasswordResolve: ((result: { success: boolean; message: string }) => void) | null = null;
let isFullscreenApp = false;
let fullscreenCheckInterval: NodeJS.Timeout | null = null;
const pendingQueryChecks = new Map<string, { resolve: (allowed: boolean) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();
let nextRequestId = 1;

const agentLogsCache: { timestamp: string, message: string }[] = [];
const runtimeLogFilePath = "C:\\NetCafe\\logs\\agent.log";

function writeAgentRuntimeLog(msg: string) {
  try {
    const dir = path.dirname(runtimeLogFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    fs.appendFileSync(runtimeLogFilePath, `[${timestamp}] ${msg}\r\n`, 'utf8');
  } catch (e) {
    console.error('Failed to write agent runtime log:', e);
  }
}

function resolveWinPath(cmd: string): string {
  if (process.platform !== 'win32') return cmd;
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  if (cmd === 'explorer.exe') {
    return path.join(sysRoot, 'explorer.exe');
  }
  if (cmd === 'powershell.exe') {
    return path.join(sysRoot, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  }
  if (cmd === 'taskkill.exe' || cmd === 'shutdown.exe' || cmd === 'sc.exe') {
    return path.join(sysRoot, 'System32', cmd);
  }
  return cmd;
}

function safeSpawn(command: string, args: string[] = [], options: any = {}) {
  const resolvedCmd = resolveWinPath(command);
  try {
    const child = spawn(resolvedCmd, args, options);
    child.on('error', (err) => {
      console.error(`SafeSpawn error for ${command} (resolved to ${resolvedCmd}):`, err);
      logToUI(`SafeSpawn error for ${command}: ${err.message}`);
    });
    return child;
  } catch (err: any) {
    console.error(`SafeSpawn exception for ${command} (resolved to ${resolvedCmd}):`, err);
    logToUI(`SafeSpawn exception for ${command}: ${err.message}`);
    const dummy = new (require('events').EventEmitter)();
    (dummy as any).unref = () => {};
    (dummy as any).stdout = new (require('events').EventEmitter)();
    (dummy as any).stderr = new (require('events').EventEmitter)();
    return dummy as any;
  }
}

function isAgentTheShell(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const current = execSync('reg query "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v Shell 2>nul').toString();
    return current.toLowerCase().includes('netcafe agent.exe') || current.toLowerCase().includes(process.execPath.toLowerCase());
  } catch {
    return false;
  }
}

function isDesktopShellRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(true);
      return;
    }
    exec('tasklist /FI "IMAGENAME eq explorer.exe" /FO CSV /NH 2>nul', { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      const running = stdout.toLowerCase().includes('explorer.exe');
      resolve(running);
    });
  });
}

function spawnExplorerShell() {
  if (process.platform !== 'win32') return;
  
  if (!isAgentTheShell()) {
    logToUI('Agent is not the registered shell. Spawning explorer.exe directly...');
    safeSpawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  
  const originalShell = process.execPath;
  const regPath = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
  
  logToUI('Temporarily resetting registry Shell to explorer.exe to force shell-mode...');
  try {
    execSync(`reg add "${regPath}" /v Shell /t REG_SZ /d "explorer.exe" /f`);
    logToUI('Spawning explorer.exe...');
    safeSpawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
    
    setTimeout(() => {
      try {
        logToUI('Restoring registry Shell override to NetCafe Agent...');
        execSync(`reg add "${regPath}" /v Shell /t REG_SZ /d "${originalShell}" /f`);
        logToUI('Registry Shell override restored successfully.');
      } catch (err: any) {
        logToUI(`Error restoring registry Shell override: ${err.message}`);
      }
    }, 2000);
  } catch (err: any) {
    logToUI(`Error setting registry Shell to explorer: ${err.message}`);
  }
}

function performSaveClientLog(): { success: boolean; path?: string; error?: string } {
  try {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '_' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '-' + pad(now.getSeconds());
    const filename = 'client log ' + timestamp + '.txt';
    const destPath = path.join(os.homedir(), filename);

    // Flush any cached logs to the runtime file first
    writeAgentRuntimeLog('--- Manual log diagnostic save triggered ---');

    if (fs.existsSync(runtimeLogFilePath)) {
      fs.copyFileSync(runtimeLogFilePath, destPath);
    } else {
      // If for some reason the file doesn't exist, create it with the cached logs
      const cacheData = agentLogsCache.map(e => '[' + e.timestamp + '] ' + e.message).join('\r\n');
      fs.writeFileSync(destPath, cacheData, 'utf8');
    }
    return { success: true, path: destPath };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

function saveClientLog() {
  const result = performSaveClientLog();
  if (result.success) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Diagnostics Log Saved',
      message: 'Client log has been successfully saved to:\n\n' + result.path,
      buttons: ['OK']
    });
  } else {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Diagnostics Log Error',
      message: 'Failed to save client log:\n\n' + result.error,
      buttons: ['OK']
    });
  }
}

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
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('agent-log-updated', logEntry);
  }
  writeAgentRuntimeLog(msg);

  if (IS_DEVELOPER_MODE && isTcpConnected && tcpSocket && !tcpSocket.destroyed && tcpSocket.writable) {
    try {
      tcpSocket.write(JSON.stringify({
        type: 'agent-log',
        payload: logEntry
      }) + '\n');
    } catch {}
  }
}

const configPath = path.join(app.getPath('userData'), 'config.json');
let serverUrl = '127.0.0.1:9000';   // display string (host:port)
let serverHost = '127.0.0.1';
let serverPort = 9000;
let machineId = os.hostname();
let clientUuid = '';
let operatorPassword = 'admin'; // synced from server via update-operator-password command

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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
    let data: any = {};
    if (fs.existsSync(configPath)) {
      data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    if (data.serverUrl) {
      const parsed = parseServerAddress(data.serverUrl);
      serverHost = parsed.host;
      serverPort = parsed.port;
      serverUrl = `${serverHost}:${serverPort}`;
    }
    if (data.machineId) machineId = data.machineId;
    if (data.operatorPassword) operatorPassword = data.operatorPassword;
    if (data.clientUuid) {
      clientUuid = data.clientUuid;
    } else {
      clientUuid = generateUUID();
      data.clientUuid = clientUuid;
      fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    }
    logToUI(`Loaded config: serverUrl=tcp://${serverHost}:${serverPort}, machineId=${machineId}, clientUuid=${clientUuid}`);
  } catch (e: any) {
    console.error('Failed to load/write config:', e);
    logToUI(`Failed to load/write config: ${e.message}`);
  }
}

// ─── Lock enforcement: re-focus every 500ms ───────────────────────────────────
function startLockEnforcement() {
  // NOTE: Do NOT guard with isAgentTheShell() — WMI Shell Launcher bypasses the
  // HKCU Winlogon\Shell registry key entirely, causing isAgentTheShell() to return
  // false even when the agent IS the kiosk shell. Always enforce lock on Windows.
  if (lockEnforceInterval) return;
  lockEnforceInterval = setInterval(() => {
    if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      lockWindow.focus();
      lockWindow.moveTop();
      // Re-enforce fullscreen/kiosk in case F11 or any other event toggled it off
      if (!lockWindow.isFullScreen()) lockWindow.setFullScreen(true);
      if (!lockWindow.isKiosk()) lockWindow.setKiosk(true);
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
    closable: false,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // ─── Block F11 at the Chromium input pipeline level (defense-in-depth) ──────
  // globalShortcut handles OS-level interception; before-input-event handles
  // any F11 that reaches the renderer process (e.g. from remote-desktop scenarios).
  lockWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      event.preventDefault();
    }
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <!-- No external font requests – using system fonts so the UI renders instantly offline -->
  <style>
    @import url('data:text/css,');
  </style>
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
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
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
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
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
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
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
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #unlockLoading {
      display: none;
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse at top, #0f172a 0%, #020617 60%);
      z-index: 99999;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.4s ease-out;
    }
  </style>
</head>
<body>
  <div id="unlockLoading">
    <div style="width: 50px; height: 50px; border: 3px solid rgba(59,130,246,0.1); border-top: 3px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
    <div style="margin-top: 1.5rem; font-size: 1.1rem; font-weight: 700; background: linear-gradient(135deg, #e2e8f0, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Preparing Desktop...</div>
    <div style="margin-top: 0.5rem; font-size: 0.8rem; color: #64748b;">Loading user shell and configuration</div>
  </div>

  <div id="autoUpdatingOverlay" style="display: none; position: fixed; inset: 0; background: radial-gradient(ellipse at top, #0f172a 0%, #020617 60%); z-index: 99999; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; box-sizing: border-box; overflow-y: auto;">
    <div style="width: 50px; height: 50px; border: 3px solid rgba(16,185,129,0.1); border-top: 3px solid #10b981; border-radius: 50%; animation: spin 1s linear infinite;"></div>
    <div style="margin-top: 1.5rem; font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, #34d399, #059669); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Installing Software Update...</div>
    <div style="margin-top: 0.5rem; font-size: 0.95rem; color: #94a3b8;" id="autoUpdateCountdown">Restarting in 15 seconds to apply update</div>
    <div style="margin-top: 0.25rem; font-size: 0.8rem; color: #64748b;">Estimated install time: 10-15 seconds. Please do not turn off your computer.</div>
    
    <div style="margin-top: 1.5rem; width: 100%; max-width: 600px; text-align: left;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b;">Installation & Setup Logs</span>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btnCopyUpdateLog" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.75rem; cursor: pointer; transition: background 0.15s;">📋 Copy Log</button>
          <button id="btnSaveUpdateLog" style="background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); color: #60a5fa; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.75rem; cursor: pointer; transition: background 0.15s;">💾 Save Log to File</button>
        </div>
      </div>
      <pre id="updateLogPre" style="background: #020617; border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 0.75rem; height: 180px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; color: #cbd5e1; line-height: 1.4; white-space: pre-wrap; word-break: break-all; user-select: text;"></pre>
      <div id="updateLogStatus" style="margin-top: 0.5rem; font-size: 0.75rem; font-weight: 600; text-align: center; display: none; padding: 0.4rem; border-radius: 6px;"></div>
    </div>
    
    <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
      <button id="btnRestartNow" style="background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; padding: 0.6rem 1.5rem; border-radius: 8px; font-size: 0.88rem; font-weight: 700; cursor: pointer; transition: opacity 0.15s;">Restart Now</button>
    </div>
  </div>

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



    <div class="footer" style="display:flex;justify-content:space-between;align-items:center;margin-top:1.25rem;">
      <button id="shutdownBtn" title="Shutdown/Restart is disabled" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#64748b;padding:0.35rem 0.65rem;font-family:'Inter', sans-serif;font-size:0.75rem;font-weight:700;cursor:not-allowed;display:flex;align-items:center;gap:0.35rem;">
        <span>⏻</span> <span>Shutdown (Disabled)</span>
      </button>
      <span style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);color:#60a5fa;padding:0.2rem 0.75rem;border-radius:9999px;font-size:0.68rem;font-weight:600;letter-spacing:0.04em;">v${app.getVersion()}</span>
    </div>
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

        <!-- Agent Logs Section -->
        <div style="margin-top:0.5rem;padding:0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div id="logToggle" style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;cursor:pointer;display:flex;align-items:center;gap:0.25rem;">
              <span>📋 Real-time Agent Logs</span>
              <span id="logArrow">▼</span>
            </div>
            <button id="modalSaveLogBtn" title="Save log to disk" style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:6px;color:#60a5fa;padding:0.25rem 0.5rem;font-family:'Inter', sans-serif;font-size:0.68rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:0.25rem;transition:all 0.15s;">
              <span>💾</span> <span>Save Log</span>
            </button>
          </div>
          <div id="modalSaveLogStatus" style="margin-top:0.4rem;padding:0.4rem;border-radius:6px;font-size:0.7rem;font-weight:600;display:none;word-break:break-all;"></div>
          <div id="logConsole" style="display:none;background:#020617;border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:0.5rem;height:125px;overflow-y:auto;font-family:monospace;font-size:0.68rem;color:#cbd5e1;line-height:1.4;word-break:break-all;margin-top:0.5rem;"></div>
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

      // ── Shutdown Button Logic ────────────────────────────────────────────────
      const shutdownBtn = document.getElementById('shutdownBtn');
      if (shutdownBtn) {
        shutdownBtn.addEventListener('click', () => {
          alert('Shutdown and Restart options are disabled on this terminal. Please use Member Login.');
          const usernameEl = document.getElementById('username');
          if (usernameEl) {
            usernameEl.focus();
          }
        });
      }

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

      const VALID_PINS = ['${operatorPassword}', '${operatorPassword}'];
      // Note: array kept for backwards compat; only operatorPassword is the active PIN


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
        // Pre-fill current values
        cfgServerUrl.value = '${serverHost}:${serverPort}';
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

      if (logToggle && logConsole && logArrow) {
        logToggle.addEventListener('click', () => {
          logsExpanded = !logsExpanded;
          logConsole.style.display = logsExpanded ? 'block' : 'none';
          logArrow.textContent = logsExpanded ? '▲' : '▼';
          if (logsExpanded) {
            logConsole.scrollTop = logConsole.scrollHeight;
          }
        });
      }

      function appendLog(log) {
        if (!logConsole) return;
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
        if (logs && Array.isArray(logs) && logConsole) {
          logs.forEach(appendLog);
        }
      });

      ipcRenderer.on('agent-log-updated', (_, log) => {
        appendLog(log);
      });

      ipcRenderer.on('show-auto-updating', (_, payload) => {
        const overlay = document.getElementById('autoUpdatingOverlay');
        const countdownEl = document.getElementById('autoUpdateCountdown');
        const logPre = document.getElementById('updateLogPre');
        if (overlay) {
          overlay.style.display = 'flex';
        }
        if (logPre) {
          logPre.textContent = payload.logs || 'No logs available.';
          logPre.scrollTop = logPre.scrollHeight;
        }

        let secondsLeft = 15;
        if (countdownEl) {
          countdownEl.textContent = 'Restarting in ' + secondsLeft + ' seconds to apply update';
        }

        const interval = setInterval(() => {
          secondsLeft--;
          if (countdownEl) {
            countdownEl.textContent = 'Restarting in ' + secondsLeft + ' seconds to apply update';
          }
          if (secondsLeft <= 0) {
            clearInterval(interval);
          }
        }, 1000);

        // Copy Log Button
        const btnCopyUpdateLog = document.getElementById('btnCopyUpdateLog');
        const updateLogStatus = document.getElementById('updateLogStatus');
        if (btnCopyUpdateLog) {
          btnCopyUpdateLog.addEventListener('click', () => {
            if (logPre) {
              navigator.clipboard.writeText(logPre.textContent).then(() => {
                if (updateLogStatus) {
                  updateLogStatus.style.background = 'rgba(16,185,129,0.12)';
                  updateLogStatus.style.color = '#6ee7b7';
                  updateLogStatus.style.border = '1px solid rgba(16,185,129,0.2)';
                  updateLogStatus.textContent = '✓ Log copied to clipboard!';
                  updateLogStatus.style.display = 'block';
                  setTimeout(() => { updateLogStatus.style.display = 'none'; }, 3000);
                }
              }).catch(() => {});
            }
          });
        }

        // Save Log Button
        const btnSaveUpdateLog = document.getElementById('btnSaveUpdateLog');
        if (btnSaveUpdateLog) {
          btnSaveUpdateLog.addEventListener('click', async () => {
            if (updateLogStatus) {
              updateLogStatus.style.display = 'none';
            }
            try {
              const result = await ipcRenderer.invoke('ui-save-client-log');
              if (updateLogStatus) {
                if (result.success) {
                  updateLogStatus.style.background = 'rgba(16,185,129,0.12)';
                  updateLogStatus.style.color = '#6ee7b7';
                  updateLogStatus.style.border = '1px solid rgba(16,185,129,0.2)';
                  updateLogStatus.textContent = '✓ Log saved to: ' + result.path;
                } else {
                  updateLogStatus.style.background = 'rgba(239,68,68,0.12)';
                  updateLogStatus.style.color = '#fca5a5';
                  updateLogStatus.style.border = '1px solid rgba(239,68,68,0.2)';
                  updateLogStatus.textContent = '✗ Failed: ' + result.error;
                }
                updateLogStatus.style.display = 'block';
                setTimeout(() => { updateLogStatus.style.display = 'none'; }, 5000);
              }
            } catch (err) {
              if (updateLogStatus) {
                updateLogStatus.style.background = 'rgba(239,68,68,0.12)';
                updateLogStatus.style.color = '#fca5a5';
                updateLogStatus.style.border = '1px solid rgba(239,68,68,0.2)';
                updateLogStatus.textContent = '✗ Error: ' + err.message;
                updateLogStatus.style.display = 'block';
                setTimeout(() => { updateLogStatus.style.display = 'none'; }, 5000);
              }
            }
          });
        }

        // Restart Now Button
        const btnRestartNow = document.getElementById('btnRestartNow');
        if (btnRestartNow) {
          btnRestartNow.addEventListener('click', () => {
            btnRestartNow.disabled = true;
            btnRestartNow.textContent = 'Restarting...';
            ipcRenderer.invoke('trigger-update-restart').catch(() => {});
          });
        }
      });

      ipcRenderer.on('show-unlock-loading', () => {
        const loadingEl = document.getElementById('unlockLoading');
        if (loadingEl) {
          loadingEl.style.display = 'flex';
        }
      });

      const modalSaveLogBtn = document.getElementById('modalSaveLogBtn');
      const modalSaveLogStatus = document.getElementById('modalSaveLogStatus');
      if (modalSaveLogBtn && modalSaveLogStatus) {
        modalSaveLogBtn.addEventListener('click', async () => {
          modalSaveLogBtn.disabled = true;
          modalSaveLogBtn.style.opacity = '0.5';
          modalSaveLogStatus.style.display = 'none';
          try {
            const result = await ipcRenderer.invoke('ui-save-client-log');
            if (result.success) {
              modalSaveLogStatus.style.background = 'rgba(16,185,129,0.12)';
              modalSaveLogStatus.style.color = '#6ee7b7';
              modalSaveLogStatus.style.border = '1px solid rgba(16,185,129,0.2)';
              modalSaveLogStatus.textContent = '✓ Log saved successfully!';
            } else {
              modalSaveLogStatus.style.background = 'rgba(239,68,68,0.12)';
              modalSaveLogStatus.style.color = '#fca5a5';
              modalSaveLogStatus.style.border = '1px solid rgba(239,68,68,0.2)';
              modalSaveLogStatus.textContent = '✗ Failed: ' + result.error;
            }
            modalSaveLogStatus.style.display = 'block';
            setTimeout(() => { modalSaveLogStatus.style.display = 'none'; }, 5000);
          } catch (e) {
            modalSaveLogStatus.style.background = 'rgba(239,68,68,0.12)';
            modalSaveLogStatus.style.color = '#fca5a5';
            modalSaveLogStatus.style.border = '1px solid rgba(239,68,68,0.2)';
            modalSaveLogStatus.textContent = '✗ Error: ' + e.message;
            modalSaveLogStatus.style.display = 'block';
          } finally {
            modalSaveLogBtn.disabled = false;
            modalSaveLogBtn.style.opacity = '1';
          }
        });
      }
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
  if (isTcpConnected && tcpSocket && !tcpSocket.destroyed && tcpSocket.writable) {
    try {
      tcpSocket.write(JSON.stringify(data) + '\n');
    } catch (e: any) {
      console.error('sendToServer write failed:', e.message);
    }
  }
}

function unlockAndCloseWindow() {
  if (lockWindow && !lockWindow.isDestroyed()) {
    logToUI('Transitioning lock screen to loading state...');
    try {
      lockWindow.webContents.send('show-unlock-loading');
    } catch (e: any) {
      logToUI(`Failed to send show-unlock-loading: ${e.message}`);
    }
    setTimeout(() => {
      if (lockWindow && !lockWindow.isDestroyed()) {
        logToUI('Destroying lock screen window after desktop load delay.');
        lockWindow.destroy();
        lockWindow = null;
      }
    }, 3000);
  }
}

// ─── Server message handler ────────────────────────────────────────────────────
async function handleServerMessage(msg: any) {
  try {
    if (msg.type === 'query-check-response') {
      const { requestId, allowed } = msg.payload || {};
      const pending = pendingQueryChecks.get(requestId);
      if (pending) {
        pending.resolve(allowed);
        pendingQueryChecks.delete(requestId);
      }
      return;
    }

    logToUI(`Received server command: ${msg.command || 'unknown'}`);
    if (msg.command === 'change-password-success') {
      if (pendingPasswordResolve) {
        pendingPasswordResolve({ success: true, message: msg.message || 'Password changed successfully.' });
        pendingPasswordResolve = null;
      }
    } else if (msg.command === 'change-password-fail') {
      if (pendingPasswordResolve) {
        pendingPasswordResolve({ success: false, message: msg.message || 'Failed to change password.' });
        pendingPasswordResolve = null;
      }
    } else if (msg.command === 'login-success') {
      logToUI(`Server approved member login. Unlocking terminal.`);
      if (pendingLoginResolve) {
        pendingLoginResolve({ success: true });
        pendingLoginResolve = null;
      }
      currentUser = msg.user;
      isLocked = false;
      stopLockEnforcement();
      if (lockWindow) {
        unlockAndCloseWindow();
      } else {
        logToUI(`Lock screen window not present or already destroyed.`);
      }

      // Unblock hardware input in case it was blocked from a previous session
      if (process.platform === 'win32') {
        safeSpawn('powershell.exe', [
          '-NoProfile',
          '-WindowStyle', 'Hidden',
          '-Command',
          'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class B{[DllImport("user32.dll")]public static extern bool BlockInput(bool f);}\';[B]::BlockInput($false)'
        ]);
        if (psProcess && psProcess.stdin && !psProcess.killed) {
          psProcess.stdin.write('Set-BlockInput $false\n');
        }
      }

      // Spawn explorer.exe so the desktop shell is available during the session
      if (process.platform === 'win32') {
        isDesktopShellRunning().then((running) => {
          if (!running) {
            logToUI('Spawning explorer.exe to load desktop shell (login-success)...');
            spawnExplorerShell();
          } else {
            logToUI('explorer.exe desktop shell already running — skipping spawn (login-success).');
          }
        });
      }

      // Create and show dynamic island
      createIslandWindow({
        startTime: new Date(Date.now() + 9000).toISOString(),
        mode: 'prepaid',
        durationMinutes: msg.duration || null,
        user: msg.user || 'Guest'
      });
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
        unlockAndCloseWindow();
      } else {
        logToUI(`Lock screen window not present or already destroyed.`);
      }

      // Unblock hardware input in case it was blocked from a previous session
      if (process.platform === 'win32') {
        safeSpawn('powershell.exe', [
          '-NoProfile',
          '-WindowStyle', 'Hidden',
          '-Command',
          'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class B{[DllImport("user32.dll")]public static extern bool BlockInput(bool f);}\';[B]::BlockInput($false)'
        ]);
        if (psProcess && psProcess.stdin && !psProcess.killed) {
          psProcess.stdin.write('Set-BlockInput $false\n');
        }
      }

      // Spawn explorer.exe so the desktop shell is available during the session.
      // The CafeKiosk shell (NTUSER.DAT) is the agent — explorer is only active during sessions.
      if (process.platform === 'win32') {
        isDesktopShellRunning().then((running) => {
          if (!running) {
            logToUI('Spawning explorer.exe to load desktop shell...');
            spawnExplorerShell();
          } else {
            logToUI('explorer.exe desktop shell already running — skipping spawn.');
          }
        });
      }

      // Destroy any existing island window first to prevent timer carry-over
      destroyIslandWindow();
      // Create and show dynamic island
      createIslandWindow({
        startTime: (msg.session && msg.session.startTime) || new Date(Date.now() + 9000).toISOString(),
        mode: (msg.session && msg.session.mode) || 'postpaid',
        durationMinutes: (msg.session && msg.session.durationMinutes) || null,
        planPrice: (msg.session && msg.session.planPrice) || null,
        customDuration: (msg.session && msg.session.customDuration) || null,
        user: msg.user || 'Guest'
      });
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
      destroyIslandWindow();

      // If this was triggered by a safety violation, open local blocked page and cache the query
      if (msg.payload?.isViolation) {
        if (msg.payload.query && mitmProxy) {
          mitmProxy.blockedQueries.add(msg.payload.query.toLowerCase());
        }
        if (process.platform === 'win32') {
          exec('start "" "C:\\NetCafe\\blocked.html"');
        }
      }

      // Always kill explorer.exe on Windows when locking
      if (process.platform === 'win32') {
        logToUI('Terminating explorer.exe to lock desktop shell...');
        safeSpawn('taskkill.exe', ['/F', '/IM', 'explorer.exe']);
      }
    } else if (msg.command === 'message') {
      if (!isLocked && islandWindow && !islandWindow.isDestroyed()) {
        islandWindow.webContents.send('show-message', msg.payload || '');
      } else {
        dialog.showMessageBox({
          type: 'info',
          title: 'Message from Operator',
          message: msg.payload || ''
        });
      }
    } else if (msg.command === 'sync-session') {
      if (islandWindow && !islandWindow.isDestroyed()) {
        islandWindow.webContents.send('sync-session-data', msg.session);
      }
    } else if (msg.command === 'poweroff') {
      if (process.platform === 'win32') {
        safeSpawn('shutdown.exe', ['/s', '/f', '/t', '0'], { detached: true, stdio: 'ignore' });
      } else {
        safeSpawn('shutdown', ['-h', 'now'], { detached: true, stdio: 'ignore' });
      }
    } else if (msg.command === 'restart') {
      if (process.platform === 'win32') {
        safeSpawn('shutdown.exe', ['/r', '/f', '/t', '0'], { detached: true, stdio: 'ignore' });
      } else {
        safeSpawn('reboot', [], { detached: true, stdio: 'ignore' });
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
      const ultraRes = !!msg.payload?.ultraRes;
      updateMirrorSettings(highRes, ultraRes);
    } else if (msg.command === 'block-inputs') {
      const block = !!msg.payload?.block;
      if (process.platform === 'win32') {
        // Primary: persistent PS process
        if (psProcess && psProcess.stdin && !psProcess.killed) {
          psProcess.stdin.write(`Set-BlockInput $${block ? 'true' : 'false'}\n`);
        }
        // Secondary: direct spawn to guarantee effect (BlockInput needs calling thread to have input)
        safeSpawn('powershell.exe', [
          '-NoProfile',
          '-WindowStyle', 'Hidden',
          '-Command',
          `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class B{[DllImport("user32.dll")]public static extern bool BlockInput(bool f);}\';[B]::BlockInput($${block ? 'true' : 'false'})`
        ]);
        logToUI(`Hardware inputs ${block ? 'BLOCKED' : 'UNBLOCKED'}`);
      }
    } else if (msg.command === 'update-operator-password') {
      // Server pushed a new operator password — persist it and update in-memory state
      const newPwd = msg.payload?.password;
      if (newPwd && typeof newPwd === 'string' && newPwd.trim().length >= 1) {
        operatorPassword = newPwd.trim();
        // Persist to config file so it survives restarts
        try {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          cfg.operatorPassword = operatorPassword;
          fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
          logToUI(`Operator password updated from server.`);
        } catch (e: any) {
          logToUI(`Failed to persist operator password: ${e.message}`);
        }
      }
    } else if (msg.command === 'trigger-update') {
      // Server requested a software update check — trigger auto-updater
      logToUI('Server triggered remote update check. Running autoUpdater...');
      try {
        autoUpdater.checkForUpdates().catch((err: any) => logToUI(`Remote update check failed: ${err.message}`));
      } catch (e: any) {
        logToUI(`autoUpdater.checkForUpdates error: ${e.message}`);
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

// ─── IPC: Member change password bridge ───────────────────────────────────────
ipcMain.handle('agent-change-password', (_event, username: string, oldPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  return new Promise((resolve) => {
    if (!tcpSocket || tcpSocket.destroyed) {
      resolve({ success: false, message: 'Not connected to server.' });
      return;
    }
    pendingPasswordResolve = resolve;
    const timeout = setTimeout(() => {
      if (pendingPasswordResolve === resolve) {
        pendingPasswordResolve = null;
        resolve({ success: false, message: 'Server did not respond. Please try again.' });
      }
    }, 8000);
    const origResolve = resolve;
    pendingPasswordResolve = (result) => {
      clearTimeout(timeout);
      pendingPasswordResolve = null;
      origResolve(result);
    };
    sendToServer({ type: 'change-member-password', payload: { username, oldPassword, newPassword } });
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
      isTcpConnected = false;
    }
    isConnecting = false;
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

ipcMain.handle('system-shutdown', () => {
  logToUI('System shutdown requested via lockscreen.');
  if (process.platform === 'win32') {
    safeSpawn('shutdown.exe', ['/s', '/f', '/t', '0'], { detached: true, stdio: 'ignore' });
  } else {
    safeSpawn('shutdown', ['-h', 'now'], { detached: true, stdio: 'ignore' });
  }
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
    // Also disable system proxy!
    execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f');
    execSync('rundll32.exe wininet.dll,InternetSetOption 39 0 0');
    console.log('Shell restored to explorer.exe and proxy disabled');

    // Spawn explorer immediately so the operator gets their desktop back without restarting!
    if (process.platform === 'win32') {
      safeSpawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
    }
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
      exec(psCmd, { timeout: 2500 }, (err, stdout) => {
        if (err) {
          resolve('System');
        } else {
          resolve(stdout.trim() || 'Desktop');
        }
      });
    } else {
      exec('xdotool getactivewindow getwindowname', { timeout: 2500 }, (err, stdout) => {
        if (err || !stdout) {
          resolve('Desktop / Shell');
        } else {
          resolve(stdout.trim());
        }
      });
    }
  });
}

let lastProcessSet: Set<string> = new Set();
let processListInitialized = false;

async function getProcessChanges(): Promise<{ started: string[]; closed: string[] }> {
  return new Promise((resolve) => {
    exec('tasklist /FO CSV /NH 2>nul', { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve({ started: [], closed: [] });
      const current = new Set<string>();
      for (const line of stdout.split('\n')) {
        const m = line.trim().match(/^"([^"]+)"/);
        if (m) current.add(m[1].toLowerCase());
      }
      if (!processListInitialized) {
        lastProcessSet = current;
        processListInitialized = true;
        return resolve({ started: [], closed: [] });
      }
      const started = [...current].filter(p => !lastProcessSet.has(p));
      const closed = [...lastProcessSet].filter(p => !current.has(p));
      lastProcessSet = current;
      resolve({ started, closed });
    });
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
      safeSpawn('taskkill.exe', ['/F', '/IM', exe]);
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
let mirrorWidth = 1280;
let mirrorHeight = 720;
let mirrorQuality = 75;
let mirrorIntervalMs = 800;

function startScreenMirroring() {
  if (mirrorInterval) return;
  mirrorInterval = setInterval(async () => {
    if (tcpSocket && !tcpSocket.destroyed) {
      try {
        // Use actual display size if mirrorWidth/Height exceed it
        let captureW = mirrorWidth;
        let captureH = mirrorHeight;
        try {
          const primary = screen.getPrimaryDisplay();
          const scale = primary.scaleFactor || 1;
          captureW = Math.min(mirrorWidth, Math.round(primary.size.width * scale));
          captureH = Math.min(mirrorHeight, Math.round(primary.size.height * scale));
        } catch {}
        
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: captureW, height: captureH }
        });
        if (sources.length > 0) {
          const jpegBase64 = sources[0].thumbnail.toJPEG(mirrorQuality).toString('base64');
          sendToServer({ type: 'screen-frame', payload: jpegBase64, width: captureW, height: captureH });
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

function updateMirrorSettings(highRes: boolean, ultraRes: boolean = false) {
  const newWidth = ultraRes ? 2560 : highRes ? 1920 : 400;
  const newHeight = ultraRes ? 1440 : highRes ? 1080 : 225;
  const newQuality = ultraRes ? 95 : highRes ? 88 : 40;
  const newInterval = ultraRes ? 300 : highRes ? 500 : 1500;

  if (newWidth !== mirrorWidth || newHeight !== mirrorHeight || newQuality !== mirrorQuality || newInterval !== mirrorIntervalMs) {
    mirrorWidth = newWidth;
    mirrorHeight = newHeight;
    mirrorQuality = newQuality;
    mirrorIntervalMs = newInterval;
    
    if (mirrorInterval) {
      stopScreenMirroring();
      startScreenMirroring();
    }
    logToUI(`Updated mirror settings: ultraRes=${ultraRes}, highRes=${highRes} (${mirrorWidth}x${mirrorHeight}, quality=${mirrorQuality}, interval=${mirrorIntervalMs}ms)`);
  }
}

// ─── TCP Connection ────────────────────────────────────────────────────────────
function connectToServer() {
  if (isConnecting) {
    logToUI('Connection attempt already in progress, skipping connectToServer.');
    return;
  }
  if (tcpSocket && !tcpSocket.destroyed) {
    logToUI('Already connected to server, skipping connectToServer.');
    return;
  }

  isConnecting = true;
  const socket = new net.Socket();
  tcpSocket = socket;
  let buffer = '';

  logToUI(`Attempting to connect to server at tcp://${serverHost}:${serverPort}...`);
  socket.connect(serverPort, serverHost, () => {
    isConnecting = false;
    isTcpConnected = true;
    logToUI(`Connected to server successfully!`);
    const mac = getMACAddress() || machineId;
    sendToServer({ 
      type: 'register', 
      payload: { 
        mac_address: mac, 
        name: machineId, 
        ip_address: getIPAddress(),
        uuid: clientUuid,
        version: app.getVersion()
      } 
    });
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
    isTcpConnected = false;
    isConnecting = false;
    tcpSocket = null;
    logToUI('Disconnected from server. Retrying in 5 seconds...');
    stopScreenMirroring();
    
    // Resolve all pending query checks to true
    for (const pending of pendingQueryChecks.values()) {
      pending.resolve(true);
    }
    pendingQueryChecks.clear();
    
    // Safety unblock of hardware inputs on connection loss
    if (process.platform === 'win32' && psProcess && psProcess.stdin && !psProcess.killed) {
      psProcess.stdin.write("Set-BlockInput $false\n");
    }
    // Extra safety unblock via direct spawn
    if (process.platform === 'win32') {
      safeSpawn('powershell.exe', [
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-Command',
        'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class B{[DllImport("user32.dll")]public static extern bool BlockInput(bool f);}\';[B]::BlockInput($false)'
      ]);
    }
    
    // Enforce lock immediately upon server disconnection
    isLocked = true;
    currentUser = null;
    destroyIslandWindow();
    if (!lockWindow || lockWindow.isDestroyed()) {
      lockWindow = null;
      createLockWindow();
    } else {
      startLockEnforcement();
    }

    // Always kill explorer.exe on Windows when locking on server disconnect
    if (process.platform === 'win32') {
      logToUI('Terminating explorer.exe on server disconnect lock...');
      safeSpawn('taskkill.exe', ['/F', '/IM', 'explorer.exe']);
    }
    
    setTimeout(connectToServer, 5000);
  });

  socket.on('error', (err: any) => {
    isConnecting = false;
    isTcpConnected = false;
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
              isTcpConnected = false;
            } catch {}
          }
          isConnecting = false;
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

let lastReportedWindow = '';
let lastReportedTime = 0;

async function handleActiveWindowChanged(newTitle: string) {
  if (isLocked) return; // Ignore window changes when client PC is locked
  if (newTitle === lastReportedWindow) return; // Deduplicate window change notifications
  
  // Rate-limit immediate reporting to avoid spamming the server
  const now = Date.now();
  if (now - lastReportedTime < 1000) return;
  lastReportedTime = now;
  lastReportedWindow = newTitle;

  if (tcpSocket && !tcpSocket.destroyed) {
    logToUI(`[Metrics] User activity detected active window changed to: "${newTitle}". Sending real-time update.`);
    const cpu = await getCPUUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const ram = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);

    let resolution = { width: 1920, height: 1080 };
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      resolution = primaryDisplay.size;
    } catch (err) {}

    const processChanges = await getProcessChanges();
    sendToServer({
      type: 'metrics',
      payload: {
        cpu,
        ram,
        activeWindow: newTitle,
        os: `${os.type()} ${os.release()}`,
        uptime: os.uptime(),
        ip: getIPAddress(),
        resolution,
        timestamp: new Date().toISOString(),
        processesStarted: processChanges.started,
        processesClosed: processChanges.closed,
        version: app.getVersion()
      }
    });
  }
}

let psProcess: any = null;

function initPowerShell() {
  if (process.platform !== 'win32') return;
  try {
    psProcess = safeSpawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    psProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString('utf8');
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('ACTIVE_WINDOW_CHANGED:')) {
          const newTitle = trimmed.substring('ACTIVE_WINDOW_CHANGED:'.length);
          handleActiveWindowChanged(newTitle);
        }
      }
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

$csharpSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class Win32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public static string GetActiveWindowTitle() {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return "Desktop";
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(hwnd, sb, 256);
        return sb.ToString().Trim();
    }

    public static uint GetLastInputTime() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(lii);
        if (GetLastInputInfo(ref lii)) {
            return lii.dwTime;
        }
        return 0;
    }

    public static void StartMonitoring() {
        Thread t = new Thread(() => {
            string lastTitle = "";
            uint lastInput = 0;
            while (true) {
                Thread.Sleep(500);
                try {
                    uint currentInput = GetLastInputTime();
                    if (currentInput != lastInput) {
                        lastInput = currentInput;
                        string title = GetActiveWindowTitle();
                        if (title != lastTitle && !string.IsNullOrEmpty(title)) {
                            lastTitle = title;
                            Console.WriteLine("ACTIVE_WINDOW_CHANGED:" + title);
                        }
                    }
                } catch {}
            }
        });
        t.IsBackground = true;
        t.Start();
    }
}
'@
Add-Type -TypeDefinition $csharpSource
[Win32]::StartMonitoring()
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

function checkQuerySafety(query: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const startTime = Date.now();

    // Check local blocked list first to instantly block recurring attempts
    if (mitmProxy && mitmProxy.blockedQueries.has(query.toLowerCase())) {
      logToUI(`[MITM] Query "${query}" matches local blocked list. Instantly blocking.`);
      resolve(false);
      return;
    }

    if (!tcpSocket || tcpSocket.destroyed) {
      logToUI(`[MITM] Server not connected, allowing query "${query}"`);
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(0, 2500 - elapsed);
      if (remainingDelay > 0) {
        setTimeout(() => resolve(true), remainingDelay);
      } else {
        resolve(true);
      }
      return;
    }

    const requestId = `${Date.now()}-${nextRequestId++}`;
    
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('set-evaluating-state', true);
    }

    // Increased proxy safety check timeout from 5 seconds to 15 seconds
    const timeout = setTimeout(() => {
      if (pendingQueryChecks.has(requestId)) {
        logToUI(`[MITM] Timeout waiting for query check: "${query}"`);
        pendingQueryChecks.delete(requestId);
        
        if (pendingQueryChecks.size === 0 && islandWindow && !islandWindow.isDestroyed()) {
          islandWindow.webContents.send('set-evaluating-state', false);
        }
        
        const elapsed = Date.now() - startTime;
        const remainingDelay = Math.max(0, 2500 - elapsed);
        if (remainingDelay > 0) {
          setTimeout(() => resolve(true), remainingDelay);
        } else {
          resolve(true);
        }
      }
    }, 15000);

    pendingQueryChecks.set(requestId, {
      resolve: (allowed: boolean) => {
        clearTimeout(timeout);
        if (pendingQueryChecks.size === 0 && islandWindow && !islandWindow.isDestroyed()) {
          islandWindow.webContents.send('set-evaluating-state', false);
        }
        if (allowed) {
          // Enforce minimum delay of 2.5 seconds when resolving allowed = true
          const elapsed = Date.now() - startTime;
          const remainingDelay = Math.max(0, 2500 - elapsed);
          if (remainingDelay > 0) {
            setTimeout(() => resolve(true), remainingDelay);
          } else {
            resolve(true);
          }
        } else {
          resolve(false);
        }
      },
      reject: (err: any) => {
        clearTimeout(timeout);
        if (pendingQueryChecks.size === 0 && islandWindow && !islandWindow.isDestroyed()) {
          islandWindow.webContents.send('set-evaluating-state', false);
        }
        const elapsed = Date.now() - startTime;
        const remainingDelay = Math.max(0, 2500 - elapsed);
        if (remainingDelay > 0) {
          setTimeout(() => resolve(true), remainingDelay);
        } else {
          resolve(true);
        }
      },
      timeout
    });

    logToUI(`[MITM] Sending query check request to server: "${query}" (ID: ${requestId})`);
    sendToServer({
      type: 'query-check-request',
      payload: { query, requestId }
    });
  });
}

app.whenReady().then(async () => {
  // Remove watchdog disable flag on startup to re-enable watchdog checks
  try {
    if (fs.existsSync("C:\\NetCafe\\stop-watchdog.flag")) {
      fs.unlinkSync("C:\\NetCafe\\stop-watchdog.flag");
    }
  } catch {}

  // Create beautiful local blocked.html page
  const blockedHtmlPath = "C:\\NetCafe\\blocked.html";
  try {
    const blockedHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Blocked by NetCafe Safety Guard</title>
  <style>
    body {
      background-color: #0f172a;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background-color: #1e293b;
      border: 1px solid #ef4444;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .icon {
      color: #ef4444;
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 12px 0;
      color: #f87171;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin: 0 0 20px 0;
    }
    .footer {
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Search Query Blocked</h1>
    <p>The search query you entered has been flagged by the NetCafe Safety Guard for violating the house safety rules.</p>
    <div class="footer">NetCafe Manager &bull; Real-time AI Safety Guard</div>
  </div>
</body>
</html>`;
    const dir = path.dirname(blockedHtmlPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(blockedHtmlPath, blockedHtmlContent, 'utf8');
  } catch {}

  if (process.argv.includes('--install-kiosk')) {
    try {
      await runKioskSetup();
    } catch (e) {
      console.error(e);
    }
    app.quit();
    return;
  }
  if (process.argv.includes('--uninstall-kiosk')) {
    try {
      await runKioskUninstall();
    } catch (e) {
      console.error(e);
    }
    app.quit();
    return;
  }

  if (process.platform === 'win32') {
    initPowerShell();

    // Start MITM proxy for real-time browser query interception
    try {
      mitmProxy = new MitmProxy(
        app.getPath('userData'),
        async (query: string) => {
          logToUI(`[MITM] Browser query intercepted: "${query}"`);
          const allowed = await checkQuerySafety(query);
          logToUI(`[MITM] Safety check result for "${query}": ${allowed ? 'ALLOWED' : 'BLOCKED'}`);
          return allowed;
        },
        logToUI
      );
      mitmProxy.start().catch((err: Error) => {
        logToUI(`[MITM] Proxy start warning: ${err.message}`);
      });
    } catch (err: any) {
      logToUI(`[MITM] Init error: ${err.message}`);
    }
  }
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    const args = [process.execPath, ...process.argv.slice(1)];
    const child = safeSpawn('pkexec', args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    app.quit();
    return;
  }

  loadConfig();

  if (process.platform === 'win32' && app.isPackaged) {
    // Disable standard login item to avoid double-launch
    app.setLoginItemSettings({
      openAtLogin: false,
      name: 'NetCafe Agent',
      path: process.execPath,
    });
    logToUI('Auto-start standard login item disabled (switching to Task Scheduler).');

    // Register Scheduled Task to run instantly on logon with Highest Privileges
    const taskName = "NetCafeAgent";
    const exePath = process.execPath;
    const cmd = `schtasks /create /tn "${taskName}" /tr "\\"${exePath}\\"" /sc onlogon /rl highest /f`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        logToUI(`Task Scheduler registration failed: ${err.message}`);
        // Fallback to standard login item settings
        app.setLoginItemSettings({
          openAtLogin: true,
          name: 'NetCafe Agent',
          path: process.execPath,
        });
        logToUI('Fallback: Registered standard login item (openAtLogin: true).');
      } else {
        logToUI('Task Scheduler auto-start (instant launch) registered successfully.');
      }
    });

    // Also disable Windows Startup Delay for Explorer to ensure instant boot launch
    const serializeCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "New-Item -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize\' -Force | Out-Null; Set-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize\' -Name \'StartupDelayInMSec\' -Value 0 -Type DWord -Force"';
    exec(serializeCmd, (err) => {
      if (err) {
        logToUI(`Failed to disable Explorer startup delay: ${err.message}`);
      } else {
        logToUI('Disabled Windows Explorer startup delay successfully.');
      }
    });
  }

  setupWindowsFirewall();
  startUdpDiscovery();

  // Safety: always unblock hardware input on startup in case a previous session/crash
  // left BlockInput(true) active — this is the #1 cause of "keyboard not responding".
  







  if (process.platform === 'win32') {
    logToUI('Startup safety: unblocking hardware input (BlockInput false)...');
    safeSpawn('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command',
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class B{[DllImport("user32.dll")]public static extern bool BlockInput(bool f);}\';[B]::BlockInput($false)'
    ]);
    if (psProcess && psProcess.stdin && !psProcess.killed) {
      psProcess.stdin.write('Set-BlockInput $false\n');
    }
  }

  let updateInstallTimeout: NodeJS.Timeout | null = null;
  const triggerInstallUpdate = () => {
    if (updateInstallTimeout) {
      clearTimeout(updateInstallTimeout);
      updateInstallTimeout = null;
    }
    try {
      fs.writeFileSync("C:\\NetCafe\\stop-watchdog.flag", "stop", "utf8");
    } catch {}

    if (process.platform === 'win32') {
      const scProc = safeSpawn('sc.exe', ['stop', 'NetCafeAgentWatchdog']);
      scProc.on('close', () => {
        setTimeout(() => autoUpdater.quitAndInstall(), 2000);
      });
    } else {
      autoUpdater.quitAndInstall();
    }
  };

  ipcMain.handle('trigger-update-restart', () => {
    logToUI('Operator/System requested immediate update restart.');
    triggerInstallUpdate();
    return { success: true };
  });

  // Always terminate explorer.exe on Windows startup when locked
  if (isLocked && process.platform === 'win32') {
    logToUI('Terminating explorer.exe on startup (locked)...');
    safeSpawn('taskkill.exe', ['/F', '/IM', 'explorer.exe']);
  }

  createLockWindow();
  connectToServer();

  // Auto Updater logic for Agent
  autoUpdater.channel = 'latest-agent';  // ← must NOT pick up latest-server.yml
  autoUpdater.autoDownload = true;        // automatically download and install updates
  // autoUpdater.checkForUpdates().catch((err: unknown) => console.error("Agent update check failed:", err)); // Disabled client auto-updating on startup

  // Also check for updates every hour
  // setInterval(() => {
    //   autoUpdater.checkForUpdates().catch(() => {});
  // }, 60 * 60 * 1000);

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
  autoUpdater.on('update-downloaded', (info: any) => {
    updateReady = true;
    sendUpdateStatus({ status: 'downloaded', info });
    
    // Log the download event in the setup/install log
    const logPath = "C:\\NetCafeKiosk_Setup.log";
    try {
      fs.appendFileSync(logPath, `\r\n[${new Date().toISOString()}] UPDATE DOWNLOADED: NetCafe Agent version ${info?.version || 'unknown'} downloaded successfully. Restarting to install update...\r\n`, 'utf8');
    } catch {}

    // Rebuild lock window to show the downloaded banner
    if (isLocked) {
      createLockWindow();
    }
    // Stop the watchdog service before installing so it can't restart the old
    // agent binary while the new installer is writing files (prevents file-lock conflicts).
    // Read setup log contents to display in the UI
    let setupLogContent = '';
    try {
      if (fs.existsSync(logPath)) {
        setupLogContent = fs.readFileSync(logPath, 'utf8');
      }
    } catch {}

    let agentLogContent = '';
    try {
      if (fs.existsSync(runtimeLogFilePath)) {
        agentLogContent = fs.readFileSync(runtimeLogFilePath, 'utf8');
      } else {
        agentLogContent = agentLogsCache.map(e => `[${e.timestamp}] ${e.message}`).join('\r\n');
      }
    } catch {}

    const combinedLogs = `=== NETCAFE KIOSK SETUP LOG ===\r\n${setupLogContent}\r\n\r\n=== NETCAFE AGENT RUNTIME LOG ===\r\n${agentLogContent}`;

    // Send IPC to show the Auto Updating screen
    if (lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.webContents.send('show-auto-updating', {
        version: info?.version,
        logs: combinedLogs
      });
    }

    // Stop watchdog and install update after 15 seconds automatically
    updateInstallTimeout = setTimeout(() => {
      triggerInstallUpdate();
    }, 15000);

    /* setTimeout(() => {
      if (process.platform === 'win32') {
        const scProc = spawn('sc.exe', ['stop', 'NetCafeAgentWatchdog']);
        scProc.on('close', () => {
          setTimeout(() => autoUpdater.quitAndInstall(), 2000);
        });
      } else {
        autoUpdater.quitAndInstall();
      }
    }, 3000); */
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
  ipcMain.handle('ui-save-client-log', () => {
    return performSaveClientLog();
  });

  // Ctrl+Alt+Shift+L: Diagnostics Log Saving
  globalShortcut.register('Control+Alt+Shift+L', () => {
    saveClientLog();
  });

  // ─── Block common keyboard bypass shortcuts ────────────────────────────────
  // F11: Toggle fullscreen — MUST be blocked to prevent lock screen from exiting kiosk mode
  globalShortcut.register('F11', () => {
    // Always suppress F11 — re-enforce fullscreen on the lock window if locked
    if (isLocked && lockWindow && !lockWindow.isDestroyed()) {
      lockWindow.setFullScreen(true);
      lockWindow.setKiosk(true);
    }
    return false;
  });
  // F12: Developer tools
  globalShortcut.register('F12', () => {
    if (isLocked) return false;
  });
  // Ctrl+Shift+I: Developer tools
  globalShortcut.register('Control+Shift+I', () => {
    if (isLocked) return false;
  });
  // Ctrl+Shift+J: Developer tools console
  globalShortcut.register('Control+Shift+J', () => {
    if (isLocked) return false;
  });
  // Ctrl+Shift+C: Developer tools inspector
  globalShortcut.register('Control+Shift+C', () => {
    if (isLocked) return false;
  });
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
      lastReportedWindow = activeWindow;

      let resolution = { width: 1920, height: 1080 };
      try {
        const primaryDisplay = screen.getPrimaryDisplay();
        resolution = primaryDisplay.size;
      } catch (err) {}

      const processChanges = await getProcessChanges();
      sendToServer({
        type: 'metrics',
        payload: {
          cpu,
          ram,
          activeWindow,
          os: `${os.type()} ${os.release()}`,
          uptime: os.uptime(),
          ip: getIPAddress(),
          resolution,
          timestamp: new Date().toISOString(),
          processesStarted: processChanges.started,
          processesClosed: processChanges.closed,
          version: app.getVersion()
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

function cleanupProxySync() {
  try {
    // Direct registry edit synchronously to make sure it gets written
    const { execSync } = require('child_process');
    execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f');
    execSync('rundll32.exe wininet.dll,InternetSetOption 39 0 0');
    console.log('Synchronously disabled system proxy on exit');
  } catch (e) {
    console.error('Failed to disable proxy synchronously:', e);
  }
}

app.on('before-quit', () => {
  isAppQuitting = true;
  // Restore system proxy settings before exit
  if (mitmProxy) {
    try { mitmProxy.stop(); } catch {}
    mitmProxy = null;
  }
});

process.on('exit', () => {
  cleanupProxySync();
});

process.on('SIGINT', () => {
  cleanupProxySync();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupProxySync();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  cleanupProxySync();
  process.exit(1);
});

function checkFullscreen(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(false);
    }
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      $definition = @'
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
            [StructLayout(LayoutKind.Sequential)]
            public struct RECT {
                public int Left;
                public int Top;
                public int Right;
                public int Bottom;
            }
        }
'@;
      Add-Type -TypeDefinition $definition;
      $fg = [Win32]::GetForegroundWindow();
      if ($fg -ne 0) {
          $rect = New-Object Win32+RECT;
          if ([Win32]::GetWindowRect($fg, [ref]$rect)) {
              $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
              if ($rect.Left -le 2 -and $rect.Top -le 2 -and ($rect.Right - $rect.Left) -ge ($screen.Width - 10) -and ($rect.Bottom - $rect.Top) -ge ($screen.Height - 10)) {
                  Write-Output "true"
              } else {
                  Write-Output "false"
              }
          } else { Write-Output "false" }
      } else { Write-Output "false" }
    `;
    const child = safeSpawn('powershell.exe', ['-NoProfile', '-Command', psScript]);
    let output = '';
    child.stdout.on('data', (data: any) => {
      output += data.toString();
    });
    child.on('close', () => {
      resolve(output.trim() === 'true');
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

function startFullscreenCheck() {
  if (fullscreenCheckInterval) return;
  fullscreenCheckInterval = setInterval(async () => {
    if (!isLocked && islandWindow && !islandWindow.isDestroyed()) {
      const isFS = await checkFullscreen();
      if (isFS !== isFullscreenApp) {
        isFullscreenApp = isFS;
        islandWindow.webContents.send('set-fullscreen-state', isFullscreenApp);
      }
    }
  }, 3000);
}

function stopFullscreenCheck() {
  if (fullscreenCheckInterval) {
    clearInterval(fullscreenCheckInterval);
    fullscreenCheckInterval = null;
  }
}

const islandModule = require('../client/island-window.js');

function createIslandWindow(sessionData?: any) {
  if (islandWindow && !islandWindow.isDestroyed()) return;
  currentSessionData = sessionData;
  try {
    islandWindow = islandModule.createIslandWindow(sessionData);
    if (!islandWindow) return;
    
    islandWindow.on('close', (e) => {
      if (!isLocked) {
        e.preventDefault();
      }
    });

    islandWindow.on('closed', () => {
      islandWindow = null;
      if (!isLocked) {
        logToUI('Island window closed unexpectedly. Re-creating dynamic island to keep it permanent.');
        setTimeout(() => {
          if (!isLocked) {
            createIslandWindow(currentSessionData);
          }
        }, 1000);
      }
    });

    startFullscreenCheck();
  } catch (err: any) {
    logToUI(`[createIslandWindow] Error: ${err?.message ?? err}`);
    if (islandWindow && !islandWindow.isDestroyed()) {
      try { islandWindow.destroy(); } catch {}
    }
    islandWindow = null;
  }
}

function destroyIslandWindow() {
  stopFullscreenCheck();
  islandModule.destroyIslandWindow();
  islandWindow = null;
}

ipcMain.on('exit-session-request', () => {
  sendToServer({ type: 'client-request-close' });
});

ipcMain.on('save-client-log', () => {
  saveClientLog();
});

function getIslandHtml(sessionData?: any): string {
  const sessionJson = JSON.stringify(sessionData || null);
  const isDevMode = IS_DEVELOPER_MODE;
  const initialLogsJson = JSON.stringify(agentLogsCache);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      margin: 0; padding: 8px 12px;
      overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: transparent;
      display: flex; justify-content: center; align-items: flex-start;
      user-select: none; width: 100vw; height: 100vh;
    }
    .island-row { display: flex; align-items: flex-start; justify-content: center; gap: 10px; }

    #island {
      background: #000; color: #fff;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 999px; /* Pill by default to prevent rectangular flash */
      box-shadow: 0 12px 30px rgba(0,0,0,0.65), 0 2px 10px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);
      transition:
        width  480ms cubic-bezier(0.32,0.72,0,1),
        height 480ms cubic-bezier(0.32,0.72,0,1),
        border-radius 480ms cubic-bezier(0.32,0.72,0,1),
        border 250ms ease, box-shadow 300ms ease;
      will-change: width, height, border-radius;
      position: relative;
    }
    #dot {
      background: #000; border: 1px solid rgba(255,255,255,0.09); border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      transition: width 480ms cubic-bezier(0.32,0.72,0,1), height 480ms cubic-bezier(0.32,0.72,0,1),
        opacity 300ms ease, transform 480ms cubic-bezier(0.32,0.72,0,1);
      overflow: hidden; flex-shrink: 0;
    }
    #dot.hidden  { width:0; height:0; opacity:0; transform:scale(0.3); border:none; box-shadow:none; }
    #dot.visible { width:37px; height:37px; opacity:1; transform:scale(1); }

    /* State dimensions */
    #island.s-compact { width:186px; height:36px;  border-radius:999px; }
    #island.s-split   { width:122px; height:36px;  border-radius:999px; }
    #island.s-check   { width:232px; height:36px;  border-radius:999px;
      border:1.5px solid rgba(56,189,248,0.35);
      box-shadow:0 0 22px rgba(56,189,248,0.2), 0 12px 30px rgba(0,0,0,0.65); }
    #island.s-card    { width:342px; height:185px; border-radius:28px; padding:14px 16px; align-items:stretch; justify-content:flex-start; flex-direction:column; gap:8px; }
    #island.s-profile { width:342px; height:320px; border-radius:28px; padding:14px 16px; align-items:stretch; justify-content:flex-start; flex-direction:column; gap:0; }
    #island.s-banner  { width:372px; height:78px;  border-radius:22px; padding:0 16px;
      border:1.5px solid rgba(239,68,68,0.3);
      box-shadow:0 0 24px rgba(239,68,68,0.15), 0 12px 30px rgba(0,0,0,0.65); }

    .panel {
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      opacity:0; pointer-events:none;
      transition:opacity 140ms ease-out;
      width:100%; height:100%;
    }
    .panel.show { opacity:1; pointer-events:auto; transition:opacity 240ms ease-in 100ms; }
    #panel-card   { align-items:stretch; flex-direction:column; gap:8px; padding:14px 16px; justify-content:flex-start; }
    #panel-profile { align-items:stretch; flex-direction:column; gap:0; padding:12px 14px; justify-content:flex-start; }
    #panel-banner { flex-direction:row; gap:12px; padding:0 16px; }

    /* Compact */
    .pill-row { display:flex; align-items:center; justify-content:center; gap:7px;
      font-size:13px; font-weight:600; letter-spacing:-0.15px; color:rgba(255,255,255,0.93); width:100%; padding:0 12px; }
    .live-dot { width:7px; height:7px; border-radius:50%; background:#10b981;
      box-shadow:0 0 8px rgba(16,185,129,0.8); flex-shrink:0;
      animation:blink 2.2s ease-in-out infinite; }
    @keyframes blink { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(0.82);} }
    .time-txt { font-variant-numeric:tabular-nums; font-weight:700; font-size:13px; letter-spacing:0.3px; color:#fff; }

    /* Checking */
    .check-row { display:flex; align-items:center; justify-content:center; gap:8px;
      color:#38bdf8; font-size:12px; font-weight:600; width:100%; padding:0 14px; }
    .spinner { width:13px; height:13px; border:2px solid rgba(56,189,248,0.25); border-top-color:#38bdf8;
      border-radius:50%; animation:spin 0.75s linear infinite; flex-shrink:0; }
    @keyframes spin { to { transform:rotate(360deg); } }

    /* Split dot */
    .warn-pulse { width:10px; height:10px; border-radius:50%; background:#f59e0b;
      box-shadow:0 0 8px rgba(245,158,11,0.9); animation:wp 0.9s ease-in-out infinite; }
    @keyframes wp { 0%,100%{transform:scale(1);opacity:1;} 50%{transform:scale(1.3);opacity:0.6;} }

    /* Card */
    .card-header { display:flex; justify-content:space-between; align-items:center; }
    .card-name   { font-size:14px; font-weight:700; letter-spacing:-0.3px; color:#fff; }
    .card-badge  { font-size:9.5px; font-weight:700; padding:2.5px 9px; border-radius:999px;
      text-transform:uppercase; letter-spacing:0.5px; background:rgba(255,255,255,0.1); color:rgba(255,255,255,0.8); }
    .card-body   { display:flex; justify-content:space-between; align-items:flex-end; flex:1; }
    .card-info   { display:flex; flex-direction:column; gap:2px; }
    .card-label  { font-size:10.5px; color:rgba(255,255,255,0.42); font-weight:500; }
    .card-val    { font-size:13px; font-weight:700; color:#fff; font-variant-numeric:tabular-nums; }
    .cost-col    { text-align:right; }
    .cost-label  { font-size:9.5px; color:rgba(255,255,255,0.38); font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
    .cost-val    { font-size:18px; font-weight:800; color:#34d399; text-shadow:0 0 14px rgba(52,211,153,0.35); }
    
    .card-actions { display:flex; gap:8px; width:100%; margin-top:4px; }
    .exit-btn {
      flex:1; background:linear-gradient(135deg,#ef4444,#dc2626);
      color:#ffffff; border:none; border-radius:999px; padding:9px 0;
      font-size:12px; font-weight:700; cursor:pointer; letter-spacing:0.1px;
      box-shadow:0 4px 12px rgba(239,68,68,0.3); font-family:inherit;
      transition:all 0.18s ease; flex-shrink:0; text-align:center; line-height:1; }
    .exit-btn:hover { background:linear-gradient(135deg,#dc2626,#b91c1c); transform:translateY(-1px); box-shadow:0 6px 18px rgba(239,68,68,0.45); }
    .exit-btn:active { transform:translateY(0); }
    
    .profile-btn {
      flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.07);
      color:#ffffff; border-radius:999px; padding:9px 0;
      font-size:12px; font-weight:700; cursor:pointer; letter-spacing:0.1px;
      font-family:inherit; transition:all 0.18s ease; text-align:center; line-height:1; }
    .profile-btn:hover { background:rgba(255,255,255,0.15); transform:translateY(-1px); }
    .profile-btn:active { transform:translateY(0); }

    /* Profile Panel */
    .prof-header { display:flex; align-items:center; justify-content:space-between; width:100%; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:8px; }
    .prof-title { font-size:13px; font-weight:700; color:#fff; }
    .prof-back-btn { background:transparent; border:none; color:rgba(255,255,255,0.5); font-size:11px; font-weight:600; cursor:pointer; padding:2px 6px; border-radius:4px; font-family:inherit; }
    .prof-back-btn:hover { color:#fff; background:rgba(255,255,255,0.08); }
    
    .prof-tabs { display:flex; gap:4px; width:100%; margin-bottom:10px; background:rgba(255,255,255,0.04); padding:3px; border-radius:8px; }
    .prof-tab { flex:1; background:transparent; border:none; color:rgba(255,255,255,0.5); font-size:10px; font-weight:700; cursor:pointer; padding:6px 0; border-radius:6px; font-family:inherit; transition:all 0.15s ease; text-align:center; }
    .prof-tab.active { background:rgba(255,255,255,0.12); color:#fff; }
    .prof-tab:hover:not(.active) { color:rgba(255,255,255,0.85); background:rgba(255,255,255,0.02); }
    
    .tab-content { flex:1; display:flex; flex-direction:column; overflow-y:auto; width:100%; gap:8px; min-height:0; }
    
    /* Change Password form */
    .form-group { display:flex; flex-direction:column; gap:4px; text-align:left; }
    .form-group label { font-size:9.5px; color:rgba(255,255,255,0.45); font-weight:700; text-transform:uppercase; letter-spacing:0.3px; }
    .form-group input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:#fff; padding:6.5px 10px; font-size:12px; font-family:inherit; outline:none; transition:border 0.15s ease; }
    .form-group input:focus { border-color:rgba(56,189,248,0.5); }
    .submit-btn { background:linear-gradient(135deg,#38bdf8,#0284c7); color:#fff; border:none; border-radius:6px; padding:8px 0; font-size:11.5px; font-weight:700; cursor:pointer; font-family:inherit; transition:all 0.18s ease; margin-top:2px; }
    .submit-btn:hover { background:linear-gradient(135deg,#56c8fc,#0391da); transform:translateY(-1.5px); }
    .submit-btn:active { transform:translateY(0); }
    .pw-status { font-size:10px; text-align:center; font-weight:600; padding:4px; border-radius:4px; display:none; }
    .pw-status.ok { background:rgba(16,185,129,0.12); color:#34d399; }
    .pw-status.err { background:rgba(239,68,68,0.12); color:#f87171; }

    /* Lists and logs */
    .list-row { display:flex; justify-content:space-between; align-items:center; padding:7px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.04); border-radius:6px; font-size:11px; }
    .list-label { color:rgba(255,255,255,0.45); font-weight:500; }
    .list-val { color:#fff; font-weight:700; }
    .empty-msg { font-size:11px; color:rgba(255,255,255,0.35); text-align:center; margin:auto 0; }
    
    /* Progress bar */
    .usage-bar-wrap { width:100%; height:8px; background:rgba(255,255,255,0.08); border-radius:999px; overflow:hidden; margin-top:4px; }
    .usage-bar-fill { height:100%; background:linear-gradient(90deg, #38bdf8, #10b981); border-radius:999px; transition:width 0.5s ease-out; }

    .dev-log { background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.07); border-radius:9px; padding:5px 8px;
      font-family:monospace; font-size:9.5px; max-height:64px; overflow-y:auto; color:#38bdf8; flex-shrink:0; }
    .log-line { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:1.5px; opacity:0.85; }

    /* Banner */
    .banner-icon { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:17px; background:rgba(239,68,68,0.15); }
    .banner-tcol { flex:1; overflow:hidden; }
    .banner-ttl  { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:#f87171; }
    .banner-msg  { font-size:12.5px; font-weight:600; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; margin-top:1px; }
    .dismiss-btn { background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.1);
      border-radius:999px; padding:6px 14px; font-size:11px; font-weight:700; cursor:pointer;
      font-family:inherit; flex-shrink:0; transition:background 0.15s ease; }
    .dismiss-btn:hover { background:rgba(255,255,255,0.22); }
  </style>
</head>
<body>
  <div class="island-row" id="row">
    <div id="island" class="s-compact">
      <div class="panel show" id="panel-compact">
        <div class="pill-row">
          <div class="live-dot"></div>
          <span class="time-txt" id="compact-time">00:00:00</span>
        </div>
      </div>
      <div class="panel" id="panel-check">
        <div class="check-row">
          <div class="spinner"></div>
          <span>Checking safety...</span>
        </div>
      </div>
      <div class="panel" id="panel-split">
        <div class="pill-row" style="color:#f59e0b;justify-content:center;">
          <span class="time-txt" id="split-time">00:00:00</span>
        </div>
      </div>
      <div class="panel" id="panel-card">
        <div class="card-header">
          <span class="card-name" id="card-name">Walk-in</span>
          <span class="card-badge" id="card-badge">Prepaid</span>
        </div>
        <div class="card-body">
          <div class="card-info">
            <span class="card-label" id="card-tlabel">Remaining</span>
            <span class="card-val"   id="card-time">00:00:00</span>
            <span class="card-label" style="margin-top:4px;">Started</span>
            <span class="card-val"   id="card-start">--:--</span>
          </div>
          <div class="cost-col">
            <div class="cost-label">Accrued</div>
            <div class="cost-val" id="card-cost">$0.00</div>
          </div>
        </div>
        <div id="dev-log-wrap" style="display:none;">
          <div class="dev-log" id="dev-log"></div>
        </div>
        <div class="card-actions">
          <button class="profile-btn" onclick="openProfile()">Your Profile</button>
          <button class="exit-btn" onclick="onExit()">Exit Session</button>
        </div>
      </div>
      <div class="panel" id="panel-profile">
        <div class="prof-header">
          <span class="prof-title" id="prof-user-title">Profile</span>
          <button class="prof-back-btn" onclick="closeProfile()">← Back</button>
        </div>
        <div class="prof-tabs">
          <button class="prof-tab active" onclick="showTab('password')">Password</button>
          <button class="prof-tab" onclick="showTab('activity')">Activity</button>
          <button class="prof-tab" onclick="showTab('sessions')">Sessions</button>
          <button class="prof-tab" onclick="showTab('usage')">Usage</button>
        </div>
        <div class="tab-content" id="tab-password">
          <div class="form-group">
            <label>Current Password</label>
            <input type="password" id="pw-old" placeholder="••••">
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input type="password" id="pw-new" placeholder="••••">
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" id="pw-confirm" placeholder="••••">
          </div>
          <div class="pw-status" id="pw-status">Status message</div>
          <button class="submit-btn" id="pw-btn" onclick="doChangePassword()">Change Password</button>
        </div>
        <div class="tab-content" id="tab-activity" style="display:none;">
          <div id="activity-list" style="display:flex;flex-direction:column;gap:5px;width:100%;"></div>
        </div>
        <div class="tab-content" id="tab-sessions" style="display:none;">
          <div id="sessions-list" style="display:flex;flex-direction:column;gap:5px;width:100%;"></div>
        </div>
        <div class="tab-content" id="tab-usage" style="display:none;">
          <div id="usage-list" style="display:flex;flex-direction:column;gap:5px;width:100%;"></div>
        </div>
      </div>
      <div class="panel" id="panel-banner">
        <div class="banner-icon">🚨</div>
        <div class="banner-tcol">
          <div class="banner-ttl" id="banner-ttl">Alert</div>
          <div class="banner-msg" id="banner-msg">Message placeholder</div>
        </div>
        <button class="dismiss-btn" onclick="onDismiss()">OK</button>
      </div>
    </div>
    <div id="dot" class="hidden">
      <div class="warn-pulse"></div>
    </div>
  </div>

  <script>
    const { ipcRenderer } = require('electron');

    let session = ${sessionJson};
    const isDevMode = ${isDevMode};
    const initialLogs = ${initialLogsJson};

    function normalise(s) {
      if (!s || !s.startTime) return s;
      let t = String(s.startTime).trim().replace(' ', 'T');
      if (!/[Zz]|[+\\-]\\d{2}:?\\d{2}$/.test(t)) t += 'Z';
      s.startTime = t;
      return s;
    }
    session = normalise(session);

    let state = 'compact', isHovered = false, isChecking = false, isProfileOpen = false;
    let alertMsg = '', bannerTimer = null;

    const island = document.getElementById('island');
    const dot    = document.getElementById('dot');
    const row    = document.getElementById('row');

    const ALL_STATES = ['compact','split','check','card','banner','profile'];
    function applyState(ns) {
      if (ns === state) return;
      state = ns;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
      ALL_STATES.forEach(s => island.classList.remove('s-' + s));
      island.classList.add('s-' + state);
      dot.className = state === 'split' ? 'visible' : 'hidden';
      setTimeout(() => {
        const p = document.getElementById('panel-' + state);
        if (p) p.classList.add('show');
      }, 420);
    }

    function resolveState() {
      if (alertMsg)      return 'banner';
      if (isChecking)    return 'check';
      if (isProfileOpen) return 'profile';
      if (isHovered)     return 'card';
      if (session && session.mode === 'prepaid' && getRemainingSec() < 300 && getRemainingSec() >= 0) return 'split';
      return 'compact';
    }

    function tick() { applyState(resolveState()); }

    function getStartMs() {
      if (!session || !session.startTime) return Date.now();
      const ms = new Date(session.startTime).getTime();
      return isNaN(ms) ? Date.now() : ms;
    }
    function getElapsedSec() { return Math.max(0, Math.floor((Date.now() - getStartMs()) / 1000)); }
    function getRemainingSec() {
      if (!session || session.mode !== 'prepaid') return Infinity;
      return Math.max(0, ((session.durationMinutes || 0) * 60) - getElapsedSec());
    }
    function fmt(sec) {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return [h,m,s].map(v => String(v).padStart(2,'0')).join(':');
    }

    function updateUI() {
      if (!session) return;
      const isPrepaid = session.mode === 'prepaid';
      const elapsed   = getElapsedSec();
      const remaining = getRemainingSec();
      const timeStr   = isPrepaid ? fmt(remaining) : fmt(elapsed);

      const ct = document.getElementById('compact-time'); if (ct) ct.textContent = timeStr;
      const st = document.getElementById('split-time');   if (st) st.textContent = timeStr;
      const ct2= document.getElementById('card-time');    if (ct2) ct2.textContent = timeStr;

      const nameEl = document.getElementById('card-name'); if (nameEl) nameEl.textContent = session.user || 'Guest';
      const profTitle = document.getElementById('prof-user-title'); if (profTitle) profTitle.textContent = (session.user || 'Guest') + ' Profile';
      const badge  = document.getElementById('card-badge');
      if (badge) {
        badge.textContent      = isPrepaid ? 'Prepaid' : 'Postpaid';
        badge.style.background = isPrepaid ? 'rgba(59,130,246,0.25)' : 'rgba(16,185,129,0.25)';
        badge.style.color      = isPrepaid ? '#93c5fd' : '#6ee7b7';
      }
      const tl = document.getElementById('card-tlabel'); if (tl) tl.textContent = isPrepaid ? 'Remaining' : 'Time Used';
      const se = document.getElementById('card-start');
      if (se) {
        const d = new Date(getStartMs());
        se.textContent = isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
      }
      const rate   = parseFloat(session.planPrice) || 5.0;
      const costEl = document.getElementById('card-cost');
      if (costEl) costEl.textContent = isPrepaid ? ('$' + rate.toFixed(2)) : ('$' + ((elapsed/3600)*rate).toFixed(2));
      tick();
    }

    island.addEventListener('mouseenter', () => { if (alertMsg || isChecking || isProfileOpen) return; isHovered = true;  tick(); });
    island.addEventListener('mouseleave', () => { if (isProfileOpen) return; isHovered = false; tick(); });
    document.addEventListener('mousemove', e => {
      const ri = island.getBoundingClientRect(), rd = dot.getBoundingClientRect();
      const inside = (x,y,r) => x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;
      ipcRenderer.send('island-mouse', !inside(e.clientX,e.clientY,ri) && !inside(e.clientX,e.clientY,rd));
    });

    ipcRenderer.on('sync-session-data',    (_, s) => { session = normalise({...session,...s}); updateUI(); });
    ipcRenderer.on('set-fullscreen-state', (_, v) => { /* noop: removed auto minimizing */ });
    ipcRenderer.on('set-evaluating-state', (_, v) => { isChecking   = v; tick(); });
    ipcRenderer.on('show-message', (_, msg) => {
      alertMsg = msg;
      const ttl = document.getElementById('banner-ttl');
      const bm  = document.getElementById('banner-msg');
      const isW = msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('violation') || msg.toLowerCase().includes('blocked');
      if (ttl) { ttl.textContent = isW ? 'Safety Warning' : 'Operator Alert'; ttl.style.color = isW ? '#f87171' : '#60a5fa'; }
      if (bm)  bm.textContent = msg;
      tick();
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { alertMsg = ''; tick(); }, 3000);
    });
    ipcRenderer.on('agent-log-updated', (_, entry) => {
      if (!isDevMode) return;
      const el = document.getElementById('dev-log'); if (!el) return;
      const line = document.createElement('div'); line.className = 'log-line';
      line.textContent = '['+entry.timestamp+'] '+entry.message;
      el.appendChild(line);
      while (el.childNodes.length > 25) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    });

    function onExit()    { ipcRenderer.send('exit-session-request'); }
    function onDismiss() { alertMsg=''; if(bannerTimer){clearTimeout(bannerTimer);bannerTimer=null;} tick(); }
    function saveLog()   { ipcRenderer.send('save-client-log'); }

    let activeTab = 'password';
    function openProfile() {
      isProfileOpen = true;
      isHovered = false;
      tick();
      populateActivity();
      populateSessions();
      populateUsage();
    }
    function closeProfile() {
      isProfileOpen = false;
      isHovered = false;
      tick();
    }
    function showTab(name) {
      activeTab = name;
      ['password','activity','sessions','usage'].forEach(t => {
        document.getElementById('tab-'+t).style.display = t===name ? '' : 'none';
      });
      document.querySelectorAll('.prof-tab').forEach((btn, i) => {
        btn.classList.toggle('active', ['password','activity','sessions','usage'][i] === name);
      });
    }

    async function doChangePassword() {
      const oldPw = document.getElementById('pw-old').value;
      const newPw = document.getElementById('pw-new').value;
      const confPw = document.getElementById('pw-confirm').value;
      const btn = document.getElementById('pw-btn');
      if (!oldPw || !newPw || !confPw) { showPwStatus('All fields are required.', false); return; }
      if (newPw !== confPw) { showPwStatus('New passwords do not match.', false); return; }
      if (newPw.length < 4) { showPwStatus('Password must be at least 4 characters.', false); return; }
      const username = (session && session.user) || '';
      if (!username) { showPwStatus('Session user not found.', false); return; }
      btn.disabled = true; btn.textContent = 'Changing...';
      try {
        const res = await ipcRenderer.invoke('agent-change-password', username, oldPw, newPw);
        showPwStatus(res.message || (res.success ? 'Password changed!' : 'Failed.'), res.success);
        if (res.success) {
          document.getElementById('pw-old').value = '';
          document.getElementById('pw-new').value = '';
          document.getElementById('pw-confirm').value = '';
        }
      } catch(e) {
        showPwStatus('Error: ' + (e.message || 'Unknown'), false);
      } finally { btn.disabled = false; btn.textContent = 'Change Password'; }
    }
    function showPwStatus(msg, ok) {
      const el = document.getElementById('pw-status');
      el.textContent = msg; el.className = 'pw-status ' + (ok ? 'ok' : 'err'); el.style.display = 'block';
    }
    function populateActivity() {
      const el = document.getElementById('activity-list'); if (!el) return;
      const logs = (typeof initialLogs !== 'undefined' && initialLogs.length > 0) ? initialLogs.slice(-10) : [];
      if (!logs.length) { el.innerHTML = '<div class="empty-msg">No recent activity.</div>'; return; }
      el.innerHTML = logs.map(l => '<div class="list-row"><span class="list-label">'+l.timestamp+'</span><span class="list-val" style="font-size:10px;color:rgba(255,255,255,0.7);">'+l.message.substring(0,30)+'</span></div>').join('');
    }
    function populateSessions() {
      const el = document.getElementById('sessions-list'); if (!el) return;
      if (!session) { el.innerHTML = '<div class="empty-msg">No session data.</div>'; return; }
      const startD = new Date(getStartMs());
      el.innerHTML = '<div class="list-row"><span class="list-label">Current</span><span class="list-val">'+startD.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:true})+'</span></div>'
        + '<div class="list-row"><span class="list-label">Type</span><span class="list-val">'+(session.mode==='prepaid'?'Prepaid':'Postpaid')+'</span></div>'
        + '<div class="list-row"><span class="list-label">Elapsed</span><span class="list-val">'+fmt(getElapsedSec())+'</span></div>'
        + '<div class="empty-msg" style="margin-top:6px;font-size:10px;">Full history on server.</div>';
    }
    function populateUsage() {
      const el = document.getElementById('usage-list'); if (!el) return;
      const elapsed = getElapsedSec(), todayMins = Math.floor(elapsed/60), weekGoal = 600;
      const pct = Math.min(100, Math.round((todayMins/weekGoal)*100));
      el.innerHTML = '<div class="list-row"><span class="list-label">Today</span><span class="list-val">'+fmt(elapsed)+'</span></div>'
        + '<div class="list-row"><span class="list-label">Weekly Goal</span><span class="list-val">'+weekGoal+'m</span></div>'
        + '<div class="list-row"><span class="list-label">Progress</span><span class="list-val">'+pct+'%</span></div>'
        + '<div class="usage-bar-wrap"><div class="usage-bar-fill" style="width:'+pct+'%"></div></div>'
        + '<div class="empty-msg" style="margin-top:6px;font-size:10px;">Full history on server.</div>';
    }

    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        ipcRenderer.send('resize-island', { width: Math.ceil(e.contentRect.width)+24, height: Math.ceil(e.contentRect.height)+20 });
      }
    });
    ro.observe(row);

    if (isDevMode) {
      const wrap = document.getElementById('dev-log-wrap'); if (wrap) wrap.style.display='block';
      const el = document.getElementById('dev-log');
      if (el) { for (const log of initialLogs) { const l=document.createElement('div'); l.className='log-line'; l.textContent='['+log.timestamp+'] '+log.message; el.appendChild(l); } el.scrollTop=el.scrollHeight; }
    }

    setInterval(updateUI, 1000);
    updateUI();
    tick();
  </script>
</body>
</html>`;
}

function runPowerShellScript(scriptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(app.getPath('temp'), `setup-kiosk-${Date.now()}.ps1`);
    try {
      fs.writeFileSync(tempPath, scriptText, 'utf8');
      const child = safeSpawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        tempPath
      ]);

      let stdoutData = '';
      child.stdout.on('data', (data: any) => {
        const str = data.toString();
        stdoutData += str;
        process.stdout.write(str);
      });

      child.stderr.on('data', (data: any) => {
        process.stderr.write(data.toString());
      });

      child.on('close', (code: any) => {
        try { fs.unlinkSync(tempPath); } catch {}
        if (code !== 0) {
          reject(new Error(`PowerShell exited with code ${code}`));
        } else {
          resolve(stdoutData);
        }
      });

      child.on('error', (err: any) => {
        try { fs.unlinkSync(tempPath); } catch {}
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function runKioskSetup(): Promise<void> {
  logToUI('Kiosk Setup: Starting custom shell configuration...');
  const exePath = process.execPath;
  const script = `
    Start-Transcript -Path "C:\\NetCafeKiosk_Setup.log" -Force
    
    Write-Host "Starting NetCafe Kiosk Setup at $(Get-Date)"
    Write-Host "Agent Executable Path: ${exePath}"

    # 1. Create CafeKiosk user if it doesn't exist
    $userExists = [bool](Get-LocalUser -Name "CafeKiosk" -ErrorAction SilentlyContinue)
    if (-not $userExists) {
        Write-Host "Creating CafeKiosk user..."
        net user CafeKiosk "CafeKiosk123!" /add /expires:never /active:yes
        wmic useraccount where "name='CafeKiosk'" set PasswordExpires=FALSE
    } else {
        Write-Host "CafeKiosk user already exists."
    }

    # 2. Configure Auto-Logon
    Write-Host "Configuring HKLM Auto-Logon..."
    $winlogon = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "1" -Type String
    Set-ItemProperty -Path $winlogon -Name "DefaultUserName" -Value "CafeKiosk" -Type String
    Set-ItemProperty -Path $winlogon -Name "DefaultPassword" -Value "CafeKiosk123!" -Type String
    Set-ItemProperty -Path $winlogon -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String

    # 3. Enable Shell Launcher feature
    Write-Host "Enabling Client-EmbeddedShellLauncher feature..."
    dism /online /Enable-Feature /all /FeatureName:Client-EmbeddedShellLauncher /NoRestart

    # 4. Get SID of CafeKiosk
    $objUser = New-Object System.Security.Principal.NTAccount("CafeKiosk")
    $strSID = $objUser.Translate([System.Security.Principal.SecurityIdentifier]).Value
    Write-Host "CafeKiosk SID: $strSID"

    # 5. Configure Shell Launcher via WMI if available
    try {
        Write-Host "Attempting Shell Launcher WMI configuration..."
        $ShellLauncherClass = [wmiclass]"\\\\localhost\\root\\standardcimv2\\embedded:WESL_UserSetting"
        if ($ShellLauncherClass) {
            $ShellLauncherClass.SetEnabled($true)
            $ShellLauncherClass.SetCustomShell($strSID, "${exePath}", $null, $null, 0)
            Write-Host "Custom shell registered in WMI successfully."
        }
    } catch {
        Write-Host "WMI Custom Shell configuration failed/skipped: $_"
    }

    # 6. Pre-create User Profile directory and NTUSER.DAT
    $profilePath = "C:\\Users\\CafeKiosk"
    if (!(Test-Path $profilePath)) {
        Write-Host "Pre-creating profile path and NTUSER.DAT hive..."
        New-Item -ItemType Directory -Path $profilePath -Force
        Copy-Item -Path "C:\\Users\\Default\\NTUSER.DAT" -Destination "$profilePath\\NTUSER.DAT" -Force
    }
    # Ensure permissions are set properly
    icacls $profilePath /grant "CafeKiosk:(OI)(CI)F" /T

    # 7. Load Hive, write Shell and GPO registry keys, unload Hive
    Write-Host "Loading NTUSER.DAT hive to write user-specific policies..."
    reg load "HKU\\CafeKioskTemp" "$profilePath\\NTUSER.DAT"
    # Set Kiosk shell in HKCU
    New-Item -Path "HKU:\\CafeKioskTemp\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKU:\\CafeKioskTemp\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name "Shell" -Value "${exePath}"
    # Set Kiosk GPO policies in HKCU
    New-Item -Path "HKU:\\CafeKioskTemp\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKU:\\CafeKioskTemp\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Name "DisableTaskMgr" -Value 1 -Type DWord
    Set-ItemProperty -Path "HKU:\\CafeKioskTemp\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Name "HideFastUserSwitching" -Value 1 -Type DWord
    New-Item -Path "HKU:\\CafeKioskTemp\\Software\\Policies\\Microsoft\\Windows\\System" -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKU:\\CafeKioskTemp\\Software\\Policies\\Microsoft\\Windows\\System" -Name "DisableCMD" -Value 1 -Type DWord
    reg unload "HKU\\CafeKioskTemp"
    Write-Host "User-specific registry keys written and NTUSER.DAT unloaded successfully."

    # 8. Create Scheduled Task to run elevated
    Write-Host "Registering elevated Scheduled Task..."
    $action = New-ScheduledTaskAction -Execute '${exePath}';
    $trigger = New-ScheduledTaskTrigger -AtLogon;
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0);
    $principal = New-ScheduledTaskPrincipal -UserId "CafeKiosk" -RunLevel Highest;
    Register-ScheduledTask -TaskName "NetCafeAgent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force;
    
    Write-Host "NetCafe Kiosk Setup completed successfully."
    Stop-Transcript
  `;

  try {
    const out = await runPowerShellScript(script);
    logToUI(`Kiosk Setup PowerShell stdout: ${out}`);
  } catch (e: any) {
    logToUI(`Kiosk Setup PowerShell failed: ${e.message}`);
  }

  // Install watchdog service
  try {
    const { Service } = require('node-windows');
    const scriptPath = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'dist', 'watchdog.js');
    const svc = new Service({
      name: 'NetCafeAgentWatchdog',
      description: 'NetCafe Agent Service Watchdog',
      script: scriptPath,
      nodePath: process.execPath,
      env: [{
        name: 'ELECTRON_RUN_AS_NODE',
        value: '1'
      }]
    });

    await new Promise<void>((resolve, reject) => {
      svc.on('install', () => {
        svc.start();
        resolve();
      });
      svc.on('alreadyinstalled', () => resolve());
      svc.on('error', (err: any) => reject(err));
      svc.install();
    });
    logToUI('Watchdog Windows Service installed successfully.');
  } catch (e: any) {
    logToUI(`Failed to install watchdog service: ${e.message}`);
  }
}

async function runKioskUninstall(): Promise<void> {
  logToUI('Kiosk Uninstall: Restoring standard shell...');
  const script = `
    Start-Transcript -Path "C:\\NetCafeKiosk_Uninstall.log" -Force
    
    Write-Host "Starting NetCafe Kiosk Uninstall at $(Get-Date)"

    # 1. Disable Auto-Logon
    Write-Host "Disabling Auto-Logon..."
    $winlogon = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
    Set-ItemProperty -Path $winlogon -Name "AutoAdminLogon" -Value "0" -Type String
    Remove-ItemProperty -Path $winlogon -Name "DefaultUserName" -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $winlogon -Name "DefaultPassword" -ErrorAction SilentlyContinue

    # 2. Disable Shell Launcher WMI if enabled
    try {
        Write-Host "Disabling WMI custom shell launcher..."
        $ShellLauncherClass = [wmiclass]"\\\\localhost\\root\\standardcimv2\\embedded:WESL_UserSetting"
        if ($ShellLauncherClass) {
            $ShellLauncherClass.SetEnabled($false)
        }
    } catch {
        Write-Host "WMI custom shell launcher disable skipped: $_"
    }

    # 3. Remove Scheduled Task
    Write-Host "Removing Scheduled Task..."
    Unregister-ScheduledTask -TaskName "NetCafeAgent" -Confirm:$false -ErrorAction SilentlyContinue

    # 4. Delete CafeKiosk user and profile list entry
    Write-Host "Deleting CafeKiosk user account..."
    net user CafeKiosk /delete

    Write-Host "Cleaning up CafeKiosk profile registries and directories..."
    $profileListPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList"
    Get-ChildItem -Path $profileListPath | ForEach-Object {
        $val = Get-ItemProperty -Path $_.PSPath
        if ($val.ProfileImagePath -like "*CafeKiosk") {
            Remove-Item -Path $_.PSPath -Force -Recurse -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -Path "C:\\Users\\CafeKiosk" -Force -Recurse -ErrorAction SilentlyContinue
    
    Write-Host "NetCafe Kiosk Uninstall completed."
    Stop-Transcript
  `;

  try {
    const out = await runPowerShellScript(script);
    logToUI(`Kiosk Uninstall PowerShell stdout: ${out}`);
  } catch (e: any) {
    logToUI(`Kiosk Uninstall PowerShell failed: ${e.message}`);
  }

  // Uninstall watchdog service
  try {
    const { Service } = require('node-windows');
    const scriptPath = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'dist', 'watchdog.js');
    const svc = new Service({
      name: 'NetCafeAgentWatchdog',
      description: 'NetCafe Agent Service Watchdog',
      script: scriptPath,
      nodePath: process.execPath
    });

    await new Promise<void>((resolve, reject) => {
      svc.on('uninstall', () => resolve());
      svc.on('alreadyuninstalled', () => resolve());
      svc.on('error', (err: any) => reject(err));
      svc.uninstall();
    });
    logToUI('Watchdog Windows Service uninstalled successfully.');
  } catch (e: any) {
    logToUI(`Failed to uninstall watchdog service: ${e.message}`);
  }
}
