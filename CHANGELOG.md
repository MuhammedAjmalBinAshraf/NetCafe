# Changelog

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
