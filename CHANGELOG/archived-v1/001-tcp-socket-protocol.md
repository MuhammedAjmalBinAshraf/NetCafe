# TCP Socket Protocol Implementation

## What Was Implemented
The communication protocol between the NetCafe Server and NetCafe Agent was implemented over raw TCP sockets on port 9000 rather than the WebSockets protocol originally planned. 

- The client establishes a raw TCP socket connection via Node's native `net` module.
- Messages are transmitted as line-delimited (`\n`) JSON strings.
- Upon connection, the client sends a `register` message containing its MAC address, IP address, machine ID, and UUID.
- Retries are automatically scheduled every 5 seconds on connection loss, accompanied by safety unblocking of input devices.

## Why (Reasoning & Tradeoffs)
- **Lower Overhead**: Raw TCP sockets avoid the HTTP handshake and WebSocket framing protocol overhead, leading to faster throughput and less memory usage.
- **Simpler Headless Implementation**: Since the Client Agent runs as a background process with no UI window (tray-only or headless), using a standard TCP socket is more robust than running a full WebSocket library client.
- **Firewall Traversal**: It makes port forwarding and Windows Firewall exclusions simpler to configure as they deal with basic TCP rules rather than web sockets.

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
None (uses Node.js native `net` module).

## Evolution
- **First Implementation Differences**: The PRD originally specified a WebSocket protocol (using the `ws` library) for real-time LAN communication. This was replaced in commit `e1ab32f` with a raw line-delimited TCP socket protocol (on port 9000) using Node's native `net` module to minimize HTTP handshake overhead and simplify implementation for headless client background processes.
- **Unused, Disabled, or Superseded Parts**: The original WebSocket communication code was completely removed. Client terminal registration was later enhanced to uniquely identify devices using network MAC addresses (commit `f5e364a`) and client UUIDs (commit `35ca55c`) stored in `config.json` to prevent conflicts on cloned VM terminals.

