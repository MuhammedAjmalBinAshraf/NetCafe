# Product Requirements Document — v2 (Authoritative)
## NetCafe Manager — v1.0 (Actual Implemented State)

> **Note**: This document supersedes `PRD-v1-archived.md`. It reflects the **actual implemented state** of the codebase, ensuring absolute correctness regarding schemas, libraries, protocols, ports, and lockdown mechanisms.

---

## 1. Overview

**Product Name:** NetCafe Manager  
**Type:** Desktop + kiosk application (Windows-primary, Linux-partial)  
**Architecture:** Electron + React (Admin Server App) + Electron (Kiosk Client Agent) + TCP socket server  
**Database:** SQLite via `better-sqlite3` (local, fully offline, synchronous)  
**Inspired by:** iCafé Manager, PanCafé, Antamedia Internet Caffe  

NetCafe Manager is a centralized computer lab and internet café management system. An **Admin Server App** (Electron + React) runs on the operator's PC and controls all client machines over a LAN TCP socket. A **Client Agent** (Electron) runs on each client machine as the system shell for a restricted local user (`CafeKiosk` or customized via `kiosk.ini`), replacing `explorer.exe` to enforce an absolute kiosk lockdown until the admin opens a session.

---

## 2. Goals

- Full session lifecycle management: open, pause, extend, close
- Time-based billing (prepaid & postpaid), member login support
- Real-time monitoring of all client machines from a single dashboard
- Remote control: lock/unlock, message, screenshot, shutdown/restart, hardware input block
- Bandwidth throttling per machine (Linux-only)
- AI-powered safety filter (Google Gemini) for search query interception
- Website and application blocking on client machines (hosts file + MITM proxy)
- Sales, revenue, and usage reporting; CSV/Excel export and import
- Lightweight client agent that shows lock screen immediately at boot
- Zero-touch auto-update for both server and agent

---

## 3. Architecture

```
[Admin PC]
  └── NetCafe Server App (Electron 28+ + React 18 + Express + better-sqlite3)
        ├── TCP Socket Server (port 9000) — accepts raw line-delimited JSON from agents
        ├── Express Web Server (port 9001) — browser dashboard + IPC-to-HTTP bridge
        ├── UDP Broadcast (port 9090) — LAN service discovery every 3s
        ├── SSH Reverse Tunnel → localhost.run (public URL for remote access)
        └── Admin Dashboard React UI (served via Electron BrowserWindow or port 9001 browser)

[Client PC 1..N]
  └── NetCafe Agent (Electron, runs as CafeKiosk shell replacement)
        ├── TCP socket client → connects to server on port 9000
        ├── Full-screen lock window (BrowserWindow, alwaysOnTop, no frame, kiosk)
        ├── MITM HTTPS Proxy (port 8889) — intercepts search queries for AI safety filter
        ├── Win32 BlockInput — blocks physical keyboard/mouse on lock
        └── Reports: hostname, IP, MAC, CPU, RAM, active window, screenshot frame

[Windows Kiosk Layer — CafeKiosk account]
  ├── Shell replacement: explorer.exe → NetCafe Agent.exe (WESL_UserSetting / NTUSER.DAT)
  ├── Auto-logon: HKLM Winlogon registry keys (AutoAdminLogon=1)
  ├── Windows Task Scheduler task: NetCafeAgent (on logon, highest privileges)
  ├── Windows Service: NetCafeAgentWatchdog (node-windows, SYSTEM account, restarts agent)
  └── GPO lockdown: block Task Manager, registry editor, command prompt, control panel

[Installer — NSIS + PowerShell]
  └── kiosk-setup.ps1 / kiosk-uninstall.ps1 — automates all of the above
       ├── Creates/configures CafeKiosk local user account (customizable via kiosk.ini)
       ├── Enables Client-EmbeddedShellLauncher (DISM)
       ├── Registers shell via WMI WESL_UserSetting or NTUSER.DAT hive injection
       ├── Installs watchdog service and scheduled task
       └── Applies GPO lockdown registry policies
```

---

## 4. Modules & Features

