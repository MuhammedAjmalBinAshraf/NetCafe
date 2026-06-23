# Exhaustive Electron Audit Report

This report consolidates the results of an isolated, file-by-file audit of all Source Electron files in `packages/agent/electron` and `packages/server/electron` (excluding `node_modules`, `dist`, and `dist-electron`). 

---

## 1. Master Feature Mapping Table

| Feature / Item | Found in Code (File & Line References) | Documented in PRD / Changelog | Status |
| :--- | :--- | :--- | :--- |
| **TCP Socket Server** | `packages/server/electron/main.ts` (Lines 161-169, 738-774, 813-816) | `PRD` §3, §4.4, §6; `CHANGELOG` 001 | Implemented |
| **TCP Socket Client & Reconnection** | `packages/agent/electron/main.ts` (Lines 895-1137, 1497-1600) | `PRD` §3, §4.4, §6; `CHANGELOG` 001 | Implemented |
| **better-sqlite3 Setup & Database Migrations** | `packages/server/electron/main.ts` (Lines 44-159) | `PRD` §1.3, §5, §6; `CHANGELOG` 011 | Implemented |
| **Kiosk Lock Screen Enforcement & Focus Loop** | `packages/agent/electron/main.ts` (Lines 132-152, 154-893) | `PRD` §2, §3, §4.4, §10; `CHANGELOG` 002 | Implemented |
| **Explorer Desktop Shell Manager (win32)** | `packages/agent/electron/main.ts` (Lines 939-949, 983-994, 1020-1024, 1578-1582, 2086-2090) | `PRD` §3, §4.4, §10; `CHANGELOG` 002 | Implemented (Windows-only) |
| **Dedicated Kiosk User (CafeKiosk) Configuration** | `packages/agent/electron/main.ts` (Lines 1986-2004, 2894-3135) | `PRD` §3, §4.4, §4.16, §10; `CHANGELOG` 003 | Implemented (Windows-only) |
| **Kiosk Watchdog Process / Service** | `packages/agent/electron/watchdog.ts` (Lines 8-34) | `PRD` §3, §4.4, §4.16, §8, §12; `CHANGELOG` 004 | Implemented (Windows-only) |
| **Bandwidth Throttling via Linux Traffic Control (`tc`)** | `packages/agent/electron/main.ts` (Lines 1051-1055, 1391-1432) | `PRD` §2, §4.10; `CHANGELOG` 005 | Implemented (Linux-only) |
| **Member Account Import (Excel/CSV)** | `packages/server/electron/main.ts` (Lines 1672-1726) | `PRD` §4.11; `CHANGELOG` 006 | Implemented |
| **Express HTTP IPC Bridge (LAN Mobile interface)** | `packages/server/electron/main.ts` (Lines 909-962) | `PRD` §3, §4.13, §6; `CHANGELOG` 007 | Implemented |
| **Public SSH Tunneling (`localhost.run`)** | `packages/server/electron/main.ts` (Lines 1007-1053) | `PRD` §2, §3, §4.13, §6; `CHANGELOG` 007 | Implemented |
| **Auto-Updater System (Server-Side)** | `packages/server/electron/main.ts` (Lines 1078-1128, 1912-1927) | `PRD` §2, §4.15, §6; `CHANGELOG` 008 | Implemented |
| **Auto-Updater System (Agent-Side)** | `packages/agent/electron/main.ts` (Lines 775-827, 2095-2142, 2145-2150) | `PRD` §2, §4.4, §4.15, §6; `CHANGELOG` 008 | Implemented |
| **Cross-Platform Linux Workarounds** | `packages/agent/electron/main.ts` (Lines 1297-1304, 2028-2037, 1345) | `PRD` §1.1, §10; `CHANGELOG` 009 | Implemented |
| **Installation and Execution Logging System** | `packages/server/electron/main.ts` (Lines 1116-1120); `packages/agent/electron/main.ts` (Lines 37-51, 63-76) | `PRD` §4.16; `CHANGELOG` 010 | Implemented |
| **AI Safety Filter (Google Gemini Evaluation)** | `packages/server/electron/main.ts` (Lines 486-558, 559-688) | `PRD` §2, §4.6, §12; `CHANGELOG` 012 | Implemented |
| **MITM HTTPS Proxy Interceptor** | `packages/agent/electron/mitm-proxy.ts` (Lines 126-474) | `PRD` §3, §4.4, §4.6; `CHANGELOG` 012 | Implemented |
| **Preload Script Generic IPC Bridge** | `packages/server/electron/preload.ts` (Lines 3-16, 18-22) | `PRD` §6, §7 | Implemented |
| **Hardware Input Blocking (Win32 user32.dll BlockInput)** | `packages/agent/electron/main.ts` (Lines 934-937, 977-981, 1104-1117, 1558-1565, 2076-2084) | `PRD` §2, §3, §4.5, §10 | Implemented (Windows-only) |
| **Dynamic Island Kiosk UI Overlay** | `packages/agent/electron/main.ts` (Lines 2302-2374, 2375-2892) | `PRD` §4.4, §4.6 | Implemented |
| **Active Window & Process Activity Tracking** | `packages/server/electron/main.ts` (Lines 345-385); `packages/agent/electron/main.ts` (Lines 1259-1331) | `PRD` §4.4, §4.7 | Implemented |

