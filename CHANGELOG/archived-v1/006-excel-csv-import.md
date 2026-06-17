# Excel and CSV Bulk Import for Users

## What Was Implemented
Implemented capabilities for laboratory administrators to import customer accounts in bulk rather than creating them one by one.

- **CSV Text Import**: The React UI features a text-area input parsing comma-separated rows: `username,password,display_name,balance_minutes`. It validates the fields locally and calls the `bulk-create-users` IPC handler to insert them.
- **Excel (.xlsx) File Import**: Users can upload an Excel sheet. The React UI converts it to a base64 string and invokes the `bulk-import-users` IPC handler. The backend reads the workbook sheets, parses them to JSON objects, and inserts them while checking for duplicate usernames.
- **Excel Template Download**: An IPC handler `download-user-template` generates a sample `.xlsx` sheet base64 string for operators to download.

## Why (Reasoning & Tradeoffs)
- **Ease of Onboarding**: Large internet cafes or school labs already have lists of users. Bulk importing saves hours of manual data entry.
- **Double Import Paths**: Providing both raw CSV copy-pasting and formal Excel file uploads offers maximum flexibility for operators.

## Database Tables & Config Files Added
Modifies the `users` SQLite table directly.

## NPM Dependencies Added
- `xlsx` (in `packages/server`): Used to parse Excel sheets to JSON and generate the template sheets.

## Evolution
- **First Implementation Differences**: Initially, user creation was manual and individual. Bulk CSV import (locally parsed in React) and Excel import (`xlsx` library in the server backend) were added to support rapid member database onboarding (commit `1ff9daa`).
- **Unused, Disabled, or Superseded Parts**: Both the manual text CSV parsing and the Excel file import remain active. However, the template generator and backend Excel parser utilize the `xlsx` library, whereas the CSV parser works directly in the React frontend.