### 4.1 Dashboard (Admin)
- Grid/list/small/large/grouped view modes of all connected client machines
- Color-coded status cards: Available (green), In Use (blue), Paused (amber), Offline (gray)
- Live countdown timer per machine (prepaid) or elapsed timer (postpaid)
- Per-machine quick-action buttons: Open Session, Pause, Extend, Close, **Lock Screen**, Message, Restart, Shutdown
- Real-time live screen mirror (full-resolution or fullscreen viewport) per machine
- Remote input control: forward mouse clicks, drags, and keystrokes to client
- Remote CMD shell console (execute system commands on client from server dashboard)
- Global actions: Lock All, Message All, Shutdown All
- Developer System Log Console (collapsible, live server-side events)
- Reload button to refresh all client machine metrics and database cleanup

### 4.2 Session Management
- **Open Session**: select machine → enter customer name or member login → select plan or custom duration → start
- **Postpaid mode**: timer counts up; charge calculated on close
- **Prepaid mode**: customer pays first; timer counts down; auto-locks when timer hits zero
- **Member (User) Login**: member logs in via `username + password` on the kiosk lockscreen; session balance drawn from `users.balance_minutes`
- **Extend session**: add time to an active or paused session
- **Pause session**: freeze timer; re-lock the screen; session is resumable
- **Resume session**: unlock machine; resume timer
- **Close/End session**: generate receipt, record discount, payment method, mark session `completed`

### 4.3 Billing & Pricing Plans
- Create unlimited pricing plans: name, rate type (`per_hour` / `per_minute` / `flat`), price, optional duration
- Apply discount at session close
- Payment methods: Cash, UPI (recorded manually)
- Billing calculation: handled server-side, elapsed seconds from `start_time` minus `paused_duration`

### 4.4 Client Agent (Kiosk Shell)
- Runs as a replacement for `explorer.exe` under the `CafeKiosk` restricted user account
- No visible window during lock; shows fullscreen `BrowserWindow` lock screen (`alwaysOnTop`, `kiosk: true`, no frame)
- Lock screen shows: lab name, machine name, operator message, and member login form
- Lock screen shows: agent version, live agent log overlay panel, and manual update button
- Lock screen has a **Shutdown** button for operator emergency power-off
- On session open: unlock window, start MITM proxy, apply blocking rules, spawn `explorer.exe`
- On session close/pause: re-lock screen, kill Explorer if running, apply Win32 `BlockInput`
- Manages an HTTPS MITM proxy (port 8889): auto-generates self-signed CA, installs it to Windows Trusted Root store, configures Firefox enterprise policy
- Intercepts Google, Bing, YouTube, Yahoo, DuckDuckGo, Baidu, Yandex search queries and sends to server for safety evaluation
- If violation detected: shows Dynamic Island warning (1st offence) or locks screen (2nd+ offence)
- Reports every 10 seconds: hostname, IP, MAC, UUID, CPU %, RAM %, uptime, active window title, screenshot frame, process start/stop changes
- Spawns `explorer.exe` on unlock and kills it on lock for normal windowed experience between sessions
- On disconnect from server: stays locked; retries connection every 5 seconds

### 4.5 Real-time Screen Mirroring & Remote Input
- Agent captures a JPEG screenshot frame every 800ms and sends via TCP stream (ultra-resolution 2560x1440 supported in fullscreen mode)
- Server renders live mirror in a resizable panel or fullscreen viewport on the dashboard
- Mouse events (click, drag) are scaled to the client resolution and sent as `remote-input` commands
- Keyboard events are captured and forwarded as `remote-keyboard` commands
- Remote CMD shell: operator types commands; agent executes via `child_process` and streams output back
- Hardware Input Lock: server sends `block-input` / `unblock-input` commands; agent calls Win32 `BlockInput(true/false)`

### 4.6 AI Safety Filter
- Embedded MITM HTTPS proxy (port 8889) captures search queries in transit
- Server evaluates query via Google Gemini 2.5 Flash API
- Response classification: `block` / `allow` / `warn`
- Violation cascade: 1st = Dynamic Island warning overlay; 2nd+ = screen lock + safety alert record
- Safety settings configurable from Dashboard:
  - Enable/Disable AI filter toggle
  - Gemini API key configuration
  - Safety categories: pornography, violence, self-harm, illegal acts/hacking
  - Custom keyword blocklist (instant match, no API required)
  - Custom AI system context (injected into every Gemini prompt)
