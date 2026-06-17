# Database Schema Additions

## Description
The local SQLite database schema (`netcafe.db`) has been expanded to support prepaid member billing, global configuration settings, application tracking, process event logging, and AI Safety alerts.

## Architecture & Implementation
- **File Paths**: `packages/server/electron/main.ts`
- **Database Engine**: SQLite queried via native `better-sqlite3` bindings.
- **Extended Tables**:
  - `users`: Member records (`username`, `password`, `balance_minutes`, `display_name`, `phone`, `email`).
  - `settings`: Configuration store (`key` PRIMARY KEY, `value`).
  - `session_app_logs`: Focus duration monitoring (`session_id`, `app_title`, `duration_seconds`, `focus_count`).
  - `session_process_events`: Process activity audits (`session_id`, `machine_id`, `event_type`, `process_name`, `timestamp`).
  - `safety_alerts`: Search violation records (`machine_id`, `query`, `reason`, `user_details`, `timestamp`).
- **Columns Altered**:
  - `machines`: `hardware_locked` (Boolean flag), `uuid` (unique client identifier), `violation_count` (incident tracking).
  - `sessions`: `custom_duration` (override duration), `discount` (applied discount).

## Current Status
**Fully working**. Database tables auto-seed at startup and handle concurrent client metrics reporting correctly.

## Evolution
- **First Implementation Differences**: The initial SQLite DB schema was expanded to support prepaid logins, app usage logs, process execution event trails, and safety violation triggers. A `UNIQUE` constraint initially placed on `machines.uuid` caused registration crash loops for cloned client PCs. This was resolved in commit `52d95d9` by converting it to a standard column with a partial index (`CREATE UNIQUE INDEX idx_machines_uuid ON machines(uuid) WHERE uuid IS NOT NULL;`).
- **Unused, Disabled, or Superseded Parts**: The progressive enforcement system uses the `violation_count` column on `machines` where the 1st violation issues a Dynamic Island warning and the 2nd lock screen locks the device (commit `c93b3d6`). The old behavior of locking immediately on the first offence was superseded.
