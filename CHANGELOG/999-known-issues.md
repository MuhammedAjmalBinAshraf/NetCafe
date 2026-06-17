# NetCafe Manager - Re-Audited Known Issues and Technical Debt

This document details the re-audited known issues, platform-specific limitations, security quirks, and code anomalies across the NetCafe Manager server and client agent codebases.

## 1. Security & Password Vulnerabilities
- **Plaintext User Passwords**: The `users` table (created in `server/electron/main.ts` line 70) stores member account passwords as plaintext.
- **Plaintext Staff Credentials**: The `staff` table (seeded at server startup) stores staff passwords as plaintext (`admin` by default). Staff password checks perform direct string comparisons rather than utilizing cryptographic hashing (e.g., bcrypt).
- **Plaintext Operator PIN**: The client-side operator exit password/PIN is stored as a plain text settings key (`operator_password` = `admin` by default) in settings. It is transmitted in plaintext to client terminals via TCP socket commands.

## 2. Shell Launcher & Kiosk Lockdown Quirks
- **WMI Shell Launcher Registry Disconnect**: Windows Embedded Shell Launcher (WESL) configures custom shells via WMI, which does not modify the standard `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon` `Shell` key.
  - *Mitigation*: The `isAgentTheShell()` registry guard was completely removed from the lock-enforcement logic in commit `e498047` to prevent the agent from failing to lock the screen.
- **Explorer.exe Process Termination**: The desktop shell is locked by killing the `explorer.exe` process (`taskkill /F /IM explorer.exe`). On unlock, the agent spawns a new `explorer.exe` process. While effective, this can cause brief screen flashing and resets system tray icons.
- **Admin & Student Account Exclusions**: To prevent administrators from locking themselves out of control panels, language-independent group SID checks (`S-1-5-32-544` for local Administrators) and username exclusions (such as the default user `Student` in commit `7002c48`) are implemented in setup scripts. Standard user lockdown remains strictly enforced.

## 3. Auto-Updater & Watchdog Conflict
- **Watchdog Process Lock Collision**: The watchdog service (`NetCafeAgentWatchdog` running as SYSTEM) attempts to relaunch the agent if it is closed. During auto-update, when the agent tries to update itself, the watchdog would see the process exit and trigger a relaunch before the installer could overwrite the binary, causing a file-lock conflict.
  - *Resolution*: In commit `b38fad3`, the agent was updated to explicitly stop the `NetCafeAgentWatchdog` service via service control manager commands prior to running `quitAndInstall()`.

## 4. Platform-Specific Limitations
- **Linux Bandwidth Limiting**: Throttling speed dynamically is exclusive to Linux agents using native `tc` (Traffic Control) token bucket filters. The Windows and macOS agents gracefully ignore these commands as no-ops.
- **Windows-Only Input Lock**: Hardware input locking via Win32 `BlockInput` is exclusive to Windows. Linux agents do not disable keyboard/mouse inputs during locked or paused states.
- **PowerShell Remote Control Input**: Remote control keyboard and mouse simulation on the agent relies on an active background PowerShell host pipeline (`psProcess`). If PowerShell execution is blocked on the client PC by administrative policies (Execution Policy restrictions), remote input control will fail.

## 5. Unused Code & Anomalies
- **Redundant `lock-machine` IPC handler**: The server registers a `lock-machine` IPC handler, but the dashboard frontend instead invokes `pause-session` to log session state and lock terminals, rendering `lock-machine` mostly redundant.
- **No Active TODOs/FIXMEs**: An exhaustive codebase scan for `TODO` and `FIXME` comments returned 0 active developer markers.
