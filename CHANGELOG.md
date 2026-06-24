# Changelog

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
