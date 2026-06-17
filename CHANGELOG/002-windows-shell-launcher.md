# Windows Shell Launcher & Kiosk Shell Configuration

## Description
The kiosk mode replaces the default Windows Explorer Shell (`explorer.exe`) with `NetCafe Agent.exe` as the system interface for restricted user accounts, locking them out of system resources.

## Architecture & Implementation
- **File Paths**: `packages/agent/electron/main.ts`, `packages/agent/kiosk-setup.ps1`
- **Features Used**: Windows `Client-EmbeddedShellLauncher` (DISM command), WMI class `WESL_UserSetting`
- **Registry Keys**: Overrides `Shell` value under `HKU\[CafeKioskSID]\Software\Microsoft\Windows NT\CurrentVersion\Winlogon` by loading the NTUSER.DAT hive during installer execution. Also sets user GPO keys like `DisableTaskMgr` = 1 and `DisableCMD` = 1.
- **Bypass Guards**: Checks local Administrators group via SID `S-1-5-32-544` and username exclusions (`Student`, `admin`) to prevent locking administrative accounts.

## Current Status
**Fully working** on Windows client environments. It is disabled on Linux.

## Evolution
- **First Implementation Differences**: The original implementation performed a simple registry overwrite to replace the user shell. Later revisions improved robustness by loading/unloading NTUSER.DAT hives during installer execution, checking the local Administrators group using a language-independent SID (`S-1-5-32-544` in commit `d8ac32a`), and excluding specific usernames (e.g. `Student` in commit `7002c48`) to prevent locking administrative accounts.
- **Unused, Disabled, or Superseded Parts**: The native Electron auto-start configuration (`openAtLogin` login item) was disabled and superseded by the instant logon Task Scheduler task (`NetCafeAgent` triggered on Windows logon with highest privileges) and registry tweaks to eliminate the Windows Explorer startup delay (commits `d2ceb0a`, `1e9620e`). Spawns `explorer.exe` on session unlock, and kills it on lock, startup, and disconnect.


