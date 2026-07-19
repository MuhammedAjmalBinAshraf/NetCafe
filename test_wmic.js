const { exec } = require('child_process');
exec('wmic process where name="explorer.exe" get executablepath', (e, stdout) => {
  console.log(stdout);
});
