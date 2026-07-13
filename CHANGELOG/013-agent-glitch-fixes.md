# 013 - Agent Glitch and Crash Fixes

## Overview
Fixed several bugs that could cause the NetCafe agent to crash unexpectedly or show a black screen after member login.

## Changes
- **Agent Watchdog**: Added an error handler to the `spawn('powershell.exe')` call during updates to prevent unhandled exceptions from crashing the watchdog process.
- **Agent Software Installation**: Added an error handler to the `powershell.exe` script installation spawn.
- **Kiosk User Detection**: Loosened the `isKioskUser()` check to use `.includes('cafekiosk')` rather than strict equality. This prevents the shell-lockout logic from failing when Windows prepends a domain or computer name to the user profile.
