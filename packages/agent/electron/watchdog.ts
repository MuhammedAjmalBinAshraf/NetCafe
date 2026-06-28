import { exec, spawn } from 'child_process';
import fs from 'fs';

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
      console.log('Update flag found. Checking for active user sessions before installing...');

      // Guard: only install if no active user session is running.
      // This prevents abruptly killing a billing session mid-use.
      exec('query user', (_err, queryStdout) => {
        const output = (queryStdout || '').toLowerCase();
        let sessionActive = false;

        const lines = output.split(/[\r\n]+/);
        for (const line of lines) {
          if (line.includes('active')) {
            const parts = line.trim().split(/\s+/);
            const username = parts[0]?.replace('>', '').trim();
            if (username) {
              sessionActive = true;
              console.log(`Active user session detected ('${username}'). Deferring update installation until session ends.`);
              // Log deferral to watchdog-update.log
              try {
                if (!fs.existsSync('C:\\NetCafe\\logs')) {
                  fs.mkdirSync('C:\\NetCafe\\logs', { recursive: true });
                }
                fs.appendFileSync(
                  'C:\\NetCafe\\logs\\watchdog-update.log',
                  `[${new Date().toISOString()}] UPDATE DEFERRED: Active session for '${username}' detected. Will retry on next cycle.\r\n`,
                  'utf8'
                );
              } catch {}
              break;
            }
          }
        }

        if (!sessionActive) {
          console.log('No active user session. Proceeding with update installation...');
          runInstaller(installerPath);
        }
      });
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
              if (username) {
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

        if (kioskUserFound && activeUser) {
          console.log(`Kiosk user '${activeUser}' is active but NetCafe Agent is not running. Relaunching...`);
          // Try user-specific task first, fallback to generic
          exec(`schtasks /run /tn "NetCafeAgent_${activeUser}"`, (runErr, runStdout) => {
            if (runErr) {
              console.log(`Failed to run task NetCafeAgent_${activeUser}, falling back to generic NetCafeAgent task.`);
              exec(`schtasks /run /tn "NetCafeAgent"`, (fallbackErr, fallbackStdout) => {
                if (fallbackErr) {
                  console.error('Failed to run scheduled task:', fallbackErr);
                } else {
                  console.log('Scheduled task triggered successfully:', fallbackStdout);
                }
              });
            } else {
              console.log('Scheduled task triggered successfully:', runStdout);
            }
          });
        }
      });
    }
  });
}

// Check every 10 seconds
setInterval(checkAndRestart, 10000);
console.log('NetCafe Agent watchdog service started.');
