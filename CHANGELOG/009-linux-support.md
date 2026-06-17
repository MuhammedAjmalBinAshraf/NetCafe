# Linux Support & Cross-Platform Configuration

## Description
NetCafe Manager is designed for cross-platform deployment, allowing both the server and client agent to run on Linux to reduce OS license overheads.

## Architecture & Implementation
- **File Paths**: Monorepo root configuration files, `packages/agent/electron/main.ts`
- **Builder targets**: Targets Debian packages (`.deb`) and portable `AppImage` formats via `electron-builder`.
- **Runtime Checks**: Platform gates (`process.platform === 'linux'` vs `win32`) route network commands (like `tc` traffic control) and bypass Windows-only registry, GPO, and task scheduler commands.

## Current Status
**Basic support (Partially working)**. The client runs, mirrors screen, and handles billing on Linux, but high-security lockouts (WMI shell, watchdog service, keyboard block input) are exclusive to Windows.

## Evolution
- **First Implementation Differences**: Linux targets were integrated in root monorepo layouts. Platform gates prevent code execution failures on Linux agents.
- **Unused, Disabled, or Superseded Parts**: High-security OS locks are Windows-only. The Linux agent lacks native shell replacement or block input commands, so it runs as a standard window overlay rather than a system-level locked shell.
