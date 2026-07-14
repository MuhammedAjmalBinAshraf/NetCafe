import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const agentExeName = 'NetCafe Agent.exe';

function runInstaller(installerPath: string) {
  const logFile = 'C:\\NetCafe\\logs\\watchdog-update.log';
  const psCommand = `Start-Transcript -Path "${logFile}" -Append; Write-Host "Watchdog starting update installation..."; Start-Process -FilePath "${installerPath}" -ArgumentList "/S /headless /disable-gpu" -Wait; Write-Host "Update installed. Rebooting..."; Restart-Computer -Force`;

  // Ensure logs directory exists
  try {
    if (!fs.existsSync('C:\\NetCafe\\logs')) {
      fs.mkdirSync('C:\\NetCafe\\logs', { recursive: true });
    }
  } catch {}

  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // Spawn PowerShell detached
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', psCommand
  ], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  });
  child.on('error', (err) => {
    console.error('Failed to spawn installer powershell:', err);
  });
  child.unref();

  // Delete the flag so we don't run it again
  try {
    fs.unlinkSync('C:\\NetCafe\\install-update.flag');
  } catch {}

  // Exit watchdog to avoid file lock conflicts before the installer kills it
  process.exit(0);
}

function checkAndRestart() {
  if (fs.existsSync('C:\\NetCafe\\install-update.flag')) {
    const installerPath = fs.readFileSync('C:\\NetCafe\\install-update.flag', 'utf8').trim();
    if (fs.existsSync(installerPath)) {
      console.log('Update flag found. Proceeding with update installation...');
      runInstaller(installerPath);
      return; // Don't fall through to the restart logic while an update is pending
    }
  }

  if (fs.existsSync('C:\\NetCafe\\stop-watchdog.flag')) {
    console.log('Watchdog service is temporarily disabled (stop-watchdog.flag found). Skipping check.');
    return;
  }

  exec('tasklist /FI "IMAGENAME eq NetCafe Agent.exe"', (err, stdout) => {
    if (err) return;
    if (!stdout.includes(agentExeName)) {
      exec('query user', (err, queryStdout) => {
        const output = (queryStdout || '').toLowerCase();
        let kioskUserFound = false;
        let activeUser = '';

        // Find active users from query user
        const lines = output.split(/[\r\n]+/);
        for (const line of lines) {
          if (line.includes('active')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 0) {
              const username = parts[0].replace('>', '').trim();
              if (username && username.toLowerCase() === 'cafekiosk') {
                activeUser = username;
                kioskUserFound = true;
                break;
              }
            }
          }
        }

        // As a fallback, if query user has output but no "active" label parsed, check for 'cafekiosk'
        if (!kioskUserFound && output.includes('cafekiosk')) {
          activeUser = 'cafekiosk';
          kioskUserFound = true;
        }

        // Check if agent is NOT running and kiosk user IS active
        if (kioskUserFound && activeUser) {
          console.log(`Kiosk user '${activeUser}' is active but NetCafe Agent is not running. Relaunching...`);
          
          const exePath = path.join(__dirname, '..', '..', '..', 'NetCafe Agent.exe');
          const taskName = `NetCafeAgent_${activeUser}`;
          const createCmd = `schtasks /create /tn "${taskName}" /tr "\\"${exePath}\\"" /sc onlogon /ru "${activeUser}" /rl highest /f`;
          
          // Recreate task and kill explorer to clear the black screen / broken shell
          exec(createCmd, () => {
            exec('taskkill /F /IM explorer.exe', () => {
              exec(`schtasks /run /tn "${taskName}"`, (runErr, runStdout) => {
                if (runErr) {
                  console.error('Failed to restart agent:', runErr.message);
                } else {
                  console.log('Agent restart triggered successfully.');
                }
              });
            });
          });
        }
      });
    }
  });
}

// Check every 10 seconds
setInterval(checkAndRestart, 10000);
console.log('NetCafe Agent watchdog service started.');

// Launch diagnostic logger
const loggerPath = path.join(__dirname, '..', '..', 'diagnostic-logger.ps1');
try {
  const debugLog = 'C:\\NetCafe\\logs\\watchdog-debug.log';
  if (!fs.existsSync('C:\\NetCafe\\logs')) fs.mkdirSync('C:\\NetCafe\\logs', { recursive: true });
  fs.appendFileSync(debugLog, `\n[${new Date().toISOString()}] Watchdog started. Logger path resolved to: ${loggerPath}\n`);
  fs.appendFileSync(debugLog, `Exists? ${fs.existsSync(loggerPath)}\n`);
} catch {}

if (fs.existsSync(loggerPath)) {
  console.log('Spawning diagnostic logger at: ' + loggerPath);
  const loggerChild = spawn('powershell.exe', [
    '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass',
    '-File', loggerPath
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  loggerChild.unref();
}

function cleanLegacyHklmPolicies() {
  if (process.platform !== 'win32') return;
  const chromeBase = 'Google\\Chrome';
  const edgeBase = 'Microsoft\\Edge';
  const keys = [
    'ProxySettings',
    'BlockExternalExtensions',
    'DeveloperToolsAvailability',
    'SyncDisabled',
    'IncognitoModeAvailability',
    'InPrivateModeAvailability',
    'WebRtcIPHandling',
    'DnsOverHttpsMode'
  ];

  for (const name of keys) {
    try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${chromeBase}" /v "${name}" /f`); } catch {}
    try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${edgeBase}" /v "${name}" /f`); } catch {}
  }
  try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${chromeBase}\\ExtensionInstallBlocklist" /f`); } catch {}
  try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${chromeBase}\\URLBlocklist" /f`); } catch {}
  try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${edgeBase}\\ExtensionInstallBlocklist" /f`); } catch {}
  try { exec(`reg.exe delete "HKLM\\SOFTWARE\\Policies\\${edgeBase}\\URLBlocklist" /f`); } catch {}
}

// Run cleanup immediately on watchdog service startup (runs with SYSTEM privileges)
try {
  cleanLegacyHklmPolicies();
} catch (e: any) {
  console.error('Failed to run HKLM cleanup in watchdog:', e.message);
}

// Remove legacy global NetCafeAgent scheduled task to prevent multi-user double-launch port conflicts
try {
  exec('schtasks /Delete /TN "NetCafeAgent" /F');
} catch {}


