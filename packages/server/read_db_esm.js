import Database from 'better-sqlite3';
const db = new Database('C:\\Users\\Student\\AppData\\Roaming\\server\\netcafe.db');
console.log("=== MACHINES ===");
console.log(JSON.stringify(db.prepare("SELECT * FROM machines").all(), null, 2));
console.log("=== SESSIONS ===");
console.log(JSON.stringify(db.prepare("SELECT * FROM sessions").all(), null, 2));
