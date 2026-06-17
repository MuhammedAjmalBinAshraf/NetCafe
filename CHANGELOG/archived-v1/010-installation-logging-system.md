# Installation Logging System

## What Was Implemented
Implemented a logging and auditing mechanism to capture kiosk setup, uninstall, and runtime operations.

- **PowerShell Script Logging**: Writes detailed step status (`START:`, `INFO:`, `STEP:`, `OK:`, `ERROR:`, `DONE:`) with timestamps to:
  - `C:\NetCafe\logs\agent-install.log` (during setup)
  - `C:\NetCafe\logs\agent-uninstall.log` (during uninstall)
- **Installer Redirection**: The NSIS installer calls the PowerShell scripts using `Tee-Object -FilePath` to capture stdout/stderr in real-time.
- **Agent Runtime Logging**: Writes application-level warnings, connections, errors, and system commands to `C:\NetCafe\logs\agent.log` using the `writeAgentRuntimeLog` function.

## Why (Reasoning & Tradeoffs)
- **Auditing & Troubleshooting**: Setting up low-level Windows features (like loading registry hives, creating local users, or configuring WMI objects) is error-prone due to antivirus software, OS version differences, and group policies.
- **Support & Maintenance**: Clear, persistent log files on the local filesystem make it easy for administrators and support teams to diagnose install/uninstall failures.

## Database Tables & Config Files Added
Creates log directories and files under:
- `C:\NetCafe\logs\agent-install.log`
- `C:\NetCafe\logs\agent-uninstall.log`
- `C:\NetCafe\logs\agent.log`

## NPM Dependencies Added
None.

## Evolution
- **First Implementation Differences**: Originally, the installer macros directly invoked inline PowerShell scripts without streaming. To prevent silent freezes, commit `8e8971b` extracted kiosk setup/uninstall into standalone scripts (`kiosk-setup.ps1` / `kiosk-uninstall.ps1`) bundled as `extraResources`. The NSIS installer then used `nsExec::ExecToLog` to redirect PowerShell stdout/stderr live into the installation detail view.
- **Unused, Disabled, or Superseded Parts**: Inline PowerShell setups originally defined inside NSIS `.nsh` macros are fully superseded by the standalone `.ps1` files. Additionally, all `ShowInstDetails` and `SetDetailsPrint` compile directives were removed from custom macros to prevent installer compiler crashes, and instead setup logs are written directly to `C:\NetCafeKiosk_Setup.log`.

