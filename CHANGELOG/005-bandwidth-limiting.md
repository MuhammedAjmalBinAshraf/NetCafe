# Bandwidth Limiting Feature

## Description
Dynamic bandwidth throttling allows the administrator to throttle individual client network interfaces to fair rates (e.g., 2mbit, 512kbit) from the server dashboard.

## Architecture & Implementation
- **File Paths**: `packages/server/electron/main.ts`, `packages/agent/electron/main.ts`
- **Mechanism**: The server sends a TCP socket command `limit-bandwidth` or `remove-bandwidth`.
- **System Execution**: The client resolves the active network interface and uses Linux Traffic Control (`tc`) commands:
  - `tc qdisc del dev [interface] root`
  - `tc qdisc add dev [interface] root tbf rate [rate] burst 32kbit latency 400ms`

## Current Status
**Partially working** (Linux client terminals only). It acts as a silent no-op on Windows and macOS agents due to platform checks (`process.platform === 'linux'`).

## Evolution
- **First Implementation Differences**: Bandwidth limiting has consistently relied on Linux `tc` commands (Traffic Control) to create and destroy token bucket filters (TBF) via child processes.
- **Unused, Disabled, or Superseded Parts**: This feature is completely disabled and unused on Windows and macOS agents. The codebase wraps the execution in platform checks, leaving it as a placeholder for Windows client terminals.
