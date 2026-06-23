import { exec, spawn } from 'child_process';
import fs from 'fs';

const agentExeName = 'NetCafe Agent.exe';
const taskName = 'NetCafeAgent';

function checkAndRestart() {
  if (fs.existsSync("C:\\NetCafe\\install-update.flag")) {
    const installerPath = fs.readFileSync("C:\\NetCafe\\install-update.flag", "utf8").trim();
    if (fs.existsSync(installerPath)) {
      console.log('Update flag found. Delegating update installation to Watchdog service...');
      
      // Create a batch script to install silently and then reboot
      const batPath = "C:\\NetCafe\\install-and-reboot.bat";
      const batContent = `@echo off\r\n"${installerPath}" /S /forceRun=0\r\nshutdown /r /f /t 0\r\n`;
      fs.writeFileSync(batPath, batContent, 'utf8');
      
      // Spawn the batch script completely detached
      const out = fs.openSync('C:\\NetCafe\\logs\\watchdog-update.log', 'a');
      const err = fs.openSync('C:\\NetCafe\\logs\\watchdog-update.log', 'a');
      const child = spawn('cmd.exe', ['/c', batPath], {
        detached: true,
        stdio: ['ignore', out, err],
        windowsHide: true
      });
      child.unref();
      
      // Delete the flag so we don't run it again
      fs.unlinkSync("C:\\NetCafe\\install-update.flag");
      
      // Exit watchdog to avoid file lock conflicts before the installer kills it
      process.exit(0);
    }
  }

  if (fs.existsSync("C:\\NetCafe\\stop-watchdog.flag")) {
    console.log('Watchdog service is temporarily disabled (stop-watchdog.flag found). Skipping check.');
    return;
  }
  exec('tasklist /FI "IMAGENAME eq NetCafe Agent.exe"', (err, stdout) => {
    if (err) return;
    if (!stdout.includes(agentExeName)) {
      exec('query user', (err, queryStdout) => {
        const output = (queryStdout || '').toLowerCase();
        if (output.includes('cafekiosk')) {
          console.log('Kiosk user is active but NetCafe Agent is not running. Relaunching...');
          exec(`schtasks /run /tn "${taskName}"`, (runErr, runStdout) => {
            if (runErr) {
              console.error('Failed to run scheduled task:', runErr);
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