- Safety Alerts tab: view all triggered alerts per machine; clear all button

### 4.7 Remote Monitoring
- Live screenshot/mirror (800ms frame capture via agent, rendered on server)
- System info panel per machine: IP, MAC, OS, CPU %, RAM %, uptime, active window
- Session App Logs: per-session records of which application titles were focused and for how long (`session_app_logs`)
- Process Events: per-machine records of process start/stop events (`session_process_events`)

### 4.8 Remote Control
- Send text message popup to one or all clients (rendered as an overlay on the kiosk lock screen)
- **Lock Screen**: directly send lock command to a specific machine (`lock-machine`)
- Lock all machines simultaneously (`lock-all`)
- Restart or shutdown machines remotely
- Hardware input block (keyboard/mouse) per machine

### 4.9 Website & App Blocking
- Blocklist management: add/remove domains (e.g., `facebook.com`) or executable names (e.g., `steam.exe`)
- Mode per rule: `block` (kills process or denies domain) / `allow` (allowlist mode)
- Toggle rules active/inactive without deleting
- Rules broadcast to all connected agents at the start of each session
- MITM proxy enforcement (real-time search query interception) complements traditional hosts file approach

### 4.10 Bandwidth Limiting *(Linux agents only)*
- Operator can set a speed limit per machine (e.g., `2mbit`, `500kbit`)
- Agent applies Linux `tc` (Traffic Control) queueing rules via `child_process.exec`
- `remove-bandwidth` command tears down the `tc` qdisc rule
- **Note**: This feature is a no-op on Windows agents (platform check: `process.platform === 'linux'`)

### 4.11 Users (Member Accounts)
- Create, edit, delete member accounts (`username`, `password`, `display_name`, `phone`, `email`, `balance_minutes`)
- Top-up balance minutes individually or in bulk
- Bulk create from CSV text area or Excel `.xlsx` file upload
- Download Excel import template
- Multi-select checkboxes for batch operations (delete, top-up)
- Password show/hide toggle in member management UI
- Members can log in to start a session directly from the kiosk lock screen

### 4.12 Reports & Analytics
- Today's summary: total sessions, total revenue, average duration
- Per-machine usage: session count and total revenue
- Session history table with filterable date range
- Export session history to CSV

### 4.13 Settings
- Lab name (displayed on lock screen and receipts)
- AI Safety Filter configuration (see §4.6)
- Mobile Remote Control:
  - LAN URL: `http://[server-ip]:9001`
  - Public internet URL: auto-generated `localhost.run` SSH tunnel
  - QR code popup for instant mobile access
- Database Utilities:
  - **Backup Database**: opens native Windows Save File dialog → copies `netcafe.db` to selected path
  - **Restore Database**: opens native Windows Open File dialog → overwrites `netcafe.db`, re-initializes DB
- Account & Security:
  - Change admin username (requires current password confirmation)
  - Change admin password
  - Change operator override PIN (broadcast to all connected agents)
- App version badge (server and agent)

### 4.14 Staff / Operator Management
- Admin account (full access, all settings)
- Operator account (open/close sessions, no settings/reports access)
- Login screen at server app launch
- Operator override PIN sent to all client agents; clients prompt for PIN before entering operator configuration mode

### 4.15 Auto-Update
- Both server and agent use `electron-updater` connected to GitHub Releases (`MuhammedAjmalBinAshraf/NetCafe`)
- **Server**: manual/interactive update — shows dialog on available update; admin chooses to install or defer
- **Agent**: fully automatic — checks hourly; downloads silently; triggers `quitAndInstall` with 3-second delay
- **Channel segregation**: Server reads `latest-server.yml`; Agent reads `latest-agent.yml` — prevents cross-package collisions

