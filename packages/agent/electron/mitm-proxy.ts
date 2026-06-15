/**
 * NetCafe MITM Proxy — Real-time browser query interception
 *
 * Intercepts HTTPS traffic from all browsers via a local Man-in-the-Middle proxy.
 * - Generates a CA certificate (one-time per machine)
 * - Installs CA to Windows Trusted Root store (via certutil — silently)
 * - Writes Firefox enterprise policy to trust the CA and use OS proxy
 * - Sets Windows system proxy to localhost:8888 (applies to Chrome, Edge, Brave, Opera, IE)
 * - Intercepts HTTPS CONNECT tunnels, reads search query URLs before encryption
 * - Sends detected queries to the NetCafe server for AI safety filtering
 *
 * Admin setup required: NONE — fully automatic on first agent start.
 */

import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
// node-forge is a production dependency. We load it with require + any to avoid
// TypeScript errors when @types/node-forge is not yet installed locally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const forge: any = require('node-forge');

const PROXY_PORT = 8889; // Use 8889 to avoid conflicts

/** Search engine patterns: hostname regex → query param name */
const SEARCH_ENGINES: Array<{ host: RegExp; pathPrefix: RegExp; param: string }> = [
  { host: /^(www\.)?google\.(com|co\.[a-z]+|[a-z]{2,3})$/i, pathPrefix: /^\/search/, param: 'q' },
  { host: /^(www\.)?bing\.com$/i,                             pathPrefix: /^\/search/, param: 'q' },
  { host: /^(www\.)?yahoo\.com$/i,                            pathPrefix: /^\/(search|ysearch)/, param: 'p' },
  { host: /^(www\.)?youtube\.com$/i,                          pathPrefix: /^\/results/, param: 'search_query' },
  { host: /^(www\.)?duckduckgo\.com$/i,                       pathPrefix: /^\/$/, param: 'q' },
  { host: /^(www\.)?baidu\.com$/i,                            pathPrefix: /^\/s/, param: 'wd' },
  { host: /^(www\.)?yandex\.(com|ru)$/i,                      pathPrefix: /^\/search/, param: 'text' },
];

function extractSearchQuery(hostname: string, urlPath: string): string | null {
  for (const se of SEARCH_ENGINES) {
    if (se.host.test(hostname)) {
      try {
        const parsed = new URL('https://' + hostname + urlPath);
        if (se.pathPrefix.test(parsed.pathname)) {
          const q = parsed.searchParams.get(se.param);
          if (q && q.trim().length > 1) return q.trim();
        }
      } catch { /* ignore malformed URLs */ }
    }
  }
  return null;
}

