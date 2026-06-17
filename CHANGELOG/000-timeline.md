# NetCafe Manager - Chronological Feature Timeline

This timeline documents the development, evolution, and adjustments of features in NetCafe Manager, compiled from the codebase and git commit logs.

## Chronological Log

### Phase 1: Core Architecture & Platform Scaffolding (2026-06-12 to 2026-06-14)

- **[2026-06-12 / 3e2c76e] ADDED**: Initial commit containing the complete NetCafe Manager monorepo structure. Includes Electron-based Server, React dashboard, Electron-based Client Agent, and the HTML/CSS/JS Vercel Landing Website (`landing-website`).
- **[2026-06-13 / 2dbb9c2] ADDED**: Linux/Ubuntu support scaffolding. Configured `electron-builder` targets (`AppImage`, `deb`) in both package.json files and conditional execution wrappers.
- **[2026-06-13 / 5217d05] ADDED**: Cross-platform CI release pipeline configured via GitHub Actions (`release.yml`).
- **[2026-06-14 / f4d8900] MODIFIED**: Client Agent fallback to handle missing WebSocket protocol format when parsing the server URL.
- **[2026-06-14 / f0adbcc] ADDED**: Basic agent lock screen overlay, client member login fields, and backend user account table.
- **[2026-06-14 / fffe9f0] ADDED**: LAN Auto-Discovery protocol using UDP broadcast sockets (port 9090). Settings gear configuration panel added to Agent.
- **[2026-06-14 / 4ea8831] ADDED**: In-app auto-update mechanism using `electron-updater` integration.
- **[2026-06-14 / 9f9d5fc] ADDED**: Dynamic fetch hook on landing website to query GitHub Releases API for latest stable version tag.
- **[2026-06-14 / 18fe85b] MODIFIED**: Fixed CI packaging script redundancy to prevent EPERM lock errors on Windows build runners.
- **[2026-06-14 / 11370ee] MODIFIED**: Configured workspace-level cache override `ELECTRON_CACHE` in CI pipeline to prevent cross-drive compile crashes.
- **[2026-06-14 / f3a71ab] MODIFIED**: Preload context isolation fix in Server and auto-format URL port checks on Agent.
- **[2026-06-14 / 09989c4] MODIFIED**: Server-side Electron preload SyntaxError fixed by forcing CommonJS output. Exposed update download status to the UI dashboard.

### Phase 2: Protocol Transition, Mirroring & Input Locking (2026-06-15)

