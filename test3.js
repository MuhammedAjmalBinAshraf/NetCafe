const { spawn, execSync } = require('child_process');
try {
  execSync('taskkill /F /IM explorer.exe');
} catch (e) {}
console.log('Killed. Spawning explorer...');
const child = spawn('C:\\Windows\\explorer.exe', [], { detached: true, stdio: 'ignore' });
child.unref();
console.log('Done');
