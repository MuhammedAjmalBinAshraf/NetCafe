# Linux Support & Cross-Platform Configuration

## What Was Implemented
The codebase has been designed to support packaging, deploying, and running both the NetCafe Server and the NetCafe Agent on Linux systems.

- **Cross-Platform Building**: Configured `electron-builder` in both package.json files to target Linux platforms, outputting `AppImage` and `deb` (Debian package) formats.
- **Conditional Code Execution**: Implements platform checks throughout the agent and server scripts:
  - Bandwidth throttling commands (`tc`) only run on Linux.
  - OS-level lockdowns (WMI Shell, NTUSER.DAT overrides, registry hooks) are wrapped in `process.platform === 'win32'` checks.
  - Non-Windows agents resolve to safe fallbacks (e.g. bypassing Windows Scheduled Tasks or fullscreen checks).

## Why (Reasoning & Tradeoffs)
- **Lower OS Licensing Cost**: Allowing client machines and servers to run on Linux (such as Ubuntu or Debian) saves significant costs on Windows licenses for internet cafes, schools, and computer labs.
- **Multi-OS Flexibility**: Enables hybrid environments where a Windows admin server can control Linux client terminals.
- **Tradeoff**: Kiosk lockdown features (like custom shell launcher and input blocking) are highly OS-specific and require independent implementations on Linux (e.g. using `xdotool`, custom X11/Wayland sessions, or PAM restrictions) which are not as fully built out as the Windows setup.

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
None.

## Evolution
- **First Implementation Differences**: Linux support was scaffolded in the monorepo root configurations, target package layouts (`AppImage`, `deb`), and platform checks. It has remained basic compared to the Windows environment.
- **Unused, Disabled, or Superseded Parts**: High-security OS locks (including custom registry hives, scheduled tasks, and GPO policies) are **Windows-only**. Bypassing Windows means the client agent fallback on Linux does not enforce standard shell replacement, watchdog service loops, or input blocking natively, rendering Linux support less hardened.

