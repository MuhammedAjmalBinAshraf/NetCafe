# CafeKiosk Dedicated User Account Approach

## Description
The kiosk setup script automates the creation and configuration of a dedicated local standard user account (default: `CafeKiosk`) to serve as the isolated customer session environment on client computers.

## Architecture & Implementation
- **File Paths**: `packages/agent/electron/main.ts`, `packages/agent/kiosk-setup.ps1`
- **User Creation**: Invokes `net user` to create the account, and sets password expiration to false via `wmic useraccount`.
- **Auto-Logon configuration**: Writes HKLM registry keys under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`:
  - `AutoAdminLogon` = "1" (REG_SZ)
  - `DefaultUserName` = Kiosk User (default: `CafeKiosk`)
  - `DefaultPassword` = Kiosk Password (default: `CafeKiosk123!`)
  - `DefaultDomainName` = Computer name.
- **Directory Permissions**: Sets profile permissions using `icacls` to grant the kiosk user full control over its home folder.

## Current Status
**Fully working** on Windows environments. Unsupported on Linux.

## Evolution
- **First Implementation Differences**: Initially, the dedicated user `CafeKiosk` was created with a hardcoded password (`CafeKiosk123!`). Later in commit `d896bc1` (v1.0.54), this was refactored to support dynamic kiosk configuration via a parameter block in the PowerShell setup script and a local `kiosk.ini` loader, allowing custom usernames and passwords.
- **Unused, Disabled, or Superseded Parts**: Hardcoded auto-logon registry configurations are superseded by dynamic variables loaded from `C:\NetCafe\kiosk.ini`.