### 4.16 Kiosk Setup Installer
- NSIS-based installer for the agent (`.exe`)
- Bundles `kiosk-setup.ps1` and `kiosk-uninstall.ps1` as extra resources
- On first run, PowerShell setup script performs:
  1. Creates local `CafeKiosk` user (or uses config from `kiosk.ini`)
  2. Enables `Client-EmbeddedShellLauncher` Windows feature (DISM)
  3. Registers shell via `WESL_UserSetting` WMI or NTUSER.DAT registry hive injection
  4. Sets Auto-Logon registry keys (`HKLM\Winlogon`)
  5. Installs `NetCafeAgentWatchdog` Windows Service via `node-windows`
  6. Creates `NetCafeAgent` Task Scheduler task (triggered on logon, highest privileges)
  7. Applies GPO lockdown policies via registry (blocks Task Manager, CMD, etc.)
  8. Writes `C:\NetCafe\installed.flag` on success
- All setup/uninstall events timestamped and logged to `C:\NetCafeKiosk_Setup.log` / `NetCafeKiosk_Uninstall.log`
- NSIS installer streams PowerShell output live to the installer detail page

---

## 5. Data Models (SQLite — `better-sqlite3`)

### machines
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| name | TEXT | e.g. "PC-01" |
| mac_address | TEXT UNIQUE | Network MAC; prevents duplicates on cloned VMs |
| uuid | TEXT | Persistent UUID from agent `config.json` (partial unique index) |
| ip_address | TEXT | Client IP address |
| status | TEXT | `available` / `in_use` / `paused` / `offline` |
| hardware_locked | INTEGER | Win32 BlockInput state (1 = locked, 0 = unlocked) |
| violation_count | INTEGER | AI safety violation counter (progressive enforcement) |
| notes | TEXT | |

### sessions
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| machine_id | INTEGER | Foreign key references machines |
| customer_name | TEXT | Guest name or member username |
| plan_id | INTEGER | Foreign key references plans |
| start_time | DATETIME | Session start |
| end_time | DATETIME | Null while active |
| paused_duration | INTEGER | Total seconds paused |
| custom_duration | INTEGER | Minute duration override (for fixed-time plans) |
| total_amount | REAL | |
| discount | REAL | Amount discounted at checkout |
| payment_method | TEXT | `Cash` / `UPI` |
| mode | TEXT | `prepaid` / `postpaid` |
| status | TEXT | `active` / `paused` / `completed` |

### plans
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| name | TEXT | e.g. "Standard – ₹20/hr" |
| rate_type | TEXT | `per_hour` / `per_minute` / `flat` |
| price | REAL | Hourly rate or flat price |
| duration_minutes | INTEGER | Flat-rate duration |

### users (Member Accounts)
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| username | TEXT UNIQUE | Account login |
| password | TEXT | Plaintext password |
| display_name | TEXT | |
| phone | TEXT | |
| email | TEXT | |
| balance_minutes | INTEGER | Prepaid time balance |
| created_at | DATETIME | Account creation timestamp |

### block_rules
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| type | TEXT | `domain` / `executable` |
| value | TEXT | e.g. "facebook.com" or "steam.exe" |
| mode | TEXT | `block` / `allow` |
| is_active | BOOLEAN | (1 = active, 0 = inactive) |

### staff
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| username | TEXT UNIQUE | |
| password_hash | TEXT | Plaintext password (column name is historical) |
| role | TEXT | `admin` / `operator` |

### settings (Key-Value Store)
| Key | Description |
|---|---|
| `lab_name` | Display name shown on lock screen |
| `operator_password` | Operator override PIN (synced to all agents) |
| `ai_safety_enabled` | `true` / `false` |
| `gemini_api_key` | Gemini 2.5 Flash API key |
| `filter_porn`, `filter_violence`, `filter_self_harm`, `filter_illegal` | Category filter flags (`true` / `false`) |
| `custom_filter_terms` | JSON array of instant-match blocked keywords |
| `ai_custom_context` | Custom instructions injected into Gemini prompts |

### session_app_logs
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| session_id | INTEGER | Foreign key references sessions |
| app_title | TEXT | Focused window title |
| duration_seconds | INTEGER | Total seconds active |
| focus_count | INTEGER | Total window focus entries |
| first_seen | DATETIME | |
| last_seen | DATETIME | |

### session_process_events
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| session_id | INTEGER | Foreign key references sessions |
| machine_id | INTEGER | Client machine reference |
| event_type | TEXT | `started` / `closed` |
| process_name | TEXT | Name of process (e.g. chrome.exe) |
| timestamp | TEXT | ISO timestamp |