---

## 2. Platform-Specific Early Returns & OS Dependencies

### A. Windows (win32) Platform Dependencies
- **Watchdog Service (`packages/agent/electron/watchdog.ts`)**: Relies completely on Windows system utilities:
  - `tasklist` check for `"NetCafe Agent.exe"` (Line 12)
  - `query user` to check if `'cafekiosk'` user is active (Line 15)
  - `schtasks /run /tn "NetCafeAgent"` scheduled task run tool to restart the agent (Line 19)
- **Local Cert Store CA Injection (`packages/agent/electron/mitm-proxy.ts`)**: Invokes Windows-native root CA installation tools:
  - `certutil -addstore -f "Root"` (Line 225)
  - `certutil -user -addstore -f "Root"` (Line 231)
- **System Proxy & WinINet Activation (`packages/agent/electron/mitm-proxy.ts`)**: Directly reads and updates registry keys and triggers WinINet broadcasts:
  - Updates `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` to toggle proxy on/off (Lines 267-269, 276)
  - Broadcats changes via `rundll32.exe wininet.dll,InternetSetOption 39 0 0` (Lines 271, 277)
- **Hardware Lockout (`packages/agent/electron/main.ts`)**: Uses PowerShell scripts to invoke `BlockInput` from `user32.dll` WMI/API (Lines 934-937, 977-981, 1104-1117, 1558-1565, 2076-2084).
- **Windows Shell Registry Validation (`packages/agent/electron/main.ts`)**: Queries and alters Windows Logon shell registries under `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon /v Shell` via `execSync` (Lines 53-61, 1219-1227, 1230-1256).
- **Active Window Monitoring (`packages/agent/electron/main.ts`)**: Listens to foreground title updates using a dynamic compiled C# assembly running inside PowerShell (Lines 1287-1295, 1770-1930).
- **Windows Firewall Configuration (`packages/server/electron/main.ts`)**: Adds inbound LAN rules on ports 9000 & 9090 (`netsh advfirewall ...` lines 775-811). Checked via `process.platform === 'win32'` early return.
- **SSH Client Path (`packages/server/electron/main.ts`)**: Resolves binary executable location to `C:\\Windows\\System32\\OpenSSH\\ssh.exe` (Line 1020).

### B. Linux Platform Dependencies
- **Bandwidth Regulation (`packages/agent/electron/main.ts`)**: Regulates interface network speed using terminal commands `tc qdisc` (Lines 1051-1055, 1391-1432). Early return handles Windows where it becomes a no-op.
- **DNS Block Override (`packages/agent/electron/main.ts`)**: Redirection domains are written directly to `/etc/hosts` file (Line 1345).
- **Application Kill (`packages/agent/electron/main.ts`)**: Kills blocked binary executables using `pkill -f` (Lines 1383-1388).
- **Active Window Title (`packages/agent/electron/main.ts`)**: Retrieves foreground application name via Unix helper utility `xdotool getactivewindow getwindowname` (Lines 1297-1304).
- **Self-Escalation (`packages/agent/electron/main.ts`)**: Relaunches process using `pkexec` wrapper if starting as standard user instead of root (Lines 2028-2037).

### C. macOS (darwin) Platform Dependencies
- **Window Termination Guard (`packages/server/electron/main.ts`)**: Checks `if (process.platform !== 'darwin')` on window-all-closed event before calling `app.quit()` to match standard macOS close behavior (Lines 1137-1141).

---

## 3. Incomplete Features, Placeholders, & Mocked Logic

### A. Placeholders and Default Hardcoded Values
- **Agent Server Connection Details (`packages/agent/electron/main.ts`)**:
  - `serverUrl = '127.0.0.1:9000'` (Line 144)
  - `serverHost = '127.0.0.1'` (Line 145)
  - `serverPort = 9000` (Line 146)
- **Agent Default Operator PIN (`packages/agent/electron/main.ts`)**:
  - `operatorPassword = 'admin'` (Line 150)
- **Agent PIN validation Compatibility duplicate (`packages/agent/electron/main.ts`)**:
  - `const VALID_PINS = ['${operatorPassword}', '${operatorPassword}'];` (Lines 649-650)
- **Active Window Title Fallbacks (`packages/agent/electron/main.ts`)**:
  - `'System'` (Line 1291) / `'Desktop / Shell'` (Line 1299)
- **Default Network Interface (`packages/agent/electron/main.ts`)**:
  - Falls back to `eth0` if parsing system route commands fails (Lines 1395, 1402)
- **Default Screen Resolution bounds (`packages/agent/electron/main.ts`)**:
  - Defaults to `1920x1080` (Lines 1745, 2223)
- **Kiosk Windows Setup Password (`packages/agent/electron/main.ts`)**:
  - `net user CafeKiosk "CafeKiosk123!" ...` (Lines 2950, 2961)
