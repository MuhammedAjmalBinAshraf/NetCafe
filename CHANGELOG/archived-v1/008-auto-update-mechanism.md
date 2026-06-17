# Auto-Update Mechanism

## What Was Implemented
Implemented automated background updates for both the NetCafe Server and the NetCafe Agent applications.

- **GitHub Release Integration**: Connected to the owner's GitHub repository (`MuhammedAjmalBinAshraf/NetCafe`).
- **Channel Isolation**: 
  - Server is configured on the `latest` channel.
  - Agent is configured on the `latest-agent` channel.
- **Agent Background Auto-Download**: The agent automatically checks for updates hourly, downloads them, writes the event to `C:\NetCafeKiosk_Setup.log`, and runs `autoUpdater.quitAndInstall()` to apply the update and restart.
- **Server Manual/Interactive Update**: Prompts the administrator with dialogs (`Yes, download and install` vs `Later`) when updates are available, giving them control over system reboots.

## Why (Reasoning & Tradeoffs)
- **Zero-Downtime Terminal Maintenance**: The client agent checks and updates itself silently, meaning the cafe operator does not have to go machine-by-machine to manually install updates.
- **Channel Segregation**: Separating release channels ensures the agent does not download server updates and vice-versa.
- **Tradeoff**: Auto-installing updates can disrupt active sessions if the agent quits and restarts, though the agent checks for updates on boot and restarts quickly.

## Database Tables & Config Files Added
Writes update events to `C:\NetCafeKiosk_Setup.log` and `C:\NetCafe\logs\agent-install.log`.

## NPM Dependencies Added
- `electron-updater` (in both `packages/server` and `packages/agent`): Manages update checks, package downloads, and installation restarts.

## Evolution
- **First Implementation Differences**: Initially, server and client checked for updates on the same release channel. This caused server-agent package collisions. Commit `2cac4e2` separated update channels: the server uses the `latest` channel (`latest-server.yml`), and the client agent uses the `latest-agent` channel (`latest-agent.yml`).
- **Unused, Disabled, or Superseded Parts**: The unified single-channel update process is superseded by channel segregation. The client agent automatically checks for updates hourly, logs downloads to `C:\NetCafeKiosk_Setup.log`, and triggers `autoUpdater.quitAndInstall()` after a 3-second delay.

