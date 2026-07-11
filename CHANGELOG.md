# Changelog

## [1.1.28] — 2026-07-11
### Added
- Remote Update Logging: Replaced standard installer commands execution in `installer.nsh` with a custom `LogAndExec` macro that outputs the full command line, stdout/stderr, and exit code directly into `C:\NetCafe\logs\agent-install.log`.
- Silent Mode Setup: Removed the `IfSilent` skip check for kiosk setup script execution, allowing `kiosk-setup.ps1` to run and configure/log user shell setup during silent updates.
- Server update logs dialog: Added a non-auto-scrolling pre log viewer inside the "Remote Update Status" dialog on the server PC. It populates live log data during downloads, installation, and sends full post-update reports (watchdog log + installation log + setup log) on client agent startup.
- Turn off auto-scroll: Disabled automatic log scrolling to bottom on the client PC auto-updating overlay to make it easier to read logs.

## [1.1.27] — 2026-07-10
### Fixed

- Audio/Input Bleed: Configured the agent lock command to terminate all common browser processes (`chrome.exe`, `msedge.exe`, `firefox.exe`, `brave.exe`, `opera.exe`, `vivaldi.exe`) on lock initiation (user logs off, server disconnects, or system starts locked). This prevents background browser media/audio (like YouTube) from continuing to play and captures keyboard presses after the lock screen overlays.

## [1.1.26] — 2026-07-02
### Added
- Remote Troubleshooting: Added a "Restore Explorer" command button to the admin dashboard machine drawer. When clicked, it instructs the target client agent to immediately set the user's shell registry key back to `explorer.exe`, disable local browser proxy settings, stop the watchdog service, and spawn `explorer.exe` to allow clean manual troubleshooting or downloads.
- Direct update download: Bypassed Electron's `autoUpdater` with a custom direct HTTP downloader to fetch update packages directly from the LAN server via Node's native `http` module. This resolves Mixed Content blocks, signature validation errors, and caching conflicts caused by local unsigned HTTP servers.

## [1.1.25] — 2026-07-02
### Added
- Device and software management, batch installer, audit logging, and offline session disconnect fix.

## [1.1.24] — 2026-07-02
### Added
- Offline session logging and automatic offline test user visibility.

## [1.1.23] — 2026-07-02
### Added
- Soft Blocked (non-violation blocked) query terms support.

## [1.1.22] — 2026-07-01
### Fixed

- Auto-start registration: Restricted the agent's Task Scheduler auto-start task creation to run-level highest on Kiosk user sessions only. Previously, it registered a global task named `NetCafeAgent` that launched on logon of any user (including Administrator and Guest). This caused multi-session double-launch port conflicts (e.g. `EADDRINUSE` on UDP port `9090` and proxy port `8889`), which broke proxy connections. Legacy `NetCafeAgent` tasks are automatically cleaned up on watchdog and installer execution.

## [1.1.21] — 2026-07-01
### Added
- Release version bump.


## [1.1.20] — 2026-06-30
### Fixed
- Registry policies: Added elevated HKLM policy cleanup execution to both the watchdog service startup (running as SYSTEM) and the NSIS installer initialization (running as Administrator). This ensures that old system-wide Chrome/Edge enterprise proxy settings are successfully removed from the `HKLM` registry hive, resolving `ERR_PROXY_CONNECTION_FAILED` errors.

## [1.1.19] — 2026-06-30
### Fixed
- Watchdog packaging: Added `dist/watchdog.js` to `asarUnpack` in the agent configuration. Previously, the compiled watchdog script was inside the packaged ASAR archive, making it unavailable to the Windows service wrapper. This caused the watchdog service to crash on startup, preventing the silent update process and agent auto-restart from running.

## [1.1.18] — 2026-06-30
### Added
- Remote update: Sync Agent updates from GitHub Releases feature. The server automatically checks and downloads the latest agent installer and `latest-agent.yml` from GitHub on startup and provides a manual sync/download button next to the agent update status indicator.

## [1.1.17] — 2026-06-30
### Added
- Browser extensions: Enabled Chrome Web Store access and extension downloads, with blocklists for proxy/VPN extensions.

## [1.1.16] — 2026-06-29
### Fixed
- Security hardening: Restricted Chrome and Edge enterprise policies strictly to the kiosk user's registry hive (`HKCU`). Legacies written to `HKLM` are auto-cleaned on startup. This resolves browser blockages and connection safety errors on the Administrator account.
- Installer: Re-enabled starting the watchdog service at the end of the installation process. This prevents the kiosk system from going to a black screen when running the installer manually.

## [1.1.15] — 2026-06-28
### Fixed
- Remote update: Removed Windows session active check from the watchdog service. This check was permanently blocking update installation because the Windows kiosk user session is always considered 'Active' by the OS, even when the NetCafe Agent is locked. Session protection is fully handled on the agent side before shutdown.

