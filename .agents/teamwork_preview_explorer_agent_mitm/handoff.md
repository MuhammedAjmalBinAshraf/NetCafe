# Handoff Report — MITM Proxy Analysis

## 1. Observation
Below are the direct observations from scanning `d:/NetCafe/packages/agent/electron/mitm-proxy.ts`.

### A. Implemented Features
The file implements a class `MitmProxy` (Lines 126-474) with the following features:
* **Port Definition**: Port is set to `8889` (Line 26):
  ```typescript
  const PROXY_PORT = 8889; // Use 8889 to avoid conflicts
  ```
* **Search Engine Query Pattern Matching**: An array `SEARCH_ENGINES` containing regular expressions for Google, Bing, Yahoo, YouTube, DuckDuckGo, Baidu, and Yandex along with their query parameter names (Lines 29-37):
  ```typescript
  const SEARCH_ENGINES: Array<{ host: RegExp; pathPrefix: RegExp; param: string }> = [
    { host: /^(www\.)?google\.(com|co\.[a-z]+|[a-z]{2,3})$/i, pathPrefix: /^\/search/, param: 'q' },
    ...
  ```
  And `extractSearchQuery` function (Lines 39-52) to parse intercepted URLs.
* **Block Page HTML Generation**: Generates an HTML response page in `getBlockPageHtml` (Lines 54-124) when a search query is blocked.
* **Certificate Authority (CA) Initialization**: Method `initCA` (Lines 144-186) loads or generates a self-signed root CA certificate using `node-forge` library.
* **Dynamic Domain Cert Generation**: Method `getDomainCert` (Lines 189-216) dynamically generates and signs a certificate for the requested domain, caching it in `certCache`.
* **CA Installation**: Method `installCA` (Lines 220-263) saves the CA cert to file and calls `certutil` via `exec`.
* **Firefox Policies Writer**: Writes Firefox enterprise policies to auto-import enterprise roots and configure the proxy in `installCA` (Lines 238-262).
* **System Proxy Configuration**: Methods `setSystemProxy` (Lines 265-273) and `unsetSystemProxy` (Lines 275-279) to enable and disable system-wide proxy settings.
* **Proxy Request Handling (HTTP & HTTPS CONNECT)**:
  * `handleHttp` (Lines 283-325) handles plain HTTP requests and intercepts search queries.
  * `handleConnect` (Lines 327-429) intercepts HTTPS CONNECT tunnels, wraps client sockets with `tls.TLSSocket` presenting the forged certificates, intercepts search query URLs, and pipes the decrypted traffic.
* **Start & Stop Lifecycle**: Methods `start` (Lines 433-466) and `stop` (Lines 468-473) control the proxy server lifecycle and toggle registry proxy settings.

### B. IPC Channels & Database Queries
* **IPC Channels**: None. There are no Electron IPC channels (e.g., `ipcMain` or `ipcRenderer`) defined or referenced in this file.
* **Database Queries**: None. The class interacts with other modules strictly via the callback `onQuery` passed to its constructor (Line 138).

### C. Platform-Specific Behavior
The file is strictly Windows-specific, containing multiple executions of Windows-only commands and hardcoded Windows paths:
* **Windows Certutil Store**: Lines 225 and 231 execute the `certutil` command:
  ```typescript
  exec(`certutil -addstore -f "Root" "${crtPath}"`, (err) => { ... })
  // and fallback
  exec(`certutil -user -addstore -f "Root" "${crtPath}"`, (userErr) => { ... })
  ```
* **Firefox Windows Distribution Paths**: Lines 239-242 target typical Windows folders for Firefox:
  ```typescript
  const ffDirs = [
    'C:\\Program Files\\Mozilla Firefox\\distribution',
    'C:\\Program Files (x86)\\Mozilla Firefox\\distribution',
  ];
  ```
* **Windows Registry System Proxy**: Lines 265-273 and 275-279 use `reg add` to modify registry keys:
  ```typescript
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  exec(`reg add "${key}" /v ProxyEnable  /t REG_DWORD /d 1                    /f`);
  exec(`reg add "${key}" /v ProxyServer  /t REG_SZ    /d "localhost:${PROXY_PORT}" /f`);
  exec(`reg add "${key}" /v ProxyOverride /t REG_SZ   /d "<local>"             /f`);
  ```
* **WinINet Notification**: Uses `rundll32.exe` to broadcast the proxy change (Lines 271, 277):
  ```typescript
  exec('rundll32.exe wininet.dll,InternetSetOption 39 0 0');
  ```
There are no `process.platform` platform-check guards; running this on non-Windows platforms (macOS/Linux) will fail on these shell execution commands.

