# Windows Service Watchdog Wrapper

## Description
A native Windows Service watchdog runs under the Local SYSTEM account to continuously monitor and relaunch the NetCafe Agent if it is closed or tampered with.

## Architecture & Implementation
- **File Paths**: `packages/agent/electron/watchdog.ts`, `packages/agent/electron/main.ts`
- **Service Details**: Installs a service named `NetCafeAgentWatchdog` using the `node-windows` package. Runs in pure Node.js mode (`ELECTRON_RUN_AS_NODE=1`).
- **Monitoring Loop**: Checks every 10 seconds via `tasklist`. If `NetCafe Agent.exe` is missing, it verifies the active user is `cafekiosk` (via `query user`) and triggers the elevated task scheduler task (`schtasks /run /tn "NetCafeAgent"`) to relaunch it.

## Current Status
**Fully working** on Windows. Bypassed on Linux.

## Evolution
- **First Implementation Differences**: The watchdog service (`watchdog.ts`) has remained stable since its initial creation. It compiles to JS and is registered as a Windows Service (`NetCafeAgentWatchdog`) using `node-windows` in `runKioskSetup()`.
- **Anti-Lock Update Routine**: In commit `b38fad3`, the agent was updated to explicitly stop the `NetCafeAgentWatchdog` service prior to running `quitAndInstall()` to prevent file-lock conflicts during auto-update.
- **Unused, Disabled, or Superseded Parts**: Disabled on non-Windows platforms.
