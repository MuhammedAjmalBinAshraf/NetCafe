# Bandwidth Limiting Feature

## What Was Implemented
Implemented the ability to limit and throttle client network/internet bandwidth dynamically on demand from the admin server dashboard.

- The server can send a `limit-bandwidth` socket command carrying a target rate (e.g. `1mbit`, `500kbit`) or a `remove-bandwidth` command.
- The client agent resolves its default network interface and applies traffic shaping using the Linux `tc` (Traffic Control) tool via `child_process.exec`.
- Executes `tc qdisc del dev [interface] root` followed by `tc qdisc add dev [interface] root tbf rate [rate] burst 32kbit latency 400ms`.

## Why (Reasoning & Tradeoffs)
- **Fair Network Utilization**: Prevents individual users from downloading large files or running heavy bandwidth operations that degrade the network experience for other customers in the lab.
- **Dynamic Control**: The operator can throttle and unthrottle speeds in real time based on active sessions or plan tiers.
- **Tradeoff / Limit**: This is currently a **Linux-only** implementation (bypasses Windows and macOS platforms). Applying the same feature on Windows would require different tools (e.g. QoS policies or native driver wrappers).

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
None (uses native `child_process` execution of system binaries).

## Evolution
- **First Implementation Differences**: Bandwidth limiting has consistently relied on Linux `tc` commands (Traffic Control) to create and destroy token bucket filters (TBF) via child processes.
- **Unused, Disabled, or Superseded Parts**: This feature is **completely disabled and unused on Windows and macOS agents**. The codebase wraps the execution in `process.platform === 'linux'` checks. It remains a placeholder on Windows client terminals.