### safety_alerts
| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-incremented |
| machine_id | INTEGER | Client machine reference |
| query | TEXT | Intercepted search query |
| reason | TEXT | Violation categorization |
| user_details | TEXT | Active user username / Guest |
| timestamp | DATETIME | Default: CURRENT_TIMESTAMP |

---

## 6. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Admin App shell | Electron 28+ | Main process + IPC + native dialogs |
| Admin UI | React 18 + Vite | TypeScript, HMR in dev |
| UI Component lib | shadcn/ui + Tailwind CSS | |
| Admin backend | Express.js (port 9001) | Embedded in Electron main process |
| LAN comms | Raw TCP sockets (Node `net` module, port 9000) | Line-delimited JSON; replaced WebSocket |
| LAN discovery | UDP broadcast (port 9090) | Server announces itself every 3s |
| Public tunnel | SSH reverse tunnel → localhost.run | Maps port 9001 → public HTTPS URL |
| Database | better-sqlite3 | Synchronous SQLite; no sql.js/async overhead |
| Client Agent shell | Electron (lock screen BrowserWindow) | No tray; runs as OS shell replacement |
| Auto-start (client) | Windows Task Scheduler task (`NetCafeAgent`) | Replaces node-auto-launch |
| Kiosk lockdown | Windows Shell Launcher (WESL_UserSetting / NTUSER.DAT) | Replaces explorer.exe for CafeKiosk user |
| Watchdog | node-windows Windows Service (`NetCafeAgentWatchdog`) | SYSTEM account; relaunches agent if killed |
| MITM Proxy | Node.js `http`/`https`/`tls` server + self-signed CA | Port 8889; intercepts search queries |
| Screenshot capture | Electron `desktopCapturer` | Captures JPEG frames every 800ms |
| Hardware input block | Win32 `BlockInput` via PowerShell | Blocks physical mouse/keyboard |
| Excel import/export | xlsx npm package | User bulk import; template download |
| Auto-update | electron-updater (GitHub Releases) | Channel-segregated: server / agent |
| Installer (client) | NSIS + PowerShell scripts | Bundles `kiosk-setup.ps1` / `kiosk-uninstall.ps1` |
| Installer (server) | electron-builder NSIS | Standard installer for admin app |
| Packaging (Windows) | electron-builder → `.exe` (NSIS) | |
| Packaging (Linux) | electron-builder → `AppImage` + `.deb` | Partial support; lockdown features not available |
| CI/CD | GitHub Actions | Builds and publishes on version tags |

---

## 7. Project Folder Structure

```
netcafe-manager/
├── packages/
│   ├── server/                     # Admin Server Electron App
│   │   ├── electron/
│   │   │   ├── main.ts             # Main process, TCP server, Express, IPC handlers
│   │   │   └── preload.ts          # Context bridge (ipcRenderer.invoke passthrough)
│   │   ├── src/                    # React UI (all in App.tsx)
│   │   │   └── App.tsx             # Dashboard, sessions, plans, blocking, users, settings
│   │   └── package.json
│   │
│   └── agent/                      # Client Agent Electron App
│       ├── electron/
│       │   ├── main.ts             # Lock screen, TCP client, MITM proxy, watchdog setup
│       │   └── watchdog.ts         # Windows Service loop (restarts agent if killed)
│       └── package.json
│
├── landing-website/                # Static marketing website (separate)
├── CHANGELOG/
│   ├── README.md                   # Next changelog placeholder
│   └── archived-v1/               # Feature changelogs from v1 development
├── PRD.md                          # This document (authoritative, current)
├── PRD-v1-archived.md              # Original planning document (preserved)
├── package.json                    # Monorepo root (npm workspaces)
└── .github/workflows/              # GitHub Actions CI/CD
    ├── build-server.yml
    └── build-agent.yml
```

---

## 8. Non-Functional Requirements

- **Offline first**: entire system works with no internet (LAN only); public tunnel and AI filter are optional
- **Boot time**: client agent lock screen appears immediately on CafeKiosk auto-logon (Task Scheduler on logon trigger)
- **Scalability**: handles 60+ simultaneous client connections over LAN TCP
- **Security**:
  - Admin app is password-protected (staff table plain-text comparison)
  - Client agent runs as the OS shell — cannot be closed by the restricted user
  - Win32 `BlockInput` prevents hardware bypass during lockdown
  - `NetCafeAgentWatchdog` SYSTEM service relaunches agent if killed
  - GPO lockdown disables Task Manager, registry editor, CMD, control panel for CafeKiosk user
