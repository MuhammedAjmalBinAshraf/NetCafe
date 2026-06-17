# NetCafe Manager - Chronological Feature Timeline

This timeline documents the development, evolution, and adjustments of features in NetCafe Manager, compiled from the codebase and git commit logs.

## Chronological Log

### 2026-06-14 (Initial Infrastructure & Continuous Integration)

- **[2026-06-14 / 18fe85b] ADDED**: CI packaging configuration (GitHub Actions) resolved redundant package installations to prevent EPERM lock errors on Windows.
- **[2026-06-14 / 11370ee] ADDED**: Workspace-level cache path override (`ELECTRON_CACHE`) in GitHub Actions configuration to avoid cross-drive permissions crashes on Windows runners.
- **[2026-06-14 / f3a71ab] MODIFIED**: Context isolation configuration for preload script in server main and automatically formatted client URL parsing.
- **[2026-06-14 / 09989c4] MODIFIED**: Server-side Electron preload SyntaxError resolved by forcing CommonJS output. Exposed update download status to the UI dashboard. Fixed plan name input validation.

### 2026-06-15 (Core Protocol & Mirroring Infrastructure)

- **[2026-06-15 / e1ab32f] REMOVED**: WebSocket protocol was completely removed and replaced with a raw line-delimited TCP socket protocol (default port 9000).
- **[2026-06-15 / e1ab32f] ADDED**: Windows Shell replacement configuration using WMI `WESL_UserSetting` to replace `explorer.exe` with `NetCafe Agent.exe` for restricted users.
- **[2026-06-15 / 2cac4e2] ADDED**: Release update channel segregation. Server configured to read `latest-server.yml`, and Client Agent configured to read `latest-agent.yml`.
- **[2026-06-15 / 0037090] ADDED**: Automated seeding of default operator credentials (`admin`/`admin`) inside the SQLite `staff` table at startup.
- **[2026-06-15 / 0037090] ADDED**: Manual check/download update panel and version badge on the client agent lock screen footer.
- **[2026-06-15 / aca86c0] ADDED**: Always-on real-time screen mirroring from the agent (capturing frame buffer every 800ms) to the server.
- **[2026-06-15 / aca86c0] ADDED**: Remote input control mapping (mouse clicks, drags, and keystrokes forwarded from server dashboard).
- **[2026-06-15 / aca86c0] MODIFIED**: Stale socket connection cleanup, and added a management shortcut button in the Card UI.
- **[2026-06-15 / bccae03] ADDED**: Dashboard "Reload" button to refresh client metrics, and client auto-restart hook triggered immediately on successful update download.
- **[2026-06-15 / 8e58584] ADDED**: Real-time Developer System Log consoles to both agent and server UIs.
- **[2026-06-15 / 8e58584] ADDED**: Automated database cleanup to resolve duplicate card sessions when restarting or opening a new session.
- **[2026-06-15 / a0cbd9a] ADDED**: Automated Windows Firewall rule configuration (`netsh advfirewall`) on server startup to expose port 9000 TCP and 9090 UDP.
- **[2026-06-15 / a0cbd9a] ADDED**: Detailed network error diagnostics (timed out, connection refused, host unreachable explanations) inside the agent log overlay.
- **[2026-06-15 / f4ae04d] ADDED**: Fullscreen remote control viewport for remote screen mirror control, dragging interaction, and a remote CMD shell execution console.
- **[2026-06-15 / f4ae04d] ADDED**: Google Gemini API safety query filter for analyzing search queries.
- **[2026-06-15 / f4ae04d] ADDED**: Automatic firewall port exception creation in NSIS installer initialization macros.
- **[2026-06-15 / f4ae04d] PARTIALLY FAILED**: Client updater loop frozen during exit routine (resolved by adding check flags).
- **[2026-06-15 / f5e364a] ADDED**: Machine network MAC address identification for client terminals to prevent duplicate registration clashes in cloned VM environments.
- **[2026-06-15 / e2fe4e2] MODIFIED**: Improved remote control scaling, native viewport fullscreen toggle, and a collapsible sidebar layout.
- **[2026-06-15 / 8ca5f1b] ADDED**: Client reconnection lock-recovery, hostname synchronization, and letterbox-aware remote click coordinate scaling (v1.0.26).
- **[2026-06-15 / 8114fba] ADDED**: Win32 hardware input lock (`BlockInput`) to block physical mouse/keyboard actions on locked or rule-violating client PCs.
- **[2026-06-15 / 8114fba] ADDED**: Custom category safety filters and settings submit button for AI Safety on the dashboard.
- **[2026-06-15 / 35ca55c] ADDED**: Session application focus tracking logs (`session_app_logs`) to monitor user activity.
- **[2026-06-15 / 35ca55c] ADDED**: Persistent client UUID saved in `config.json` to support registrations for 3+ terminals without MAC collision.
- **[2026-06-15 / 52d95d9] ADDED**: Local custom blocked terms list with instant client-side matching to bypass Gemini API latency for exact keyword blocks.
- **[2026-06-15 / 52d95d9] MODIFIED**: Resolved SQLite `uuid` UNIQUE constraint Alter Table crash by implementing a partial index. Added client autostart trigger on Windows login.
- **[2026-06-15 / d2ceb0a] ADDED**: Synchronization of operator password/PIN to all client terminals. Added View Modes (grid, list, small, large, grouped) on the server dashboard.
- **[2026-06-15 / 1dd72ac] ADDED**: High-definition (1280p/1080p) screen mirroring. Added process execution tracking logs (`session_process_events`).
- **[2026-06-15 / 1dd72ac] ADDED**: Dedicated navigation tab for AI Safety settings.
- **[2026-06-15 / 1ff9daa] ADDED**: Ultra-resolution (2560x1440) fullscreen mirroring. Added Excel bulk user import template generator and sheet parser (`.xlsx`).
- **[2026-06-15 / 1ff9daa] ADDED**: Real-time CMD shell execution log console on the dashboard. Editable Gemini AI system prompt context field in Settings.

