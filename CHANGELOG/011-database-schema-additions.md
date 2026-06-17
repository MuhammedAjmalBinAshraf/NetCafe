# Database Schema Additions

## What Was Implemented
The SQLite database schema (`netcafe.db`) was extended with several tables and columns beyond the initial PRD specification:

- **New Tables**:
  - `users`: Customer accounts for managing member logins, passwords, and prepaid balances in minutes (`balance_minutes`).
  - `settings`: A key-value store for global settings (e.g. `lab_name`).
  - `session_app_logs`: Logs focusing details of applications (app title, duration, focus count, timestamps) to monitor active usage.
  - `session_process_events`: Records process execution lifecycles on client machines (machine_id, process name, start/stop event type, timestamp).
  - `safety_alerts`: Tracks triggered search queries, block rule violations, and reasons.
- **New Columns**:
  - `machines`: `hardware_locked` (Boolean flag), `uuid` (Unique machine identifier), `violation_count` (Progressive lock count).
  - `sessions`: `custom_duration` (minute duration override), `discount` (applied discount at checkout).

## Why (Reasoning & Tradeoffs)
- **Prepaid Member Logins**: The `users` table supports customer logins directly from the kiosk lockscreen.
- **Session Auditing & Analytics**: `session_app_logs` and `session_process_events` enable lab operators to review what apps customers run and how long they spend in each app.
- **Security & Progressive Enforcement**: `safety_alerts` and machine-level flags support monitoring violations and locking standard user input when violations occur.

## Database Tables & Config Files Added
- `netcafe.db` schema altered with tables: `users`, `settings`, `session_app_logs`, `session_process_events`, `safety_alerts`.

## NPM Dependencies Added
None (uses native database queries via `better-sqlite3`).

## Evolution
- **First Implementation Differences**: The initial SQLite DB schema was expanded to support prepaid logins, app usage logs, process execution event trails, and safety violation triggers. A `UNIQUE` constraint initially placed on `machines.uuid` caused registration crash loops for cloned client PCs. This was resolved in commit `52d95d9` by converting it to a standard column with a partial index (`CREATE UNIQUE INDEX idx_machines_uuid ON machines(uuid) WHERE uuid IS NOT NULL;`).
- **Unused, Disabled, or Superseded Parts**: The progressive enforcement system uses the `violation_count` column on `machines` where the 1st violation issues a Dynamic Island warning and the 2nd lock screen locks the device (commit `c93b3d6`). The old behavior of locking immediately on the first offence was superseded.

