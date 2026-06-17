# CafeKiosk Dedicated User Account Approach

## What Was Implemented
The kiosk setup script automates the creation and configuration of a dedicated local standard user account named `CafeKiosk` (customizable via `kiosk.ini`) to serve as the default session interface on the client machine.

- Checks if the user exists; if not, it runs `net user` to create it.
- Sets password expiration to false via `wmic useraccount`.
- Configures **Windows Auto-Logon** by writing to `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`:
  - `AutoAdminLogon = 1`
  - `DefaultUserName = CafeKiosk`
  - `DefaultPassword = [KioskPassword]`
  - `DefaultDomainName = [COMPUTERNAME]`
- Grants full permission control to the profile directory `C:\Users\CafeKiosk` via `icacls`.

## Why (Reasoning & Tradeoffs)
- **Zero-Configuration Client Setup**: Cafe operators do not need to manually create accounts, configure passwords, or enable autologin. Running the setup binary automates the entire OS-level configuration.
- **Security Isolation**: Running customer sessions under a restricted standard user account ensures they cannot make system modifications, access other profiles, or delete critical files.
- **Convenient Boot Behavior**: Setting up Auto-Logon ensures the client PC automatically boots into the kiosk account and launches the lock screen without requiring user input.

## Database Tables & Config Files Added
- `C:\NetCafe\kiosk.ini`: Configuration file read at script startup to override default username and password settings.
- `C:\NetCafe\installed.flag`: Flag file written when the setup completes successfully.

## NPM Dependencies Added
None.

## Evolution
- **First Implementation Differences**: Initially, the dedicated user `CafeKiosk` was created with a hardcoded password (`CafeKiosk123!`). Later in commit `d896bc1` (v1.0.54), this was refactored to support dynamic kiosk configuration via a parameter block in the PowerShell setup script and a local `kiosk.ini` loader, allowing custom usernames and passwords.
- **Unused, Disabled, or Superseded Parts**: Hardcoded auto-logon registry configurations are superseded by dynamic variables loaded from `C:\NetCafe\kiosk.ini`.