function getBlockPageHtml(query: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Blocked by NetCafe Safety Guard</title>
  <style>
    body {
      background-color: #0f172a;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background-color: #1e293b;
      border: 1px solid #ef4444;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .icon {
      color: #ef4444;
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 12px 0;
      color: #f87171;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin: 0 0 20px 0;
    }
    .query-box {
      background-color: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 16px;
      font-family: monospace;
      font-size: 14px;
      color: #ef4444;
      word-break: break-all;
      margin-bottom: 24px;
    }
    .footer {
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Search Query Blocked</h1>
    <p>The search query you entered has been flagged by the NetCafe Safety Guard for violating the house safety rules.</p>
    <div class="query-box">"${query}"</div>
    <div class="footer">NetCafe Manager &bull; Real-time AI Safety Guard</div>
  </div>
</body>
</html>`;
}

export class MitmProxy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private caKey!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private caCert!: any;
  private caCertPem = '';
  private certCache = new Map<string, { key: string; cert: string }>();
  private server!: http.Server;
  private running = false;

  constructor(
    private readonly dataDir: string,
    private readonly onQuery: (query: string) => Promise<boolean>,
    private readonly log: (msg: string) => void
  ) {}

  // ─── Certificate Authority ────────────────────────────────────────────────

  private initCA(): void {
    const keyPath  = path.join(this.dataDir, 'nc-proxy-ca.key.pem');
    const certPath = path.join(this.dataDir, 'nc-proxy-ca.cert.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      try {
        this.caKey     = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, 'utf8'));
        this.caCert    = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
        this.caCertPem = fs.readFileSync(certPath, 'utf8');
        this.log('[Proxy] Loaded existing CA cert');
        return;
      } catch { /* regenerate if corrupt */ }
    }

    this.log('[Proxy] Generating CA certificate (first run — one-time)...');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter  = new Date(Date.now() + 10 * 365 * 86400_000);

    const attrs = [
      { name: 'commonName',        value: 'NetCafe Security Filter CA' },
      { name: 'organizationName',  value: 'NetCafe' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    fs.writeFileSync(keyPath,  forge.pki.privateKeyToPem(keys.privateKey));
    fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));

    this.caKey     = keys.privateKey;
    this.caCert    = cert;
    this.caCertPem = forge.pki.certificateToPem(cert);
    this.log('[Proxy] CA certificate generated');
  }

  /** Generate a domain certificate signed by our CA (cached per hostname). */
  private getDomainCert(hostname: string): { key: string; cert: string } {
    const cached = this.certCache.get(hostname);
    if (cached) return cached;

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey    = keys.publicKey;
    cert.serialNumber = (Date.now() * Math.random()).toString(16).replace('.', '');
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter  = new Date(Date.now() + 365 * 86400_000);

    cert.setSubject([{ name: 'commonName', value: hostname }]);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2 /* DNS */, value: hostname }] },
    ]);
    cert.sign(this.caKey, forge.md.sha256.create());

    const result = {
      key:  forge.pki.privateKeyToPem(keys.privateKey),
      cert: forge.pki.certificateToPem(cert),
    };
    this.certCache.set(hostname, result);
    return result;
  }

  // ─── System Setup ─────────────────────────────────────────────────────────

  private installCA(): void {
    const crtPath = path.join(this.dataDir, 'netcafe-proxy-ca.crt');
    fs.writeFileSync(crtPath, this.caCertPem);

    // Install to Windows Trusted Root store (local machine)
    exec(`certutil -addstore -f "Root" "${crtPath}"`, (err) => {
      if (!err) {
        this.log('[Proxy] CA installed in Windows Trusted Root store (Local Machine) ✓');
      } else {
        this.log(`[Proxy] Local Machine CA install note: ${err.message.split('\n')[0]}`);
        // Fallback to Current User store (does not require admin privileges)
        exec(`certutil -user -addstore -f "Root" "${crtPath}"`, (userErr) => {
          if (!userErr) this.log('[Proxy] CA installed in Windows Trusted Root store (Current User) ✓');
          else this.log(`[Proxy] Current User CA install note: ${userErr.message.split('\n')[0]}`);
        });
      }
    });

    // Write Firefox enterprise policy: trust enterprise CAs + use system proxy
    const ffDirs = [
      'C:\\Program Files\\Mozilla Firefox\\distribution',
      'C:\\Program Files (x86)\\Mozilla Firefox\\distribution',
    ];
    const policy = JSON.stringify({
      policies: {
        Certificates: { ImportEnterpriseRoots: true },
        NetworkSettings: {
          HTTPProxy:                  `localhost:${PROXY_PORT}`,
          UseHTTPProxyForAllProtocols: true,
          NoProxiesOn:                'localhost,127.0.0.1',
        },
      },
    }, null, 2);

    for (const dir of ffDirs) {
      try {
        if (fs.existsSync(path.dirname(dir))) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'policies.json'), policy);
          this.log(`[Proxy] Firefox policy written to ${dir}`);
        }
      } catch { /* Firefox may not be installed */ }
    }
  }

  private setSystemProxy(): void {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    exec(`reg add "${key}" /v ProxyEnable  /t REG_DWORD /d 1                    /f`);
    exec(`reg add "${key}" /v ProxyServer  /t REG_SZ    /d "localhost:${PROXY_PORT}" /f`);
    exec(`reg add "${key}" /v ProxyOverride /t REG_SZ   /d "<local>"             /f`);
    // Notify WinINet that proxy settings changed
    exec('rundll32.exe wininet.dll,InternetSetOption 39 0 0');
    this.log(`[Proxy] Windows system proxy → localhost:${PROXY_PORT}`);
  }

  private unsetSystemProxy(): void {
    exec('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f');
    exec('rundll32.exe wininet.dll,InternetSetOption 39 0 0');
    this.log('[Proxy] System proxy disabled');
  }

  // ─── Proxy Server ─────────────────────────────────────────────────────────

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const parsed  = new URL(req.url || '', 'http://localhost');
      const query   = extractSearchQuery(parsed.hostname, parsed.pathname + parsed.search);
      if (query) {
        this.log(`[Proxy] HTTP query: "${query}"`);
        try {
          const allowed = await this.onQuery(query);
          if (!allowed) {
            const blockHtml = getBlockPageHtml(query);
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Length': Buffer.byteLength(blockHtml)
            });
            res.end(blockHtml);
            return;
          }
        } catch (err: any) {
          this.log(`[Proxy] HTTP query safety check error: ${err.message}. Allowing.`);
        }
      }
    } catch { /* ignore */ }

    try {
      const parsed = new URL(req.url || '');
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port:     parseInt(parsed.port) || 80,
        path:     parsed.pathname + parsed.search,
        method:   req.method,
        headers:  { ...req.headers, host: parsed.host },
      };
      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });
      req.pipe(proxyReq, { end: true });
      proxyReq.on('error', () => { try { res.end(); } catch {} });
    } catch {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  }

  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr) || 443;

    // Send tunnel established response
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length > 0) {
      // Prepend any data that came with CONNECT
      clientSocket.unshift(head);
    }

    let domainCert: { key: string; cert: string };
    try {
      domainCert = this.getDomainCert(hostname);
    } catch (err: any) {
      this.log(`[Proxy] Cert gen failed for ${hostname}: ${err.message}`);
      // Fallback: transparent tunnel (no inspection)
      const realSock = net.connect(port, hostname, () => {
        realSock.pipe(clientSocket);
        clientSocket.pipe(realSock);
      });
      realSock.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => realSock.destroy());
      return;
    }

    // Wrap the client socket in TLS — we present our signed cert
    const clientTls = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key:      domainCert.key,
      cert:     domainCert.cert,
    });

    // Connect to the real server with TLS
    const realSocket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
    );

    // Inspect HTTP requests flowing from browser → real server
    let reqBuffer = '';
    clientTls.on('data', async (data: Buffer) => {
      try {
        // Parse first line of HTTP request to extract path
        reqBuffer += data.toString('utf8', 0, Math.min(data.length, 2048));
        const lineEnd = reqBuffer.indexOf('\r\n');
        if (lineEnd !== -1) {
          const firstLine = reqBuffer.substring(0, lineEnd);
          reqBuffer = ''; // reset after reading first line
          const match = firstLine.match(/^[A-Z]+ ([^\s]+) HTTP/);
          if (match) {
            const query = extractSearchQuery(hostname, match[1]);
            if (query) {
              this.log(`[Proxy] 🔍 HTTPS query intercepted (${hostname}): "${query}"`);
              clientTls.pause();
              try {
                const allowed = await this.onQuery(query);
                if (!allowed) {
                  const blockHtml = getBlockPageHtml(query);
                  const httpResponse = [
                    'HTTP/1.1 200 OK',
                    'Content-Type: text/html; charset=utf-8',
                    `Content-Length: ${Buffer.byteLength(blockHtml)}`,
                    'Connection: close',
                    '',
                    blockHtml
                  ].join('\r\n');
                  if (!clientTls.destroyed) {
                    clientTls.write(httpResponse);
                    clientTls.end();
                  }
                  realSocket.end();
                  return;
                }
              } catch (err: any) {
                this.log(`[Proxy] Safety check error: ${err.message}. Allowing query for safety fallback.`);
              } finally {
                clientTls.resume();
              }
            }
          }
        }
      } catch (err: any) {
        this.log(`[Proxy] Error parsing request data: ${err.message}`);
      }

      if (!realSocket.destroyed) realSocket.write(data);
    });

    // Forward responses from real server → browser
    realSocket.on('data', (data: Buffer) => {
      if (!clientTls.destroyed) clientTls.write(data);
    });

    // Cleanup
    const cleanup = () => {
      try { clientTls.destroy(); } catch {}
      try { realSocket.destroy(); } catch {}
    };
    clientTls.on('error',  cleanup);
    clientTls.on('close',  cleanup);
    realSocket.on('error', cleanup);
    realSocket.on('close', cleanup);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.running) { resolve(); return; }

      try {
        this.initCA();
      } catch (err: any) {
        reject(new Error(`CA init failed: ${err.message}`));
        return;
      }

      this.installCA();

      this.server = http.createServer(this.handleHttp.bind(this));
      this.server.on('connect', this.handleConnect.bind(this));
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          this.log(`[Proxy] Port ${PROXY_PORT} already in use — proxy may already be running`);
          this.setSystemProxy();
          resolve();
        } else {
          this.log(`[Proxy] Server error: ${err.message}`);
          reject(err);
        }
      });

      this.server.listen(PROXY_PORT, '127.0.0.1', () => {
        this.running = true;
        this.log(`[Proxy] MITM proxy listening on localhost:${PROXY_PORT}`);
        this.setSystemProxy();
        resolve();
      });
    });
  }

  stop(): void {
    this.unsetSystemProxy();
    try { this.server?.close(); } catch {}
    this.running = false;
    this.log('[Proxy] Stopped');
  }
}
