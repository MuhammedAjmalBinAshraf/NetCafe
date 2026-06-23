# Project: NetCafe Electron Audit

## Architecture
- Targeted package folders: `packages/agent/electron` and `packages/server/electron`
- Consolidates findings about Electron entry points, preload scripts, MITM proxies, watchdogs, IPC channels, database queries, and platform-specific behaviors.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Scan Agent Main | Scan packages/agent/electron/main.ts | none | DONE (e17b0ab7-2cb0-4c19-a07b-52cadfb238c2) |
| 2 | Scan Agent MITM | Scan packages/agent/electron/mitm-proxy.ts | none | DONE (3bc5215f-ac56-437f-81ad-8bb3d8f7196f) |
| 3 | Scan Agent Watchdog | Scan packages/agent/electron/watchdog.ts | none | DONE (76f8a2b1-74cc-4a5b-98c5-4adb6aa4fab2) |
| 4 | Scan Server Main | Scan packages/server/electron/main.ts | none | DONE (c66786a2-bb55-48c5-a867-591091eebe8e) |
| 5 | Scan Server Preload | Scan packages/server/electron/preload.ts | none | DONE (54376d04-944c-4e4a-af80-77214e4a9b28) |
| 6 | Aggregation & Report | Aggregate results & write report | M1, M2, M3, M4, M5 | DONE |

## Interface Contracts
- No runtime code modifications. All subagents are read-only.
- Subagents report via standard Handoff format.
