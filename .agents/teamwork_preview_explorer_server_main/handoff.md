# Handoff Report: Codebase Scan of Electron main.ts

This handoff report summarizes the findings of a codebase scan of `d:/NetCafe/packages/server/electron/main.ts`.

## 1. Observation
The file `d:/NetCafe/packages/server/electron/main.ts` was examined in its entirety (lines 1 to 1977) using `view_file` and `grep_search`. The following observations were made:

### Implemented Features and Functionality
- **SQLite Database Setup & Migrations (`setupDatabase`)** (lines 44-159): Uses `better-sqlite3` to instantiate and migrate `netcafe.db` under the app userData directory.
  - Queries:
    - Line 46: `SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='machines'`
    - Lines 49-53: Creates tables `machines`, `sessions`, `plans`, `block_rules`
    - Lines 56-59: Inserts default hourly plans
    - Lines 61-62: Creates `staff` table
    - Line 64: Seeds admin staff user: `INSERT OR IGNORE INTO staff (username, password_hash, role) VALUES ('admin', 'admin', 'admin')`
    - Line 66: Creates `settings` table
    - Line 67: Seeds default setting `lab_name`
    - Lines 69-80: Creates `users` table
    - Lines 81-102: Dynamically adds columns (`custom_duration`, `discount`, `hardware_locked`, `uuid`, `violation_count`) and unique index `idx_machines_uuid` using `ALTER TABLE`
    - Lines 106-117: Creates `session_app_logs` table
    - Lines 119-130: Creates `session_process_events` table
    - Lines 133-145: Creates `safety_alerts` table and adds `user_details` column
    - Lines 146-159: Seeds settings defaults: `ai_safety_enabled`, `gemini_api_key`, `filter_porn`, `filter_violence`, `filter_self_harm`, `filter_illegal`, `custom_filter_terms`, `ai_custom_context`, and `operator_password`
- **TCP Socket Server** (lines 161-169, 738-774, 813-816): Runs on port 9000 to interact with client machines.
  - Manages client mapping via sockets and metrics (lines 163-169).
  - Handles client message commands:
    - `register` (lines 215-329): Matches client machine by UUID/MAC address in DB, handles cloned VM duplicate collisions, sends active block rules, locks/unlocks clients, and updates status.
    - `metrics` (lines 330-454): Updates metrics map, logs app usage duration (lines 345-370), logs start/stop events for non-system processes (lines 371-385), and performs safety scans on queries from browser window titles.
    - `screen-frame` (lines 455-463): Recalls live screen frames from client socket and forwards them to the UI.
    - `screenshot-response` (lines 464-474): Resolves a pending screenshot.
    - `command-result` (lines 475-485): Dispatches terminal output results.
    - `browser-query` (lines 486-558) and `query-check-request` (lines 559-688): Intercepts queries from MITM client proxy, checks Layer 1 (custom terms, with progressive warning/locking enforcement) and Layer 2 (Gemini AI API check).
    - `user-login` (lines 689-721): Validates user accounts for client lockscreens, deducts balance, and opens prepaid sessions.
    - `client-request-close` (lines 722-736): Closes session and locks terminal.
- **Windows Firewall Setup (`setupWindowsFirewall`)** (lines 775-811): Adds inbound rules for TCP 9000 and UDP 9090.
- **LAN IP Address Discovery (`getLanIPAddress`)** (lines 964-974): Returns first active external IPv4 address.
- **UDP Broadcast Beacon (`startUdpBroadcast`)** (lines 976-1005): Broadcasts TCP connection string on port 9090 every 3 seconds.
- **Express HTTP IPC Bridge (`startWebServer`)** (lines 909-962): Runs on port 9001 and forwards LAN mobile requests to registered IPC handlers via `/api/ipc` route by matching them in a monkeypatched `ipcRegistry` map.
- **Public Tunneling (`startPublicTunnel`)** (lines 1007-1053): Opens an SSH reverse tunnel to `localhost.run` forwarding port 9001.
- **Auto Updater integration** (lines 1078-1128, 1912-1927): Checks, downloads, and installs updates on the `latest-server` channel. Writes download progress to `C:\\NetCafeServer_Install.log`.