- **Resilience**: if server goes offline, client stays locked; retries connection every 5 seconds
- **Persistence**: all session data in SQLite; no data loss on app restart; database backup/restore via native file dialog

---

## 9. Removed / Obsolete Design Decisions

The following design decisions from the original PRD (`PRD-v1-archived.md`) were **reversed or abandoned** during implementation:

| Original Plan | Actual Implementation | Reason |
|---|---|---|
| WebSocket (`ws` library) for LAN comms | Raw TCP sockets (Node `net`) | Lower overhead, no HTTP handshake, simpler headless client |
| `node-auto-launch` for client auto-start | Windows Task Scheduler task (`NetCafeAgent`) | Elevated privileges required at logon; auto-launch library insufficient |
| Hosts file manipulation for site blocking | MITM HTTPS proxy + CA injection | Hosts file doesn't intercept HTTPS; MITM catches all search queries in flight |
| `sql.js` (browser SQLite) | `better-sqlite3` | Synchronous API; proper filesystem DB; required for Electron main process |
| WebSocket section in `ws-server.ts` (planned) | TCP server in `main.ts` (single file) | Simplified architecture; no separate file needed |
| `get-operator-password` IPC handler | **Removed** | Retrieving plaintext passwords in UI is insecure; only `set-operator-password` is needed |
| `writeInstallLog` function in agent | **Removed** | Never called; PowerShell setup scripts handle all install-phase logging |

---

## 10. Platform Support Matrix

| Feature | Windows | Linux |
|---|---|---|
| TCP socket server/client | ✅ | ✅ |
| Lock screen (Electron BrowserWindow) | ✅ | ✅ |
| Shell replacement (explorer.exe → agent) | ✅ Win32 only | ❌ Not implemented |
| Auto-logon registry | ✅ Win32 only | ❌ Not applicable |
| Watchdog Windows Service (node-windows) | ✅ Win32 only | ❌ Not applicable |
| Task Scheduler auto-start | ✅ Win32 only | ❌ Not implemented |
| GPO lockdown policies | ✅ Win32 only | ❌ Not applicable |
| Win32 BlockInput (hardware lock) | ✅ Win32 only | ❌ Not implemented |
| MITM HTTPS proxy + CA injection | ✅ | ✅ (partial) |
| Bandwidth limiting | ❌ No-op | ✅ Linux `tc` |
| Auto-update (electron-updater) | ✅ | ✅ |
| Screenshot capture | ✅ | ✅ |

---

## 11. Out of Scope for v1

- Online/cloud sync or multi-branch support
- Mobile admin app (native iOS/Android)
- CCTV integration
- Fingerprint / RFID login
- Automated website categorization (parental controls beyond Gemini filter)
- Windows QoS-based bandwidth throttling (Linux `tc` is the only current implementation)
- Custom Linux kiosk lockdown (shell replacement, watchdog)

---

## 12. Success Criteria for v1

- [x] Admin can see all machines in real-time on dashboard
- [x] Admin can open, pause, extend, and close sessions
- [x] Client machines lock/unlock in response to admin commands
- [x] Billing correctly calculates time-based charges (prepaid and postpaid)
- [x] Members can log in from the kiosk lock screen using stored balance
- [x] AI safety filter intercepts and evaluates search queries in real time
- [x] Admin can remotely view live screen mirror and control mouse/keyboard
- [x] Admin can send OS commands via remote CMD shell console
- [x] Reports show today's revenue, session count, and usage per machine
- [x] Client agent auto-starts at Windows boot as kiosk shell (cannot be killed by standard user)
- [x] Watchdog service relaunches agent if terminated
- [x] Installer (`.exe`) automates all OS-level kiosk configuration
- [x] Both server and agent auto-update via GitHub Releases
- [x] Admin can backup and restore the SQLite database using native file dialogs
- [x] Admin can bulk-import member accounts from CSV or Excel
