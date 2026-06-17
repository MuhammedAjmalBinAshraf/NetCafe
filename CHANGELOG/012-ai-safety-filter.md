# AI Safety Filter Implementation

## What Was Implemented
The AI Safety Filter is a multi-layered security system designed to intercept, analyze, and block inappropriate web search queries on client terminals in real time. It consists of:
- **Layer 1: Local Custom Term Filter**: Instantly checks queries against a local blacklist of keywords or phrases configured on the dashboard, bypassing API latency.
- **Layer 2: Google Gemini AI Filter**: Evaluates the safety of the search query using the Gemini 2.5-Flash model based on active categories (Pornography, Violence, Self-Harm, and Illegal Activities).
- **Man-in-the-Middle (MITM) HTTPS Proxy**: Automatically intercepts search traffic on port 8889 by generating and installing a custom Root CA certificate to Windows certificate stores and writing system-wide and Firefox enterprise proxy policies.
- **Dynamic Island Feedback & Warnings**: Shows real-time spinner feedback in the Dynamic Island while checking.
- **Progressive Enforcement**: 
  - **1st Violation**: Displays a prominent warning banner via the Dynamic Island.
  - **2nd+ Violation**: Locks the terminal and shows a "visit Lab In-Charge" lockscreen message.

## Architecture & Implementation
- **File Paths**:
  - `packages/server/electron/main.ts` (safety check entry, SQLite logs, Gemini REST client)
  - `packages/agent/electron/main.ts` (TCP messaging bridge, lock enforcement, Dynamic Island triggers)
  - `packages/agent/electron/mitm-proxy.ts` (HTTPS proxy, cert generation/installation, Firefox policy writer)
  - `packages/server/src/App.tsx` (AI Safety logs viewer, custom terms CRUD, Gemini context configuration)
- **Database Schema**:
  - Table: `safety_alerts` (id, machine_id, query, reason, user_details, timestamp)
  - Table: `machines`: column `violation_count` (default 0)
  - Settings keys:
    - `ai_safety_enabled` (true/false)
    - `gemini_api_key` (text)
    - `filter_porn`, `filter_violence`, `filter_self_harm`, `filter_illegal` (true/false)
    - `custom_filter_terms` (JSON array of strings)
    - `ai_custom_context` (text)
- **Network Protocol**:
  - Delimited TCP payload: `{ type: "query-check-request", payload: { query, requestId } }`
  - Delimited TCP payload: `{ type: "query-check-response", payload: { query, requestId, allowed } }`
- **Registry Keys**:
  - `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
    - `ProxyEnable` = 1 (REG_DWORD)
    - `ProxyServer` = "localhost:8889" (REG_SZ)
    - `ProxyOverride` = "<local>" (REG_SZ)

## Current Status
**Fully working**. Both local Layer 1 matching and remote Layer 2 Gemini queries are operational, logging incidents, and triggering progressive enforcement.

## Evolution
- **First Implementation Differences**: The feature originally extracted queries only from active window titles (e.g., `- Google Search` or `- YouTube`). This was prone to title change bypasses.
- **HTTPS Inspection**: In commit `9bda089`, the MITM proxy was implemented, allowing direct URL parameter extraction for exact Google, YouTube, Bing, Yahoo, DuckDuckGo, Baidu, and Yandex queries.
- **Progressive Enforcement**: Initially, any violation locked the machine instantly. This was refactored in commit `c93b3d6` to issue a Dynamic Island warning on the first offense and lock on subsequent offenses, preventing user frustration from accidental triggers.
- **Unused, Disabled, or Superseded Parts**: System proxy settings are disabled automatically when the Agent exits or before-quit to prevent breaking internet access for standard accounts after the application closes.
