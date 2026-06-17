# Installation Logging System

## Description
A comprehensive logging system captures client agent setup, uninstallation transcripts, and application runtime events for auditing and troubleshooting.

## Architecture & Implementation
- **File Paths**: 
  - `packages/agent/kiosk-setup.ps1` (setup log transcript)
  - `packages/agent/kiosk-uninstall.ps1` (uninstall log transcript)
  - `packages/agent/electron/main.ts` (runtime log writer)
- **Log Files**:
  - `C:\NetCafeKiosk_Setup.log` (detailed OS setup logging)
  - `C:\NetCafeKiosk_Uninstall.log` (OS cleanup logging)
  - `C:\NetCafe\logs\agent.log` (agent runtime logs)
- **Live Logging**: Uses `nsExec::ExecToLog` to pipe PS1 script stdout directly into the NSIS installer log panel during installation.

## Current Status
**Fully working**. Log files capture all setup operations (such as WMI registry writes, user creation, and auto-logon writes) and runtime logs.

## Evolution
- **First Implementation Differences**: Originally, the installer macros directly invoked inline PowerShell scripts without streaming. To prevent silent freezes, commit `8e8971b` extracted kiosk setup/uninstall into standalone scripts (`kiosk-setup.ps1` / `kiosk-uninstall.ps1`) bundled as `extraResources`. The NSIS installer then used `nsExec::ExecToLog` to redirect PowerShell stdout/stderr live into the installation detail view.
- **Unused, Disabled, or Superseded Parts**: Inline PowerShell setups originally defined inside NSIS `.nsh` macros are fully superseded by the standalone `.ps1` files. Additionally, all `ShowInstDetails` and `SetDetailsPrint` compile directives were removed from custom macros to prevent installer compiler crashes, and setup logs are written directly to `C:\NetCafeKiosk_Setup.log`.
- `writeInstallLog` was deprecated and removed from the main typescript code.
