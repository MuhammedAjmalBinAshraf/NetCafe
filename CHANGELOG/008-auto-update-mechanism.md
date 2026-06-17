# Auto-Update Mechanism

## Description
Both server and client agent download and apply update releases from GitHub automatically or interactively, maintaining version synchronization.

## Architecture & Implementation
- **File Paths**: `packages/server/electron/main.ts`, `packages/agent/electron/main.ts`
- **Updates Engine**: Uses `electron-updater` hooked to the `MuhammedAjmalBinAshraf/NetCafe` GitHub Releases repository.
- **Channel Segregation**: Server targets the `latest-server` channel, while Agent targets the `latest-agent` channel to avoid packages clashing.
- **Service Coordination**: Agent stops the `NetCafeAgentWatchdog` service prior to calling `quitAndInstall()` to prevent file-locking.

## Current Status
**Fully working**. Agent auto-updates hourly, and Server update prompts notify the operator.

## Evolution
- **First Implementation Differences**: Server and client originally verified updates on a single, shared release channel. This caused server-agent package collisions. Commit `2cac4e2` separated update channels: the server uses the `latest` channel (`latest-server.yml`), and the client agent uses the `latest-agent` channel (`latest-agent.yml`).
- **File Locking Solutions**: In commit `b38fad3`, code was added to stop the `NetCafeAgentWatchdog` service before installing to prevent "file in use" conflicts when overwriting the agent binary.
- **Unused, Disabled, or Superseded Parts**: Unified updater channels were superseded by segregated channels.