- **[2026-06-15 / e1ab32f] REMOVED**: WebSocket protocol completely replaced with raw line-delimited TCP socket protocol (default port 9000).
- **[2026-06-15 / e1ab32f] ADDED**: Registry-based Windows Shell replacement. Overrides `Shell` value under HKCU Winlogon to replace `explorer.exe` with `NetCafe Agent.exe`.
- **[2026-06-15 / 2cac4e2] MODIFIED**: Segregated auto-update channels. Server checks `latest-server.yml` and Client Agent checks `latest-agent.yml` to prevent channel collisions.
- **[2026-06-15 / 0037090] ADDED**: Automated seeding of default operator credentials (`admin`/`admin`) inside SQLite `staff` table. Version badge added to Agent lock screen.
- **[2026-06-15 / aca86c0] ADDED**: Always-on real-time screen mirroring (capturing JPEG frame buffer every 800ms) and remote input control mapping (mouse click, move, double click, and SendKeys).
- **[2026-06-15 / bccae03] ADDED**: Dashboard "Reload" button and client auto-restart hook triggered immediately on successful update download.
- **[2026-06-15 / 8e58584] ADDED**: Real-time Developer System Log consoles to both agent and server UIs. Automated database cleanup of duplicate active sessions.
- **[2026-06-15 / a0cbd9a] ADDED**: Automatic Windows Firewall TCP/UDP rule configuration on server startup. Detailed network error diagnostics (timeout, refused, unreachable) on Agent.
- **[2026-06-15 / f4ae04d] ADDED**: Fullscreen remote control viewport, dragging control, remote CMD executor, Gemini safety query filter, and client updater quit loop fix.
- **[2026-06-15 / f5e364a] ADDED**: Network MAC address identification for client terminals to prevent duplicate registration clashes in cloned VM environments.
- **[2026-06-15 / e2fe4e2] MODIFIED**: Fullscreen remote control viewport scaling, native fullscreen toggling, and compact remote panel sidebar.
- **[2026-06-15 / 8ca5f1b] ADDED**: Client reconnection lock-recovery, hostname synchronization, and letterbox-aware remote click coordinate scaling.
- **[2026-06-15 / 8114fba] ADDED**: Win32 hardware input lock (`BlockInput`) to block physical mouse/keyboard actions on locked client PCs.
- **[2026-06-15 / 35ca55c] ADDED**: Session application focus tracking logs (`session_app_logs`) to monitor user activity. Persistent client UUID saved in `config.json` to support 3+ registrations without MAC collision.
- **[2026-06-15 / 52d95d9] ADDED**: Local custom blocked terms list with instant client-side matching to bypass Gemini API latency for exact keyword blocks.
- **[2026-06-15 / 52d95d9] MODIFIED**: Resolved SQLite `uuid` UNIQUE constraint Alter Table crash by implementing a partial index. Added client autostart trigger on Windows login.
- **[2026-06-15 / d2ceb0a] ADDED**: Synchronization of operator password/PIN to all client terminals. Added View Modes (grid, list, small, large, grouped) on the server dashboard.
- **[2026-06-15 / 1dd72ac] ADDED**: High-definition (1280p/1080p) screen mirroring. Added process execution tracking logs (`session_process_events`).
- **[2026-06-15 / 1ff9daa] ADDED**: Ultra-resolution (2560x1440) fullscreen mirroring. Added Excel bulk user import template generator and sheet parser (`.xlsx`).

### Phase 3: HTTPS Traffic Interception & Safety Filtering (2026-06-15 to 2026-06-16)

- **[2026-06-15 / 9bda089] ADDED**: Man-in-the-Middle (MITM) HTTPS proxy for real-time search query interception. Auto-installation of local Root CA certificate to Windows Trusted Root store.
- **[2026-06-15 / 9bda089] ADDED**: Automatic Firefox enterprise policy generation to trust the CA and use the OS proxy.
- **[2026-06-15 / 6c83fa1] ADDED**: Real-time search query blocking, showing a custom HTML warning page. Dynamic Island UI spinner animation while evaluating query safety.
- **[2026-06-15 / bb5faf1] ADDED**: Electron single instance lock in client agent to prevent connection races.
- **[2026-06-15 / f3234c6] MODIFIED**: Added `keyUsage` and `extKeyUsage` serverAuth cert extensions to intercept certs to resolve Chrome trust warning.
- **[2026-06-15 / 10130d0] ADDED**: Mobile remote control settings panel, QR code popup for easy LAN access, and browser IPC bridge polyfill.
- **[2026-06-16 / 1e9620e] ADDED**: Instant logon startup task registration under Windows Task Scheduler. Collapsible timeline logs and database cleanup on terminal reload.
- **[2026-06-16 / 5f4a1e0] ADDED**: Public reverse tunnel spawning to `localhost.run` (port 9001 -> public URL). Responsive layout for mobile devices, clean member login lock screen UI, persistent active sessions.

### Phase 4: Kiosk Security Hardening & Windows Integration (2026-06-16 to 2026-06-17)