## [1.1.14] — 2026-06-28
### Added
- Member login: Stage 2 Profile screen displaying balance minutes, custom profile details, usage/billing logs, and historical safety violations.
- Offline Test User: Local offline session option on the agent lock screen to bypass server connection, tracking, and web filtering (controllable via server dashboard settings toggle).

## [1.1.13] — 2026-06-28
### Added
- Remote update: Admin confirmation modal displaying the target version before triggering the update check.
- Remote update: Added "Abort Update" button on the server dashboard and TCP command handling to cancel pending updates within the 15-second timer.
- Remote update: Active session detection to automatically defer updates on clients with open billing sessions.

### Fixed
- Remote update: Blocked triggering update if no valid update package or yml is found on the server (`updateHealth.ready === false`).

## [1.1.12] — 2026-06-28
### Fixed
- Security hardening: Changed registry manipulation `execSync` to shell-less `execFileSync` to prevent string/nested double-quote escaping errors inside HKLM/HKCU policies.
- Security hardening: Fixed hardcoded proxy port in Chrome's ProxySettings policy from `8080` to the actual `8889` port used by `MitmProxy`.
- Security hardening: Extended Chrome enterprise policy coverage to Microsoft Edge (both HKLM and HKCU hives).

## [1.1.11] — 2026-06-24
### Added
- VPN / Proxy Bypass Prevention: Implemented Chrome/Edge enterprise registry policies (force proxy, block extensions, block sideloading/developer mode).
- VPN / Proxy Bypass Prevention: Added netsh firewall rules to block VPN protocols (WireGuard, OpenVPN, IPSec, L2TP, PPTP, Shadowsocks).
- VPN / Proxy Bypass Prevention: Added hosts-file sinkhole for VPN provider domains and active background killing of VPN processes/TAP-TUN virtual adapters.

## [1.1.10] — 2026-06-24
### Added
- Dynamic Island: Added Violations tab with session history and penalty totals.
- Dynamic Island: Added queueing mechanism to display penalty announcements after safety violations are dismissed.
- Server: Real-time violation log changed to a scrollable layout, and blacklist/whitelist UI got direct item switching and deletion controls.

## [1.1.9] — 2026-06-24

### Fixed
- Remote update: agent now sets feed URL at runtime from server IP received in trigger-update payload, replacing broken baked-in app-update.yml URL
- Remote update: watchdog now passes --headless --disable-gpu to installer subprocesses, fixing Session 0 GUI hang on silent install
- Remote update: --install-watchdog, --uninstall-watchdog, --install-kiosk, and --uninstall-kiosk startup paths now run fully headless, never create BrowserWindow, and exit cleanly
- Remote update: trigger-update payload now includes serverIp and serverPort

### Added
- update_log DB table: per-machine stage/message/version/percent/timestamp
- update-status TCP event: agent emits stage updates back to server
- update-status IPC event: server relays to dashboard renderer
- Dashboard: live update status panel with per-machine stage indicators
- Dashboard: Update / Update All buttons in machines panel
- API: GET /api/updates/health — checks latest-agent.yml + exe presence
- Dashboard: update file health indicator next to Update button
- Preload: onUpdateStatus IPC bridge

### Files Modified
- packages/agent/electron/main.ts (feed URL, status events, headless guard)
- packages/agent/electron/watchdog.ts (headless flags on subprocess spawn)
- packages/server/electron/main.ts (status relay, serverIp in payload, DB, REST health check)
- packages/server/electron/preload.ts (exposed electronAPI)
- packages/server/src/App.tsx (dashboard UI panel, indicator, and buttons)

## [1.0.91] — 2026-06-23
### Added
- Dynamic Island: 3 new states — message (two-way chat), alert (with auto-dismiss countdown), announcement (operator broadcast, purple-tinted)
- Dynamic Island: startAlertCountdown(), sendStudentReply(), dismissBroadcast()
- Dynamic Island: window.DynamicIsland.show() extended for new states
- Electron IPC: broadcast-receive (main→island), student-reply (island→main)
- Socket.io: broadcast-send, operator-message, student-reply events
- Socket.io: 30-second scheduled broadcast runner
- DB: broadcasts table, scheduled_times table
- Admin dashboard: Broadcast tab with Schedule / Compose / Queue sub-tabs
- Admin dashboard: Live student replies feed
- API: GET|PUT /api/broadcast/schedule, POST /api/broadcast/send, DELETE /api/broadcast/:id, GET /api/broadcast/queue

### Files Modified
- Dynamic Island HTML overlay (3 new panels + CSS + JS)
- Electron main.ts (IPC handlers, socket forwarding)
- Electron preload.ts (contextBridge additions)
- Admin dashboard (new Broadcast tab)
- Express routes (new broadcast endpoints)
- DB schema (2 new tables)

## [1.0.79] - 2026-06-21
### Added
- Dynamic Island floating pill UI (6 states)
- Electron transparent window with IPC resize sync
- Safety check, violation banner, session warning states
- Profile panel with activity, sessions, usage graph, settings tabs
