# Codebase Explorer Investigation Report - packages/agent/electron/main.ts

## 1. Observation

Direct code observations from `d:/NetCafe/packages/agent/electron/main.ts` (total of 3136 lines):

### 1.1 Implemented Features & Core Logic
*   **Single Instance Enforcement**: Checks if another instance is already running using Electron's single instance lock. If it fails to acquire the lock, the agent terminates.
    *   *Lines 11-16*:
        ```typescript
        const gotTheLock = app.requestSingleInstanceLock();
        if (!gotTheLock) {
          console.log('Another instance of NetCafe Agent is already running. Exiting.');
          app.quit();
          process.exit(0);
        }
        ```
*   **Agent Runtime Logging**: Appends timestamped logs to `C:\NetCafe\logs\agent.log` and maintains an in-memory cache of the 50 most recent logs.
    *   *Lines 37-51, 63-76*:
        ```typescript
        const agentLogsCache: { timestamp: string, message: string }[] = [];
        const runtimeLogFilePath = "C:\\NetCafe\\logs\\agent.log";

        function writeAgentRuntimeLog(msg: string) { ... }
        function logToUI(msg: string) { ... }
        ```
*   **Config Loading and Saving**: Persists server host, port, machine ID, operator password, and generated client UUID into a JSON file (`config.json` inside Electron's user data directory).
    *   *Lines 78-130*:
        ```typescript
        const configPath = path.join(app.getPath('userData'), 'config.json');
        ...
        function loadConfig() { ... }
        ```
*   **Lock Enforcement & Focus Maintenance**: When the agent is locked, it enforces a fullscreen kiosk lock window and runs an interval every 500ms to bring the lock screen window to the front and refocus it.
    *   *Lines 132-152, 154-893*:
        ```typescript
        function startLockEnforcement() { ... }
        function createLockWindow() { ... }
        ```
*   **Dynamic Island Window Overlay**: Displays a transparent status overlay containing information about the user session (duration, elapsed/remaining time, pricing mode, and cost accrued). The window changes layout modes (notch, compact, card, banner, evaluating) based on user interaction, foreground app status, or operator actions.
    *   *Lines 31-33, 951-957, 996-1006, 1025-1038, 2302-2374, 2375-2892*:
        ```typescript
        function createIslandWindow(sessionData?: any) { ... }
        function destroyIslandWindow() { ... }
        function getIslandHtml(sessionData?: any): string { ... }
        ```
*   **TCP Client Socket & Server Command Handling**: Establishes a TCP socket to the NetCafe server. It handles incoming server commands to lock/unlock, limit/remove bandwidth, take screenshot, execute terminal commands, emulate mouse/keyboard inputs, block domain DNS entries, block executables, change mirror quality, and update passwords.
    *   *Lines 895-1137, 1497-1600*:
        ```typescript
        function sendToServer(data: any) { ... }
        async function handleServerMessage(msg: any) { ... }
        function connectToServer() { ... }
        ```
*   **Hardware Input Blocking**: Persistently blocks or unblocks Windows hardware inputs via PowerShell or direct `user32.dll` WMI/API invocation.
    *   *Lines 933-937, 977-981, 1104-1117, 1558-1565, 2076-2084*:
        ```typescript
        if (process.platform === 'win32') {
          exec(`powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class B{[DllImport(\\"user32.dll\\")]public static extern bool BlockInput(bool f);}';[B]::BlockInput($false)"`, () => {});
          if (psProcess && psProcess.stdin && !psProcess.killed) psProcess.stdin.write('Set-BlockInput $false\n');
        }
        ```
*   **Explorer Desktop Shell Management**: During a session, `explorer.exe` is spawned so the desktop UI is available. When the session locks or the connection to the server drops, `explorer.exe` is terminated to keep the client secured.
    *   *Lines 939-949, 983-994, 1020-1024, 1578-1582, 2086-2090*:
        ```typescript
        if (process.platform === 'win32') {
          logToUI('Terminating explorer.exe to lock desktop shell...');
          exec('taskkill /F /IM explorer.exe', () => {});
        }
        ```
*   **Active Window and Process Tracking (Metrics)**: Sends real-time system metrics (CPU, RAM, foreground window title, system uptime, and processes started/closed) to the server on foreground window changes or every 10 seconds.
    *   *Lines 1259-1331, 1725-1768, 2213-2247*:
        ```typescript
        metricsInterval = setInterval(async () => { ... }, 10000);
        ```
*   **Software Auto Updater**: Check, download, and apply updates using `electron-updater`. Restops watchdog service before installation to avoid file locking conflicts.
    *   *Lines 2, 469, 539-555, 775-827, 2095-2142, 2145-2150*:
        ```typescript
        autoUpdater.channel = 'latest-agent';
        autoUpdater.autoDownload = true;
        ...
        ```
*   **Host DNS and Executable Application Blocking**: Intercepts domain access by rewriting the local hosts file with redirection loopbacks to `127.0.0.1`. Automatically checks process metrics to kill blocked executable names every 3 seconds.
    *   *Lines 1094-1099, 1342-1376 (hosts file modifications)*
    *   *Lines 1377-1389, 2249-2254 (executable termination)*
*   **Browser Query Interception via MITM Proxy**: Intercepts search queries made in the browser (specifically on Windows platform) by integrating a local `MitmProxy` instance, which halts browser navigation until query safety is confirmed by the central NetCafe server.
    *   *Lines 1932-1984, 2009-2027*:
        ```typescript
        mitmProxy = new MitmProxy(
          app.getPath('userData'),
          async (query: string) => { ... }
        );
        ```
*   **Auto-Start Kiosk Configuration (Setup & Uninstall)**: Automates Kiosk mode registration by creating a local Windows user `CafeKiosk`, configuring AutoAdminLogon, setting GPO registry restrictions (blocking Task Manager, Command Prompt, User Switching), and writing custom shell configurations (replacing Winlogon shell/WMI embedded shell launcher).
    *   *Lines 1986-2004, 2894-3135*:
        ```typescript
        async function runKioskSetup(): Promise<void> { ... }
        async function runKioskUninstall(): Promise<void> { ... }
        ```

### 1.2 IPC Channels
All IPC bridge actions are managed via `ipcMain` calls in the following lines:
1.  **`agent-user-login`** (Lines 1140-1164): Processes client username/password login request by routing it over the TCP socket to the server and returning the status back to the lock screen.
2.  **`save-agent-config`** (Lines 1166-1196): Saves the newly defined Server IP address and Terminal Name to `config.json` and triggers socket reconnection.
3.  **`install-as-shell`** (Lines 1199-1202): Sets registry settings to configure the agent binary as the user shell.
4.  **`restore-shell`** (Lines 1204-1207): Reverts registry keys back to default Windows Explorer shell.
5.  **`system-shutdown`** (Lines 1209-1217): Commands OS-level system shutdown.
6.  **`get-shell-status`** (Lines 1219-1227): Resolves if the agent is registered in registry as the shell.
7.  **`manual-check-for-updates`** (Lines 2145-2147): Requests immediate check for updates.
8.  **`manual-download-update`** (Lines 2148-2150): Requests immediate download of update.
9.  **`get-agent-logs`** (Lines 2151-2153): Retrieves cached log items for display in the operator configuration console.
10. **`resize-island`** (Lines 2423-2435): Adjusts the Electron window dimensions of the dynamic island overlay.
11. **`island-mouse`** (Lines 2437-2441): Configures whether the dynamic island intercepts mouse clicks or forwards them to background windows.
12. **`exit-session-request`** (Lines 2443-2445): Fires a request to the server to close/terminate the user session.

### 1.3 Database Queries
*   **Direct Database Queries**: None. The file has zero direct database interactions. All data persistence is performed via the config file (`config.json`), local registries (`reg.exe` commands), local logs, and the remote TCP server.

### 1.4 Platform-Specific Behaviors

#### Windows (`win32` platform-specific branches):
*   **Shell Registry Validation**: Queries registry key `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon /v Shell` using `execSync`. (Lines 53-61, 1219-1227, 1230-1256)
*   **Focus Lock Enforcement**: Enables screensaver level always-on-top attributes. (Lines 139-144, 171)
*   **Explorer Desktop Shell Management**: Spawns or kills `explorer.exe` (Lines 939-949, 983-994, 1020-1024, 1578-1582, 2086-2090)
*   **Hardware Input Lockout**: Uses PowerShell to load type definitions mapping `BlockInput` from `user32.dll`. (Lines 934-937, 977-981, 1104-1117, 1558-1565, 2076-2084)
*   **Windows Firewall Setup**: Allows incoming connections to UDP port 9090. (Lines 1631-1648)
*   **Active Window Monitoring**: Monitors foreground titles via a C# assembly compiled at runtime in a spawned PowerShell listener. (Lines 1287-1295, 1770-1930)
*   **Browser Query Interception (MITM Proxy)**: Initialized and started only on Windows. (Lines 2006-2027)
*   **Task Scheduler Auto-Start registration**: Configures Logon scheduled task `schtasks /create` and registry modifications on Startup delay `Serialize\StartupDelayInMSec` to 0. (Lines 2041-2071)
*   **Watchdog Service Control**: Issues `sc stop "NetCafeAgentWatchdog"` commands. (Lines 2133-2137)
*   **Fullscreen Window Verification**: Employs PowerShell command checks using `GetWindowRect` User32 APIs. (Lines 2302-2353)
*   **Kiosk Setup & Uninstall scripting**: Auto Logon Setup, GPO policy updates, creating/removing `CafeKiosk` user, WMI embedded shell config. (Lines 2894-3135)

#### Linux (`linux` platform-specific branches):
*   **Bandwidth Limiting**: Uses Linux terminal command `tc qdisc` to regulate speed on the default network interface. (Lines 1051-1055, 1391-1432)
*   **DNS Redirections**: Configured to write block domains specifically targeting the `/etc/hosts` file. (Line 1345)
*   **Executable Blocking**: Executes `pkill -f` on target executables. (Lines 1383-1388)
*   **Active Window Title Retrieval**: Calls CLI utility `xdotool getactivewindow getwindowname`. (Lines 1297-1304)
*   **Self-Escalation**: Uses `pkexec` wrapper to restart the application as root if run by a non-root user. (Lines 2028-2037)

### 1.5 Incomplete Features, Placeholders, or TODOs
*   **Default Connection Addresses & Credentials**:
    *   *Lines 79-81*: Hardcoded server URL, host, and port placeholders.
        ```typescript
        let serverUrl = '127.0.0.1:9000';   // display string (host:port)
        let serverHost = '127.0.0.1';
        let serverPort = 9000;
        ```
    *   *Line 84*: Hardcoded operator password fallback.
        ```typescript
        let operatorPassword = 'admin'; // synced from server via update-operator-password command
        ```
*   **PIN Validation Backwards Compatibility**:
    *   *Lines 649-650*: Duplicate passwords in array for backwards compatibility.
        ```typescript
        const VALID_PINS = ['${operatorPassword}', '${operatorPassword}'];
        // Note: array kept for backwards compat; only operatorPassword is the active PIN
        ```
*   **Active Window Fallbacks**:
    *   *Line 1291*: Hardcoded foreground window title fallback: `'System'`
    *   *Line 1299*: Hardcoded foreground window title fallback: `'Desktop / Shell'`
*   **Network Interface Fallbacks**:
    *   *Lines 1395, 1402*: Default interface resolves to `eth0` if parsing `ip route` fails.
*   **Screen Resolution Fallback**:
    *   *Lines 1745, 2223*: Default screen bounds fallback value: `1920x1080`
*   **Kiosk Default Credentials**:
    *   *Lines 2950, 2961*: Hardcoded password for the `CafeKiosk` Windows local user:
        ```typescript
        net user CafeKiosk "CafeKiosk123!" /add /expires:never /active:yes
        ...
        Set-ItemProperty -Path $winlogon -Name "DefaultPassword" -Value "CafeKiosk123!" -Type String
        ```
*   **Dynamic Island UI Placeholders**:
    *   *Line 2711*: Default user badge: `<span class="cust-name" id="card-username">Walk-in</span>`
    *   *Line 2730*: Default alert banner placeholder: `<div class="banner-text" id="banner-message-text">Message placeholder</div>`
    *   *Line 2813*: Postpaid mode default hourly rate fallback: `const hourlyRate = session.planPrice || 5.0;`
*   **Auto Updater check Yml filter**:
    *   *Line 2096*: autoUpdater Yml check constraint reminder:
        ```typescript
        autoUpdater.channel = 'latest-agent';  // ← must NOT pick up latest-server.yml
        ```

---

## 2. Logic Chain

1.  **Observation Reference**: The file path `packages/agent/electron/main.ts` was examined in full (lines 1 to 3136).
2.  **Observation Reference**: Implemented logic and IPC channels were identified by mapping `ipcMain.handle` and `ipcMain.on` occurrences, as well as socket communication handlers `handleServerMessage` and `sendToServer`.
3.  **Observation Reference**: Platform checks (e.g., `process.platform === 'win32'` or `process.platform === 'linux'`) were used to map out OS-specific behaviors (such as GPO policies and firewall rules on Windows versus `tc` and `pkexec` on Linux).
4.  **Observation Reference**: Hardcoded string values, placeholders, and back-compatibility notes (such as `"CafeKiosk123!"`, `"admin"`, `"eth0"`, `"127.0.0.1"`, `"System"`, `"Desktop / Shell"`, `"Message placeholder"`, and `VALID_PINS` array duplicate references) were extracted from the codebase.
5.  **Reasoning**: From these direct observations, we conclude that:
    *   The agent is designed to run primarily on Windows as a kiosk client shell but retains some functionality for Linux (e.g., traffic control and hosts manipulation).
    *   Communication is centrally driven by the NetCafe server via a custom TCP socket connection.
    *   No direct database interfaces are present, delegating database access to the Server application.
    *   Auto-configuration utilizes a local UDP port 9090 listener to capture server broadcast payloads.
    *   Critical default credentials and fallback behaviors (such as `CafeKiosk123!` and `5.0` hourly rates) are hardcoded, representing placeholders that are either overwritten dynamically or used as fallbacks.

---

## 3. Caveats

*   **File Isolation Scope**: No other files in the workspace (including `./mitm-proxy.ts`, `watchdog.ts`, or packages/server files) were opened or analyzed, as per the explicit constraints of the prompt request.
*   **Runtime Tests**: The behavior of registry additions, custom WMI commands, and Windows Firewall configurations were not verified on a live running Windows platform, but analyzed purely through static review of the TS file.
*   **MITM Implementation details**: The inner workings of the `MitmProxy` helper class could not be examined since it lies inside `packages/agent/electron/mitm-proxy.ts`.

---

## 4. Conclusion

*   The agent is a fully functional client controller designed to run as a secure desktop shell environment.
*   It implements 12 distinct IPC channels allowing interaction between the Electron renderer processes (lock window and dynamic island) and the main OS layer.
*   The architecture is highly platform-dependent, with specialized execution paths for Windows (e.g., C# monitoring, input blocking, Explorer shell lifecycle, GPO setup) and Linux (e.g., `tc` traffic limiting, `xdotool` active window query, `pkexec` root escalation).
*   No database queries are executed directly within the agent.
*   Placeholders, default fallbacks (e.g. `$5.0` postpaid rate, `eth0` network card, `127.0.0.1` server host), and default kiosk password credentials (`CafeKiosk123!`) exist directly in code.

---

## 5. Verification Method

To independently verify the observations:
1.  **File Check**: Read `d:/NetCafe/packages/agent/electron/main.ts` directly.
2.  **Verify Line Counts & Structures**:
    *   Confirm single instance check on lines 11-16.
    *   Confirm IPC channel registrations (`ipcMain.handle` / `ipcMain.on`) at lines 1140, 1166, 1199, 1204, 1209, 1219, 2145, 2148, 2151, 2423, 2437, 2443.
    *   Confirm platform-specific branches matching `process.platform === 'win32'` or `process.platform === 'linux'` throughout the file.
    *   Validate the hardcoded Kiosk logon credentials (`CafeKiosk123!`) on lines 2950 and 2961.
