import { contextBridge, ipcRenderer } from 'electron'

const api = {
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args);
  },
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args);
  }
};

const electronAPI = {
  onUpdateStatus: (cb: Function) => {
    const subscription = (_event: any, payload: any) => cb(payload);
    ipcRenderer.on('update-status', subscription);
    return () => {
      ipcRenderer.off('update-status', subscription);
    };
  },
  triggerUpdate: (machineId: any) =>
    ipcRenderer.invoke('trigger-client-update', machineId)
};

try {
  contextBridge.exposeInMainWorld('ipcRenderer', api);
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} catch (e) {
  (window as any).ipcRenderer = api;
  (window as any).electronAPI = electronAPI;
}