### IPC Channels (`ipcMain.handle`)
- Lines 1059-1061: `get-server-ip`
- Lines 1063-1065: `get-public-url`
- Lines 1068-1071: `get-app-version`
- Lines 1144-1150: `login-staff`
- Lines 1152-1162: `change-staff-password`
- Lines 1164-1178: `change-staff-username`
- Lines 1181-1196: `set-operator-password`
- Lines 1198-1218: `get-machines`
- Lines 1220-1267: `open-session`
- Lines 1269-1274: `pause-session`
- Lines 1276-1304: `resume-session`
- Lines 1306-1344: `extend-session`
- Lines 1346-1359: `close-session`
- Lines 1361-1363: `lock-machine`
- Lines 1365-1367: `message-machine`
- Lines 1369-1371: `power-machine`
- Lines 1373-1375: `restart-machine`
- Lines 1377-1379: `limit-bandwidth`
- Lines 1381-1383: `remove-bandwidth`
- Lines 1386-1395: `lock-all`
- Lines 1397-1404: `message-all`
- Lines 1406-1417: `power-all`
- Lines 1419-1421: `get-plans`
- Lines 1423-1425: `create-plan`
- Lines 1427-1429: `update-plan`
- Lines 1431-1433: `delete-plan`
- Lines 1436-1438: `get-block-rules`
- Lines 1440-1444: `add-block-rule`
- Lines 1446-1450: `toggle-block-rule`
- Lines 1452-1456: `delete-block-rule`
- Lines 1459-1464: `get-settings`
- Lines 1466-1468: `update-settings`
- Lines 1470-1473: `get-safety-alerts`
- Lines 1475-1479: `clear-safety-alerts`
- Lines 1481-1500: `backup-db`
- Lines 1502-1525: `restore-db`
- Lines 1528-1569: `get-reports-summary`
- Lines 1572-1604: `capture-screenshot`
- Lines 1607-1609: `get-users`
- Lines 1611-1618: `create-user`
- Lines 1620-1631: `update-user`
- Lines 1633-1640: `delete-user`
- Lines 1642-1649: `topup-user`
- Lines 1651-1659: `bulk-delete-users`
- Lines 1661-1669: `bulk-topup-users`
- Lines 1672-1684: `bulk-create-users`
- Lines 1686-1726: `bulk-import-users`
- Lines 1728-1739: `download-user-template`
- Lines 1742-1750: `rename-machine`
- Lines 1752-1760: `delete-machine`
- Lines 1763-1769: `get-latest-screen-frames`
- Lines 1771-1773: `send-remote-input`
- Lines 1775-1777: `execute-remote-command`
- Lines 1913-1917: `check-for-updates`
- Lines 1919-1923: `download-update`
- Lines 1925-1927: `quit-and-install`
- Lines 1929-1934: `set-fullscreen`
- Lines 1936-1946: `set-active-mirror`
- Lines 1948-1959: `set-fullscreen-mirror`
- Lines 1961-1966: `toggle-hardware-lock`
- Lines 1968-1971: `get-session-app-logs`
- Lines 1973-1976: `get-session-process-events`

### Platform-Specific Logic
- **Windows-Only Firewall configuration** (lines 775-811): Evaluates `if (process.platform !== 'win32') return` before spawning firewall execution commands (`netsh advfirewall ...`).
- **Windows OpenSSH Client path resolution** (line 1020): Sets ssh command path to `C:\\Windows\\System32\\OpenSSH\\ssh.exe` on win32 platforms.
- **Windows Server Install logging** (lines 1116-1120): Appends download events to `C:\\NetCafeServer_Install.log`.
- **macOS Window-All-Closed check** (lines 1137-1141): Evaluates `if (process.platform !== 'darwin')` before executing `app.quit()` to match standard macOS window behaviors.

### Incomplete/Queued Features and Placeholder/Mock Values
- **TODO/FIXME Comments**: None. A `grep_search` of the file content for `TODO` or `FIXME` yielded no results.
- **Placeholder / Mock / Fallback Values**:
  - Line 337: `os: data.payload.os || 'Windows'` — Fallback operating system name.
  - Line 340: `resolution: data.payload.resolution || { width: 1920, height: 1080 }` — Fallback device resolution.
  - Line 349: `appTitle = data.payload.activeWindow || 'Desktop'` — Fallback window title if missing.
  - Lines 515, 586, 642, 1798, 1831: `hitUserDetails = 'Walk-in User'`, etc. — Default/mock customer name when session lookup fails.
  - Line 933: `const mockEvent = { sender: { send: () => {} } };` — Mock event object passed into IPC handlers during mobile HTTP IPC Bridge requests.
  - Lines 952-955: Development route fallback: `"NetCafe Server API running. Serve UI via Vite in development."`.
  - Line 1119: `NetCafe Server version ${info?.version || 'unknown'}` — Fallback for missing updater version info.
  - Line 1715: `password || 'changeme'` — Default/mock password for imported users if missing in Excel.
  - Lines 1875-1876: Inline string prompt parameters defining formatting behavior for safe/unsafe values.

## 2. Logic Chain
1. We parsed the file `d:/NetCafe/packages/server/electron/main.ts` from top to bottom.
2. By tracing instances of `db.prepare` and `db.exec`, we identified database setup routines, table migrations, and SQL queries with exact line numbers.
3. By tracing instances of `ipcMain.handle`, we mapped every Electron IPC channel exposed to the renderer process.
4. By checking conditional platform blocks (such as `process.platform !== 'win32'` and `process.platform !== 'darwin'`), we identified Windows-specific and macOS-specific paths and commands.
5. By scanning comment strings and variable declarations, we verified that there were no TODO or FIXME tags, but identified several fallback/mock properties and an Express IPC bridge mock object.

## 3. Caveats
- The codebase scan is strictly read-only and confined *exclusively* to `d:/NetCafe/packages/server/electron/main.ts` as requested. We did not inspect database files or client agent codes that communicate with this server.

## 4. Conclusion
The file `d:/NetCafe/packages/server/electron/main.ts` acts as the main process orchestrator. It manages local SQLite schema definition and migrations, hosts a TCP server for agent control, runs a local Express API for mobile/remote management, establishes a reverse SSH tunnel for public WAN access, handles IPC calls from the Electron UI, and uses Gemini's developer API for content safety check operations.

## 5. Verification Method
- Code verification can be done by reviewing `d:/NetCafe/packages/server/electron/main.ts` directly.
- To verify the absence of TODO or FIXME comments:
  `git grep -iE "todo|fixme" packages/server/electron/main.ts`