### 2026-06-16 (Interception, Tunnels, & NSIS Installer Progress)

- **[2026-06-16 / 9bda089] ADDED**: Man-in-the-Middle (MITM) HTTPS proxy for real-time search query interception.
- **[2026-06-16 / 9bda089] ADDED**: Auto-installation of local Root CA certificate to Windows Trusted Root store.
- **[2026-06-16 / 9bda089] ADDED**: Automatic Firefox enterprise policy generation to trust the CA and use the OS proxy.
- **[2026-06-16 / 6c83fa1] ADDED**: Real-time search query blocking, showing a custom HTML warning page.
- **[2026-06-16 / 6c83fa1] ADDED**: Dynamic Island UI spinner animation while evaluating query safety.
- **[2026-06-16 / bb5faf1] ADDED**: Electron single instance lock in client agent to prevent connection races.
- **[2026-06-16 / f3234c6] MODIFIED**: Added `keyUsage` and `extKeyUsage` serverAuth cert extensions to intercept certs to resolve Chrome trust warning.
- **[2026-06-16 / 10130d0] ADDED**: Mobile remote control settings panel, QR code popup for easy LAN access, and browser IPC bridge polyfill.
- **[2026-06-16 / 1e9620e] ADDED**: Instant logon startup task registration under Windows Task Scheduler.
- **[2026-06-16 / 1e9620e] MODIFIED**: Collapsible timeline logs and database cleanup on terminal reload.
- **[2026-06-16 / 5f4a1e0] ADDED**: Public reverse tunnel spawning to `localhost.run` (port 9001 -> public URL).
- **[2026-06-16 / 5f4a1e0] ADDED**: Responsive layout for mobile devices, clean member login lock screen UI, persistent active sessions.
- **[2026-06-16 / 3693cac] ADDED**: Windows Assigned Access kiosk shell configuration, system watchdog service, and Group Policy Object (GPO) lockdown policies.
- **[2026-06-16 / 3693cac] PARTIALLY FAILED**: Timer and reload synchronization issues occurred (resolved in the same release).
- **[2026-06-16 / b6491bd] ADDED**: Checkboxes for multi-select, batch top-up/delete actions, and password show/hide toggle.
- **[2026-06-16 / 3034a3f] ADDED**: Hardcoded Layer 2 AI system prompt context exposed in dashboard settings.
- **[2026-06-16 / 3034a3f] ADDED**: Detailed setup/uninstall transcripts written to `NetCafeKiosk` setup log directories.
- **[2026-06-16 / 0a6840c] ADDED**: Real-time PowerShell setup/uninstall stdout/stderr streaming in NSIS detail window.
- **[2026-06-16 / 8e8971b] ADDED**: Standalone setup and uninstall scripts (`kiosk-setup.ps1` and `kiosk-uninstall.ps1`) bundled as extraResources.
- **[2026-06-16 / 84c420c] PARTIALLY FAILED**: NSIS installer context error `ShowInstDetails` called from invalid customInit context (resolved by moving it to valid Section context).
- **[2026-06-16 / 84c420c] ADDED**: Server app version badge.
- **[2026-06-16 / c93b3d6] REMOVED**: Removed all `ShowInstDetails` and `SetDetailsPrint` compile directives as they were invalid in NSIS macros.
- **[2026-06-16 / c93b3d6] ADDED**: Progressive safety violation enforcement (1st violation = warning only, 2nd+ = locking terminal).
- **[2026-06-16 / c93b3d6] ADDED**: Locking member login with "visit Lab In-Charge" message if violation count is high.
- **[2026-06-16 / c93b3d6] ADDED**: Always-visible bottom-center floating zoom pill with +/- and Fit buttons for remote control viewport.
- **[2026-06-16 / 92ab51f] MODIFIED**: Removed trailing backslash from comment lines in NSIS installer script (`installer.nsh`) to prevent fatal warnings.
- **[2026-06-16 / 1f9c63b] ADDED**: Binary guard to restrict shell replacement to standard users, and disabled per-user shell replacement for admin users.

