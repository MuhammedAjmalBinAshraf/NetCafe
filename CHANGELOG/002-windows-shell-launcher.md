# Windows Shell Launcher & Kiosk Shell Configuration

## What Was Implemented
Instead of relying solely on standard application launching, the kiosk mode replaces the default Windows Explorer Shell (`explorer.exe`) with `NetCafe Agent.exe` as the system interface for standard/restricted user accounts.

- Enabled via the Windows feature `Client-EmbeddedShellLauncher` (using DISM commands).
- Registered using the WMI class `WESL_UserSetting` for the user account SID.
- Leverages per-user NTUSER.DAT registry hive loading/unloading during installer execution to write the `Shell` value override directly under `Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell`.
- Implements safety guards to ensure accounts belonging to the `Administrators` group are bypassed and left with `explorer.exe` as their shell.

## Why (Reasoning & Tradeoffs)
- **Absolute Lockdown**: By disabling `explorer.exe`, standard OS user interface components—such as the Start Menu, Taskbar, Desktop, File Explorer, and Win+X shortcut menus—are completely unavailable. This prevents users from closing the locker or opening system tools.
- **Boot Performance**: Bypassing the Explorer shell allows the NetCafe Agent to launch immediately upon login, satisfying the requirement to show the lockscreen in under 3 seconds.
- **Tradeoff**: Restricting the system interface requires an administrative backup path (loading `explorer.exe` manually via Task Manager) in case the custom shell crashes.

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
None.

## Evolution
- **First Implementation Differences**: The original implementation performed a simple registry overwrite to replace the user shell. Later revisions improved robustness by loading/unloading NTUSER.DAT hives during installer execution, checking the local Administrators group using a language-independent SID (`S-1-5-32-544` in commit `d8ac32a`), and excluding specific usernames (e.g. `Student` in commit `7002c48`) to prevent locking administrative accounts.
- **Unused, Disabled, or Superseded Parts**: The native Electron auto-start configuration (`openAtLogin` login item) was disabled and superseded by the instant logon Task Scheduler task (`NetCafeAgent` triggered on Windows logon with highest privileges) and registry tweaks to eliminate the Windows Explorer startup delay (commits `d2ceb0a`, `1e9620e`).

