# Express Web Server & Remote SSH Tunnel

## Description
The server app embeds an Express HTTP server to serve the management dashboard and an API bridge, paired with a UDP broadcaster and a reverse SSH tunnel for LAN auto-discovery and WAN remote management.

## Architecture & Implementation
- **File Paths**: `packages/server/electron/main.ts`
- **HTTP Server**: Runs Express on port 9001. Exposes an `/api/ipc` route that bridges POST request payloads directly to Electron IPC handlers.
- **SSH Tunnel**: Spawns system SSH (`nokey@localhost.run -R 80:localhost:9001`) to map port 9001 to a public URL (e.g., `https://xxxx.lhr.life`).
- **LAN Discovery**: Broadcasts server IP (`tcp://[IP]:9000`) via UDP socket to port 9090 every 3 seconds.

## Current Status
**Fully working**. Both local LAN HTTP access and remote WAN SSH tunnels are operational, enabling mobile device dashboard control.

## Evolution
- **First Implementation Differences**: The Express server and localhost.run SSH tunnel were designed to enable remote management. 
- **Mobile Access**: Commit `10130d0` introduced mobile control settings, a QR code popup on the dashboard, and a browser IPC bridge polyfill to simplify terminal control from mobile browsers. Commit `5f4a1e0` added responsive mobile dashboard layouts.
- **Unused, Disabled, or Superseded Parts**: None.
