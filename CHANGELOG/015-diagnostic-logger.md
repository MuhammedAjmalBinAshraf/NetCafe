# 015 - Exhaustive Background Diagnostic Logger

## Overview
Added a robust, hidden PowerShell diagnostic logger that runs continuously in the background to capture exhaustive system state data for debugging the kiosk shell black screen issue.

## Changes
- Created `diagnostic-logger.ps1` which runs an infinite loop capturing system snapshots every 2 seconds.
- The snapshot logs the precise registry state of `Winlogon\Shell`, the running status and PIDs of the Agent and `explorer.exe`, the active foreground application, active TCP/UDP network connections, and the state of the `cafekiosk` user session.
- Modified the `watchdog` service to automatically spawn this logger seamlessly in the background as SYSTEM upon boot.
- Added a 50MB log rollover limit so it doesn't consume excessive disk space.
- The logs are saved in plain text to `C:\NetCafe\logs\diagnostic-trace.txt`.