### 2026-06-17 (Shell Protection, Configuration, & Safety Validation)

- **[2026-06-17 / 1fdc0a3] ADDED**: Shell replacement protection guards and cleanup of system proxy during agent exit.
- **[2026-06-17 / 2b8740a] MODIFIED**: Moved `ShowInstDetails` to the raw NSIS installer script.
- **[2026-06-17 / dd679bc] ADDED**: Automatic spawning of `explorer.exe` on terminal unlock, and process termination (`taskkill`) of `explorer.exe` on lock/startup/disconnect.
- **[2026-06-17 / 8efb0dc] REMOVED**: Disabled NSIS oneClick install mode to allow setup wizard with progress logs page.
- **[2026-06-17 / d8ac32a] ADDED**: Language-independent check for the local Administrators group using SID (`S-1-5-32-544`).
- **[2026-06-17 / d8ac32a] ADDED**: Agent lockscreen system shutdown button, installer finish view log button.
- **[2026-06-17 / 43d1276] MODIFIED**: Prevented installer finish page MUI macro collision.
- **[2026-06-17 / e531ba7] MODIFIED**: Improved registry hive loading/unloading robustness during installer setup, redirected installer logging to file.
- **[2026-06-17 / 7002c48] REMOVED**: Excluded default `Student` user account from shell replacement lockdown.
- **[2026-06-17 / d896bc1] ADDED**: Dynamic kiosk configuration support via a parameter block and a local `kiosk.ini` file loader.
- **[2026-06-17 / ed6db19] MODIFIED**: Resolved syntax errors and output redirection issues in setup scripts.
- **[2026-06-17 / fc8d3f5] MODIFIED**: Fixed kiosk setup log locking and parameter syntax errors.
