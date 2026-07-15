const { exec } = require('child_process');
exec('schtasks /create /tn "TestTask" /tr "\\"C:\\Program Files\\NetCafe Agent\\NetCafe Agent.exe\\"" /sc onlogon /ru "CafeKiosk" /rl highest /f', (e, stdout, stderr) => {
  console.log(e ? e.message : stdout);
});
