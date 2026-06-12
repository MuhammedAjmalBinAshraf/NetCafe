# Product Requirements Document
## NetCafe Manager — v1.0

---

## 1. Overview

**Product Name:** NetCafe Manager  
**Type:** Desktop application (Windows-first)  
**Architecture:** Electron + React (Admin Server App) + lightweight Node.js Client Agent  
**Database:** SQLite (local, fully offline)  
**Inspired by:** iCafé Manager, PanCafé, Antamedia Internet Caffe  

NetCafe Manager is a centralized computer lab / internet café management system. An **Admin App** runs on the operator's PC and controls all client machines on the same LAN. A **Client Agent** runs silently on every client machine, auto-starting at Windows boot, locking the screen until the admin opens a session.

---

## 2. Goals

- Full session lifecycle management: open, pause, extend, close
- Time-based billing (prepaid & postpaid)
- Real-time monitoring of all client machines from one dashboard
- Remote control: lock/unlock, message, screenshot, shutdown/restart
- Website and application blocking on client machines
- Sales, revenue, and usage reporting
- Lightweight client agent that starts in under 3 seconds at boot

---

## 3. Architecture

```
[Admin PC]
  └── NetCafe Manager Server App (Electron + React + Express + SQLite)
        ├── LAN WebSocket server (port 9000)
        └── Admin Dashboard UI

[Client PC 1..N]
  └── NetCafe Agent (Node.js + Electron, auto-start via Windows registry)
        ├── Connects to server via WebSocket (LAN IP)
        ├── Locks screen until session opened by admin
        └── Enforces blocking rules sent by server
```

---

## 4. Modules & Features

### 4.1 Dashboard (Admin)
- Grid view of all connected client machines (PC name, status, time remaining, user)
- Color-coded status: Available (green), In Use (blue), Paused (yellow), Offline (gray)
- Live countdown timer per machine
- Quick-action buttons per machine: Open Session, Pause, Extend, Close, Lock, Message, Screenshot, Restart, Shutdown
- Global actions: Lock All, Unlock All, Message All, Shutdown All

### 4.2 Session Management
- Open session: select machine → enter customer name (optional) → select plan or custom duration → start
- Postpaid mode: start session, timer counts up, charge on close
- Prepaid mode: customer pays first, select duration, timer counts down, auto-locks at zero
- Extend session: add more time to running session
- Pause session: freeze timer (e.g. customer takes a break)
- Close/end session: generate receipt, record payment

### 4.3 Billing & Pricing Plans
- Create unlimited pricing plans: name, rate type (per hour / per minute / flat), price
- Example: "Standard – ₹20/hour", "Night Pack – ₹50/3hrs", "Student – ₹15/hour"
- Apply discount or custom amount at session close
- Payment methods: Cash, UPI (recorded manually)
- Receipt preview and print

