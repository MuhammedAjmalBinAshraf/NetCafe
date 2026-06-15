import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

if (!window.ipcRenderer) {
  const serverHost = window.location.hostname;
  const apiPort = window.location.port === '5173' ? '9001' : window.location.port || '9001';
  const apiBase = `${window.location.protocol}//${serverHost}:${apiPort}`;

  (window as any).ipcRenderer = {
    isBrowserBridge: true,
    on: (channel: string, _listener: (...args: any[]) => void) => {
      console.warn(`ipcRenderer.on('${channel}') called in browser. Subscriptions are not fully supported over HTTP-IPC Bridge.`);
    },
    off: (_channel: string, _listener: (...args: any[]) => void) => {},
    send: (channel: string, ...args: any[]) => {
      console.warn(`ipcRenderer.send('${channel}') called in browser. Sending as async invoke instead.`);
      fetch(`${apiBase}/api/ipc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, args })
      }).catch(err => console.error('IPC bridge send error:', err));
    },
    invoke: async (channel: string, ...args: any[]) => {
      try {
        const res = await fetch(`${apiBase}/api/ipc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, args })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err: any) {
        console.error(`IPC bridge invoke('${channel}') error:`, err);
        throw err;
      }
    }
  };
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
