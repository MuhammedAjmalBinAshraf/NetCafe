# NetCafe Manager - Known Issues, Unused Code, and TODO Audit

This document compiles the findings of the codebase audit regarding unused functions, unregistered or uncalled IPC handlers, TODO/FIXME comments, commented-out code, and platform-specific limitations.

## 1. Unused Functions

- **`writeInstallLog(msg: string)`**
  - **Location**: `packages/agent/electron/main.ts` (Line 80)
  - **Description**: This function was defined to log installation-related messages during client kiosk setup/uninstall processes to `C:\NetCafe\logs\agent-install.log`. However, it is never invoked anywhere in the agent codebase. Setup logs are written directly via PowerShell script transcripts (`C:\NetCafeKiosk_Setup.log`) and streamed via the NSIS installer.

## 2. Registered but Uncalled IPC Handlers

The following Electron IPC handlers are registered in the server's main process but are never invoked by the React frontend (`App.tsx`):

- **`lock-machine`**
  - **Registration**: `packages/server/electron/main.ts` (Line 1364)
  - **Description**: Intended to lock a specific client machine from the dashboard. The frontend instead calls `pause-session` (which handles database session state update and sends a lock command to the client) or uses the `lock-all` global command, rendering the direct `lock-machine` IPC handler redundant/unused.
- **`get-operator-password`**
  - **Registration**: `packages/server/electron/main.ts` (Line 1180)
  - **Description**: Intended to retrieve the current client-side operator override PIN/password from database settings. The frontend has controls to change the operator PIN (`set-operator-password`) but never invokes `get-operator-password` to view it.
- **`backup-db`**
  - **Registration**: `packages/server/electron/main.ts` (Line 184)
  - **Description**: Copies `netcafe.db` to a specified destination. The frontend lacks any database management buttons or backup scheduler triggers, making this handler uncalled.
- **`restore-db`**
  - **Registration**: `packages/server/electron/main.ts` (Line 1493)
  - **Description**: Closes the current database connection, overwrites the DB file, and re-initializes it. The frontend does not expose database restore settings or file-dialog bindings, leaving this handler uncalled.

## 3. TODO & FIXME Markers

- A complete regex search `(TODO|FIXME)` across all files in the `packages` directory returned **0 results**. There are currently no active TODO or FIXME developer comments in the codebase.

## 4. Commented-out Code Blocks

- An audit of the agent and server main files found no blocks of commented-out functional code. Comment lines are exclusively descriptive notes explaining the rationale behind Win32 API calls, registry manipulations, firewall configs, and MITM TLS interception.

## 5. Platform-Specific Limitations & Scaffolding

- **Linux Throttling Limit**: The bandwidth limiting feature (`limit-bandwidth` and `remove-bandwidth` socket commands) is only implemented for Linux client agents using `tc` (Traffic Control). The code checks `process.platform === 'linux'` and behaves as a no-op fallback on Windows.
- **Windows-Only Lockdown Features**: Critical security lockdown mechanisms (Registry shell replacement, NTUSER.DAT loading, watchdog service creation, GPO overrides, and Win32 block input) are wrapped in `win32` platform checks. The Linux agent bypasses these and runs standard user sessions without native UI locks.
