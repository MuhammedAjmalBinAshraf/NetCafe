import { exec } from 'child_process';

const agentExeName = 'NetCafe Agent.exe';
const taskName = 'NetCafeAgent';

function checkAndRestart() {
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