### 4.4 Client Agent (installed on every client PC)
- Silent background process, no visible window during lockscreen
- Auto-starts at Windows boot via registry key
- Shows lock screen overlay (full-screen, topmost, cannot be minimized or Alt+F4'd)
- Lock screen shows: lab name, machine number, "Please contact the operator"
- On session open: unlock, start allowed apps/browser
- On session close: lock screen again immediately
- Receives commands from admin server over LAN WebSocket
- Reports: machine name, OS, IP, CPU usage, RAM usage every 10 seconds

### 4.5 Remote Monitoring
- Live screenshot of any client machine (captured by agent, sent to server)
- System info panel: IP, OS version, CPU %, RAM %, uptime
- Active window / process name (what the user has open)

### 4.6 Remote Control
- Send text message popup to one or all clients
- Lock / unlock specific machines
- Restart or shutdown machines remotely
- Log off Windows user session on client

### 4.7 Website & App Blocking
- Blocklist management: add/remove domains (e.g. facebook.com, youtube.com)
- Allowlist management: whitelist specific sites only (strict mode)
- Enforcement: agent modifies Windows hosts file OR uses a local proxy (configurable)
- Block specific executable names (e.g. Steam.exe, discord.exe)
- Rules apply per-session or globally; admin can toggle in real-time

### 4.8 Inventory / Shop (optional in v1, scaffold only)
- Sell items (drinks, snacks, printing) tied to a session
- Adds to session bill at close

### 4.9 User / Staff Management
- Admin account (full access, password protected)
- Operator account (can open/close sessions, no access to settings/reports)
- Login screen at server app launch

### 4.10 Reports & Analytics
- Today's summary: sessions count, total revenue, average duration
- Date-range reports: revenue by day/week/month
- Per-machine usage report
- Export to CSV

### 4.11 Settings
- Lab name, operator name, logo (shown on lock screen and receipts)
- Server IP / port configuration
- Auto-start client agent installer path
- Backup & restore SQLite database

---

## 5. Data Models (SQLite)

### machines
| Field | Type |
|---|---|
| id | INTEGER PK |
| name | TEXT (e.g. "PC-01") |
| mac_address | TEXT UNIQUE |
| ip_address | TEXT |
| status | TEXT (available/in_use/paused/offline) |
| notes | TEXT |

### sessions
| Field | Type |
|---|---|
| id | INTEGER PK |
| machine_id | INTEGER FK |
| customer_name | TEXT |
| plan_id | INTEGER FK |
| start_time | DATETIME |
| end_time | DATETIME |
| paused_duration | INTEGER (seconds) |
| total_amount | REAL |
| payment_method | TEXT |
| mode | TEXT (prepaid/postpaid) |
| status | TEXT (active/closed/paused) |

### plans
| Field | Type |
|---|---|
| id | INTEGER PK |
| name | TEXT |
| rate_type | TEXT (per_hour/per_minute/flat) |
| price | REAL |
| duration_minutes | INTEGER (null if per_hour/minute) |

### block_rules
| Field | Type |
|---|---|
| id | INTEGER PK |
| type | TEXT (domain/executable) |
| value | TEXT |
| mode | TEXT (block/allow) |
| is_active | BOOLEAN |

### staff
| Field | Type |
|---|---|
| id | INTEGER PK |
| username | TEXT |
| password_hash | TEXT |
| role | TEXT (admin/operator) |

---

## 6. Tech Stack

| Layer | Technology |
|---|---|
| Admin App shell | Electron 28+ |
| Admin UI | React 18 + Vite |
| UI Component lib | shadcn/ui + Tailwind CSS |
| Admin backend | Express.js (embedded in Electron main process) |
| Real-time comms | WebSocket (ws library) |
| Database | better-sqlite3 (synchronous, embedded) |
| Client Agent shell | Electron (no UI window, tray icon only) |
| Client lock screen | Electron BrowserWindow (fullscreen, alwaysOnTop, no frame) |
| Auto-start (client) | Windows Registry via `node-auto-launch` |
| Screenshot capture | `screenshot-desktop` npm package |
| Website blocking | Hosts file manipulation (requires agent run as admin) |
| Packaging | electron-builder (produces .exe installer) |

---

## 7. Project Folder Structure

```
netcafe-manager/
├── packages/
│   ├── server/                  # Admin Server Electron App
│   │   ├── electron/
│   │   │   ├── main.ts          # Electron main process
│   │   │   ├── ipc.ts           # IPC handlers
│   │   │   └── ws-server.ts     # WebSocket server for clients
│   │   ├── src/                 # React UI
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Sessions.tsx
│   │   │   │   ├── Plans.tsx
│   │   │   │   ├── Blocking.tsx
│   │   │   │   ├── Reports.tsx
│   │   │   │   └── Settings.tsx
│   │   │   └── components/
│   │   │       ├── MachineCard.tsx
│   │   │       ├── SessionDialog.tsx
│   │   │       └── ReceiptModal.tsx
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   └── queries.ts
│   │   └── package.json
│   │
│   └── agent/                   # Client Agent Electron App
│       ├── electron/
│       │   ├── main.ts          # Tray icon, WS client, auto-start
│       │   ├── lockscreen.ts    # Full-screen lock window
│       │   └── blocking.ts      # Hosts file / process kill
│       └── package.json
│
├── package.json                 # Monorepo root (npm workspaces)
└── README.md
```

---

## 8. Non-Functional Requirements

- **Offline first:** entire system works with no internet, LAN only
- **Boot time:** client agent must show lock screen within 3 seconds of Windows startup
- **Scalability:** must handle 60+ simultaneous client connections on LAN
- **Security:** admin app is password-protected; client agent cannot be closed by end user
- **Resilience:** if server goes offline, client agent stays in locked state until reconnected
- **Persistence:** all session data persists in SQLite; no data loss on app restart

---

## 9. Out of Scope for v1

- Online/cloud sync
- Multi-branch support
- Mobile admin app
- CCTV integration
- Fingerprint / RFID login
- Automated website categorization (parental controls)

---

## 10. Success Criteria for v1

- [ ] Admin can see all machines in real-time on dashboard
- [ ] Admin can open, pause, extend, and close sessions
- [ ] Client machines lock/unlock in response to admin commands within 1 second
- [ ] Billing correctly calculates time-based charges
- [ ] Website blocking (hosts file) works on client machines
- [ ] Reports show today's revenue and session count
- [ ] Client agent auto-starts at Windows boot and cannot be killed by a regular user
- [ ] Installer (.exe) produced for both server app and client agent
