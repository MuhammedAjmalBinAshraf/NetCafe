# Windows Service Watchdog Wrapper

## What Was Implemented
A watchdog service wrapper was implemented to run as a native Windows Service under the SYSTEM account to monitor and protect the client agent from being closed or bypassed.

- Created a watchdog script `watchdog.ts` (`watchdog.js` when compiled).
- Configures a Windows Service `NetCafeAgentWatchdog` using the `node-windows` package.
- The service runs in the background using Electron in pure Node.js mode (`ELECTRON_RUN_AS_NODE=1`).
- Every 10 seconds, it queries `tasklist` to check if `NetCafe Agent.exe` is running.
- If the agent is missing and the active session belongs to `cafekiosk` (verified via `query user`), it launches the agent with highest privileges using the elevated scheduled task `NetCafeAgent`.

## Why (Reasoning & Tradeoffs)
- **Anti-Tamper & High Privilege Relaunch**: Since standard users run with restricted privileges, they cannot launch elevated processes themselves. The watchdog service runs as SYSTEM and can trigger the elevated scheduled task `NetCafeAgent` to relaunch the agent.
- **Process Resilience**: Prevents users from bypassing the lockscreen by using process termination hacks or exploits.
- **Tradeoff**: Increases system service count and introduces a background monitoring overhead (running `tasklist` and `query user` every 10 seconds).

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
- `node-windows`: Utilized to install, start, and uninstall the script as a Windows Service.

## Evolution
- **First Implementation Differences**: The watchdog service (`watchdog.ts`) has remained stable since its initial creation. It compiles to JS and is registered as a Windows Service (`NetCafeAgentWatchdog`) using `node-windows` in `runKioskSetup()`.
- **Unused, Disabled, or Superseded Parts**: The watchdog service is **exclusively Windows-based** (using Windows tasklist and schtasks). When packaged/deployed on non-Windows platforms, it is disabled/ignored.