- **[2026-06-16 / 3693cac] ADDED**: Windows Assigned Access kiosk shell configuration, system watchdog service, and Group Policy Object (GPO) lockdown policies.
- **[2026-06-16 / b6491bd] ADDED**: Lock sidebar height/prevent global window scroll. Add multi-select checkboxes, batch top-up/delete actions, and password show/hide toggles to User Management dashboard.
- **[2026-06-16 / 3034a3f] ADDED**: Hardcoded Layer 2 AI system prompt context exposed in dashboard settings. Detailed setup/uninstall transcripts written to `NetCafeKiosk` setup log directories.
- **[2026-06-16 / 0a6840c] ADDED**: Real-time PowerShell setup/uninstall stdout/stderr streaming in NSIS detail window.
- **[2026-06-16 / 8e8971b] ADDED**: Standalone setup and uninstall scripts (`kiosk-setup.ps1` and `kiosk-uninstall.ps1`) bundled as extraResources.
- **[2026-06-16 / 84c420c] MODIFIED**: Fixed NSIS installer context error `ShowInstDetails` called from invalid customInit context (moved to valid Section context). Server app version badge.
- **[2026-06-16 / c93b3d6] MODIFIED**: Removed all `ShowInstDetails` and `SetDetailsPrint` compile directives.
- **[2026-06-16 / c93b3d6] ADDED**: Progressive safety violation enforcement (1st violation = warning only, 2nd+ = locking terminal). Locking member login with "visit Lab In-Charge" message if violation count is high.
- **[2026-06-16 / c93b3d6] ADDED**: Always-visible bottom-center floating zoom pill with +/- and Fit buttons for remote control viewport.
- **[2026-06-16 / 92ab51f] MODIFIED**: Removed trailing backslash from comment lines in NSIS installer script (`installer.nsh`) to prevent fatal warnings.
- **[2026-06-16 / 1f9c63b] ADDED**: Binary guard to restrict shell replacement to standard users, and disabled per-user shell replacement for admin users.
- **[2026-06-17 / 1fdc0a3] ADDED**: Shell replacement protection guards and cleanup of system proxy during agent exit.
- **[2026-06-17 / 2b8740a] MODIFIED**: Moved `ShowInstDetails` to the raw NSIS installer script.
- **[2026-06-17 / dd679bc] ADDED**: Automatic spawning of `explorer.exe` on terminal unlock, and process termination (`taskkill`) of `explorer.exe` on lock/startup/disconnect.
- **[2026-06-17 / 8efb0dc] REMOVED**: Disabled NSIS oneClick install mode to allow setup wizard with progress logs page.
- **[2026-06-17 / d8ac32a] ADDED**: Language-independent check for the local Administrators group using SID (`S-1-5-32-544`). Agent lockscreen system shutdown button, installer finish view log button.
- **[2026-06-17 / 43d1276] MODIFIED**: Prevented installer finish page MUI macro collision.
- **[2026-06-17 / e531ba7] MODIFIED**: Improved registry hive loading/unloading robustness during installer setup, redirected installer logging to file.
- **[250f71c / 250f71c] MODIFIED**: Fixed registry HKU drive mounting and icacls recursion hang.
- **[2026-06-17 / 7002c48] REMOVED**: Excluded default `Student` user account from shell replacement lockdown.
- **[2026-06-17 / d896bc1] ADDED**: Dynamic kiosk configuration support via a parameter block and a local `kiosk.ini` file loader.
- **[2026-06-17 / ed6db19] MODIFIED**: Resolved syntax errors and output redirection issues in setup scripts.
- **[2026-06-17 / fc8d3f5] MODIFIED**: Fixed kiosk setup log locking and parameter syntax errors.
- **[2026-06-17 / b38fad3] MODIFIED**: Stopped `NetCafeAgentWatchdog` service prior to installer run during auto-updates to prevent file-locking. Explicitly unblocked hardware input on startup and session open to prevent keyboard lock freeze.
- **[2026-06-17 / e498047] REMOVED**: Bypassed `isAgentTheShell()` registry checks for WMI Shell Launcher environments to ensure the lock screen launches correctly.
- **[2026-06-17 / ef2e9f5] MODIFIED**: Fixed `vite-plugin-electron` CJS/ESM interop and upgraded Node.js version.
- **[2026-06-17 / cf50397] MODIFIED**: Reverted Node.js version to 20 due to better-sqlite3 compilation limits.
- **[2026-06-17 / 756674e] MODIFIED**: Fixed `vite-plugin-electron-renderer` CJS/ESM interop in `vite.config.ts`.
