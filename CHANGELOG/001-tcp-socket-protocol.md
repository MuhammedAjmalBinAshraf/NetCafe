# TCP Socket Protocol Implementation

## Description
The communication protocol between the NetCafe Server and NetCafe Agent is implemented over raw TCP sockets on port 9000 rather than the WebSockets protocol originally planned.

## Architecture & Implementation
- **Files**: `packages/server/electron/main.ts`, `packages/agent/electron/main.ts`
- **Network Protocol**: Raw TCP socket connection (default port 9000) using line-delimited (`\n`) JSON payloads.
- **Payloads**:
  - Client registration: `{ type: "register", payload: { name, mac_address, ip_address, uuid } }`
  - Server commands: lock, unlock, sync-session, poweroff, restart, block-inputs, update-blockrules.

## Current Status
**Fully working**. Raw TCP connections are stable, auto-reconnect every 5 seconds, and resolve VM cloning clashes.

## Evolution
- **First Implementation Differences**: The PRD originally specified a WebSocket protocol (using the `ws` library) for real-time LAN communication. This was replaced in commit `e1ab32f` with a raw line-delimited TCP socket protocol (on port 9000) using Node's native `net` module to minimize HTTP handshake overhead and simplify implementation for headless client background processes.
- **Unused, Disabled, or Superseded Parts**: The original WebSocket communication code was completely removed. Client terminal registration was later enhanced to uniquely identify devices using network MAC addresses (commit `f5e364a`) and client UUIDs (commit `35ca55c`) stored in `config.json` to prevent conflicts on cloned VM terminals.


