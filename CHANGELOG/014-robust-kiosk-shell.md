# 014 - Robust Kiosk Shell Self-Healing

## Overview
Re-architected the Windows registry shell replacement logic in the agent to resolve an edge case where the agent would permanently break the Kiosk shell and boot directly to a black screen or explorer desktop.

## Changes
- **Agent Shell Self-Healing**: The agent now synchronously verifies and repairs the `Winlogon\Shell` registry key during startup when running as the Kiosk user. This ensures that any previous crashes that broke the shell are automatically repaired on the next reboot.
- **Robust Shell Revert Hooks**: The registry shell restoration logic during desktop load (`spawnExplorerShell`) is now backed by a global `shellRestorePending` flag. If the agent crashes, is killed, or exits while the desktop shell is temporarily overridden to `explorer.exe`, the synchronous `cleanupProxySync()` exit hook will forcefully restore the Kiosk shell before the process terminates.
