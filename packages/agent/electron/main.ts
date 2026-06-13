import { app, BrowserWindow, dialog, desktopCapturer, Tray, Menu } from 'electron';
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

function createLockWindow() {
  if (lockWindow) return;
  lockWindow = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    kiosk: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const html = `
    <html>
    <head>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        body {
          background: radial-gradient(circle at center, #0f172a, #020617);
          color: white;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          font-family: 'Plus Jakarta Sans', sans-serif;
          overflow: hidden;
        }
        .container {
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 3rem 4rem;
          border-radius: 24px;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          max-width: 500px;
          width: 80%;
          animation: scaleUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin: 0 0 0.5rem 0;
          background: linear-gradient(135deg, #60a5fa, #3b82f6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .pc-name {
          font-size: 1.1rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          color: #93c5fd;
          padding: 0.25rem 1rem;
          border-radius: 9999px;
          display: inline-block;
          margin-bottom: 2rem;
          font-weight: 600;
        }
        p {
          font-size: 1.25rem;
          color: #94a3b8;
          margin: 0 0 2rem 0;
        }
        .info-panel {
          margin-top: 1rem;
          margin-bottom: 2rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.75rem;
          font-family: monospace;
          color: #64748b;
          text-align: left;
        }
        .info-line { display: flex; justify-content: space-between; margin-bottom: 0.35rem; }
        .info-label { color: #64748b; margin-right: 1rem; }
        .info-value { color: #94a3b8; font-weight: bold; word-break: break-all; }
        .footer {
          font-size: 0.875rem;
          color: #64748b;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 1.5rem;
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>NetCafe Terminal</h1>
        <div class="pc-name">${machineId}</div>
        <p>This terminal is locked. Please contact the front desk operator to start your session.</p>
        <div class="info-panel">
          <div class="info-line"><span class="info-label">Server:</span><span class="info-value">${serverUrl}</span></div>
          <div class="info-line"><span class="info-label">Config Path:</span><span class="info-value">${configPath}</span></div>
        </div>
        <div class="footer">Please do not power off the computer.</div>
      </div>
    </body>
    </html>
  `;
  lockWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  lockWindow.on('close', (e) => {
    if (isLocked) {
      e.preventDefault();
    }
  });
}

// OS metrics Helpers
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
      const psCmd = `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); }'; $fg = [Win32]::GetForegroundWindow(); (Get-Process | Where-Object { $_.MainWindowHandle -eq $fg }).MainWindowTitle"`;
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
      if (msg.command === 'unlock') {
        isLocked = false;
        if (lockWindow) {
          lockWindow.destroy();
          lockWindow = null;
        }
      } else if (msg.command === 'lock') {
        isLocked = true;
        createLockWindow();
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

  // Metrics intervals (10 seconds)
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

  // App blocking interval (3 seconds)
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