### D. Incomplete/Queued Features & Placeholder/Mock/Safety Fallbacks
* **Fallback to Transparent Proxy**: If certificate generation fails, the proxy falls back to a transparent tunnel without SSL inspection/query extraction (Lines 343-351):
  ```typescript
  this.log(`[Proxy] Cert gen failed for ${hostname}: ${err.message}`);
  // Fallback: transparent tunnel (no inspection)
  const realSock = net.connect(port, hostname, () => {
    realSock.pipe(clientSocket);
    clientSocket.pipe(realSock);
  });
  ```
* **No Server Certificate Verification**: Connecting to the real server uses `rejectUnauthorized: false`, which disables SSL validation and leaves the proxy vulnerable to upstream MITM (Line 362):
  ```typescript
  const realSocket = tls.connect(
    { host: hostname, port, servername: hostname, rejectUnauthorized: false },
  );
  ```
* **Fixed Buffering for Request Parsing**: Intercepts only the first chunk of data up to 2048 bytes to parse the HTTP request headers (Line 370). If headers are larger or segmented, query parsing might fail or misbehave:
  ```typescript
  reqBuffer += data.toString('utf8', 0, Math.min(data.length, 2048));
  ```
* **Resets Header Buffer**: The header buffer is cleared immediately after the first line is matched (Line 374), meaning subsequent HTTP requests in a keep-alive connection will bypass inspection:
  ```typescript
  reqBuffer = ''; // reset after reading first line
  ```
* **Fails Open on Safety Check Failure**: If the `onQuery` callback fails or throws an error, the proxy logs it and allows the search to proceed (Lines 300-302, 400-402):
  ```typescript
  } catch (err: any) {
    this.log(`[Proxy] Safety check error: ${err.message}. Allowing query for safety fallback.`);
  }
  ```
* **Silent Error Catching**: Several catch blocks swallow errors silently or log minimal information:
  * Line 48: `catch { /* ignore malformed URLs */ }`
  * Line 155: `catch { /* regenerate if corrupt */ }`
  * Line 261: `catch { /* Firefox may not be installed */ }`
  * Line 304: `catch { /* ignore */ }`
  * Line 320: `proxyReq.on('error', () => { try { res.end(); } catch {} });`
  * Line 422: `try { clientTls.destroy(); } catch {}`

---

## 2. Logic Chain
1. **Observation**: `mitm-proxy.ts` contains `exec` commands targeting `certutil`, `reg add`, and `rundll32.exe wininet.dll`.
2. **Inference**: These commands are specific to the Windows command shell and Windows APIs.
3. **Observation**: There is no conditional logic like `process.platform === 'win32'` before invoking these commands.
4. **Inference**: The file assumes a Windows runtime environment and will fail when run on Linux or macOS.
5. **Observation**: The class implements dynamic certificate generation (`getDomainCert`) and routes TCP/TLS connections via `tls.connect` and `tls.TLSSocket`.
6. **Inference**: It intercepts SSL traffic by operating a Man-In-The-Middle HTTPS server.
7. **Observation**: There are no occurrences of `ipcMain` or database-related dependencies (e.g., `sqlite`, `knex`, `prisma`, `typeorm`, or `pg`).
8. **Inference**: The proxy acts as a standalone utility service and does not communicate directly via Electron IPC or read/write a database. Communication with the main process is done solely via the constructor-provided `onQuery` callback.

---

## 3. Caveats
* **Scope**: Only `d:/NetCafe/packages/agent/electron/mitm-proxy.ts` was analyzed. No other files were read or inspected.
* **Runtime Verification**: The code was not executed. Observations are based purely on static code analysis.
* **Dependencies**: The actual behaviour of `node-forge` in this project environment was not tested.

---

## 4. Conclusion
`mitm-proxy.ts` provides local Man-In-The-Middle proxy capabilities on port 8889 to intercept, inspect, and block HTTPS/HTTP search queries from standard search engines. It uses Windows-native registry settings and certificate tools (`certutil`) for zero-conf CA installation and proxy setup. It does not implement any IPC endpoints or direct database queries. The system is currently designed exclusively for Windows clients and fails open in case of network query-check errors.

---

## 5. Verification Method
Verify the observations by inspecting the file `d:/NetCafe/packages/agent/electron/mitm-proxy.ts` using `view_file` at the exact lines referenced:
1. `PROXY_PORT = 8889` (Line 26)
2. `SEARCH_ENGINES` patterns (Lines 29-37)
3. `certutil` executions (Lines 225, 231)
4. Registry additions via `reg add` (Lines 267-269, 276)
5. `rejectUnauthorized: false` configuration (Line 362)
6. Error catches & fallback (Lines 300-302, 343-351, 400-402)