- **Dynamic Island Overlay Placeholders (`packages/agent/electron/main.ts`)**:
  - Default guest name is `Walk-in` (Line 2711)
  - Default alert string is `Message placeholder` (Line 2730)
  - Default hourly rate in postpaid fallback mode is `5.0` (Line 2813)
- **Server Metrics Fallbacks (`packages/server/electron/main.ts`)**:
  - OS fallback `'Windows'` (Line 337), resolution bounds `1920x1080` (Line 340), application title `'Desktop'` (Line 349)
- **Server Default User Password (`packages/server/electron/main.ts`)**:
  - Password falls back to `'changeme'` during user import operations if undefined (Line 1715)

### B. Mocked Logic & Functional Fallbacks
- **Server LAN Mobile HTTP Bridge Mock Event (`packages/server/electron/main.ts`)**:
  - `const mockEvent = { sender: { send: () => {} } };` (Line 933) is instantiated to pass into IPC handler registrations so mobile browser actions mimicking IPC calls do not trigger context bridge exceptions.
- **Vite Web UI Fallback (`packages/server/electron/main.ts`)**:
  - Fallback text indicating API is alive but panel needs serving via Vite when loading dev build (Lines 952-955).
- **MitmProxy Fallback to Transparent Tunnel (`packages/agent/electron/mitm-proxy.ts`)**:
  - If dynamic SSL certificate generation fails, the proxy falls back to a transparent tunnel that continues browsing traffic but bypasses URL search query safety scanning (Lines 343-351).
- **MITM SSL Verification disabled (`packages/agent/electron/mitm-proxy.ts`)**:
  - Connects to upstream search engine servers using `rejectUnauthorized: false` (Line 362), disabling standard HTTPS validation rules.
- **MITM Fixed Buffer Size (`packages/agent/electron/mitm-proxy.ts`)**:
  - Reads only up to 2048 bytes of request data to extract query details (Line 370).
- **MITM Keep-Alive Inspection Bypass (`packages/agent/electron/mitm-proxy.ts`)**:
  - Resets the request buffer immediately after the first header line is processed (`reqBuffer = '';` Line 374). This allows subsequent HTTP requests in a keep-alive connection tunnel to skip safety evaluation entirely.
- **MITM Fails Open on Safety Check Failure (`packages/agent/electron/mitm-proxy.ts`)**:
  - Swallows callback execution errors and allows the search request query to proceed transparently (Lines 300-302, 400-402).

### C. TODO/FIXME Comments
- A thorough search verified that **no** comments containing `TODO` or `FIXME` exist in the audited codebase files.

---

## 4. Evidence File Paths and Line-by-Line References

### File 1: `packages/server/electron/preload.ts`
- **Exposed wrapper namespaces**: Lines 3-16 (on, off, send, invoke)
- **Window context bridge setup**: Lines 18-22

### File 2: `packages/agent/electron/watchdog.ts`
- **Task definitions**: Lines 8-9 (Exe Name: `'NetCafe Agent.exe'`, task: `'NetCafeAgent'`)
- **Process verification loop (`tasklist` & `query user`)**: Lines 12-27
- **Watchdog Interval scheduler (10 seconds)**: Line 33

### File 3: `packages/agent/electron/mitm-proxy.ts`
- **Connection Port setting**: Line 26 (`PROXY_PORT = 8889`)
- **Search Engine match Regex**: Lines 29-37
- **CA generation & filesystem save**: Lines 144-186 (`initCA`)
- **CA installer shell invocation**: Lines 220-263 (`installCA` using certutil)
- **System Proxy Toggle**: Lines 265-279 (modifies registry `Internet Settings\ProxyEnable`)
- **decryption & search query checking loops**: Lines 283-325 (`handleHttp`), Lines 327-429 (`handleConnect`)
- **Startup listener lifecycle**: Lines 433-473

### File 4: `packages/agent/electron/main.ts`
- **Got the Lock instance enforcement**: Lines 11-16
- **Logging logic**: Lines 37-51, 63-76
- **Kiosk overlay setup (`createLockWindow`)**: Lines 154-893
- **PowerShell hardware input Block (`BlockInput`)**: Lines 934-937, 977-981, 1104-1117
- **explorer.exe shell kill/start**: Lines 939-949, 983-994
- **Linux bandwidth limit queue config (`tc`)**: Lines 1391-1432
- **PowerShell Window metrics title hook compiler**: Lines 1770-1930
- **Kiosk installation setup parameters**: Lines 2894-3135

### File 5: `packages/server/electron/main.ts`
- **better-sqlite3 instance setup & ALTER commands**: Lines 44-159
- **Metrics logging and safety check**: Lines 330-454
- **Safety check Term lists & Gemini execution**: Lines 486-688
- **Port 9000 raw TCP socket server listener**: Lines 738-774
- **Firewall rule execution**: Lines 775-811
- **Port 9001 LAN Express HTTP API setup**: Lines 909-962
- **Port 9090 Service broadcast beacons**: Lines 976-1005
- **Public Tunneling loop**: Lines 1007-1053
- **Auto Update check & logging**: Lines 1078-1128
- **Core IPC Handle calls**: Lines 1059-1976
