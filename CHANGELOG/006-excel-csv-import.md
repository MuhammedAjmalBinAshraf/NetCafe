# Excel and CSV Bulk Import for Users

## Description
Administrators can bulk import user/member databases into NetCafe Manager using copy-pasted CSV text fields or uploaded Excel files.

## Architecture & Implementation
- **File Paths**: `packages/server/electron/main.ts`, `packages/server/src/App.tsx`
- **CSV Imports**: The React dashboard parses comma-separated lines directly and calls `bulk-create-users` IPC handler.
- **Excel Imports**: Converts file uploads to base64 in React, sends to `bulk-import-users` IPC handler. The backend reads the workbook using `xlsx` and registers accounts.
- **Template Download**: `download-user-template` IPC handler constructs a sample workbook and transfers it back to the client as base64.

## Current Status
**Fully working**. Both import formats are supported and correctly insert accounts into the SQLite database.

## Evolution
- **First Implementation Differences**: Initially, user creation was manual and individual. Bulk CSV import (locally parsed in React) and Excel import (`xlsx` library in the server backend) were added to support rapid member database onboarding (commit `1ff9daa`).
- **Dashboard Enhancements**: Batch actions (batch top-up, batch delete) and password visibility toggles were added to the User dashboard in commit `b6491bd` to manage users more effectively.
- **Unused, Disabled, or Superseded Parts**: None.
