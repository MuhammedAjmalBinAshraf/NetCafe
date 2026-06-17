# Express Web Server & Remote SSH Tunnel

## What Was Implemented
The Server Application embeds a fully functional Express.js web server and a reverse SSH tunneling mechanism.

- **Express Server on Port 9001**: Starts a web server on port `9001` that statically hosts the compiled server dashboard React files (`packages/server/dist`) and exposes an `/api/ipc` endpoint.
- **IPC-to-HTTP Bridge**: The `/api/ipc` route maps incoming HTTP POST requests (carrying IPC channels and arguments) directly to Electron main process handlers, returning the results to the caller.
- **Public SSH Tunnel**: Spawns an SSH reverse tunnel using the system SSH executable to `nokey@localhost.run` mapping port `9001` to a public URL (e.g. `https://xxxx.lhr.life`).
- **Dynamic LAN Discovery**: Broadcaster starts a UDP socket broadcasting service coordinates (`tcp://[LAN_IP]:9000`) on port `9090` every 3 seconds.

## Why (Reasoning & Tradeoffs)
- **Mobile & Remote Control**: The Express server allows administrators to access the dashboard on their mobile phones, tablets, or remote laptops over the LAN. 
- **Internet Administration**: The reverse SSH tunnel enables operators to monitor and administer the lab securely from outside the local network (across the internet) without setting up static IPs, port forwarding, or VPNs.
- **IPC Bridge**: Enables non-Electron browsers (such as Safari on an iPad or Chrome on Android) to execute internal system commands (database edits, remote screenshots, terminal locks) by mapping HTTP requests directly to Electron IPC handlers.

## Database Tables & Config Files Added
None.

## NPM Dependencies Added
- `express` (in `packages/server`): Used to run the HTTP service and API bridge.

## Evolution
- **First Implementation Differences**: The Express server (port 9001) and localhost.run reverse SSH tunnel were introduced to support remote LAN and internet-based administration. The Express server exposes static files for browser-based dashboard access, bridging calls to Electron IPC handlers.
- **Unused, Disabled, or Superseded Parts**: None. The public reverse tunnel (`ssh -R 80:localhost:9001 nokey@localhost.run`) and Express server are fully active and run in the background upon server app startup.

