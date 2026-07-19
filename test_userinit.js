const { spawn, execSync } = require('child_process');
try {
  execSync('taskkill /F /IM explorer.exe');
} catch (e) {}
console.log('Killed. Spawning userinit...');
const child = spawn('C:\\Windows\\System32\\userinit.exe', [], { detached: true, stdio: 'ignore' });
child.unref();
console.log('Done');
