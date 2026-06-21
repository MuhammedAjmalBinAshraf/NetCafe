const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let islandWindow = null;

function createIslandWindow(sessionData) {
  if (islandWindow && !islandWindow.isDestroyed()) {
    return islandWindow;
  }

  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workAreaSize;
  const displayBounds = primary.bounds;

  islandWindow = new BrowserWindow({
    width: 400,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Display on top of full-screen games/apps if possible
  try { islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
  try { islandWindow.setAlwaysOnTop(true, 'screen-saver', 2); } catch (e) {}
  try { islandWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (e) {}

  // Center horizontally, position at top of primary screen
  const x = Math.round(displayBounds.x + (workArea.width - 400) / 2);
  const y = displayBounds.y;
  islandWindow.setPosition(x, y);

  // Load our dynamic-island.html component
  islandWindow.loadFile(path.join(__dirname, 'dynamic-island.html'));

  islandWindow.on('closed', () => {
    islandWindow = null;
  });

  // Send initial session data when page finishes loading
  islandWindow.webContents.on('did-finish-load', () => {
    if (sessionData) {
      islandWindow.webContents.send('session-update', sessionData);
    }
  });

  return islandWindow;
}

function destroyIslandWindow() {
  if (islandWindow) {
    try {
      if (!islandWindow.isDestroyed()) {
        islandWindow.destroy();
      }
    } catch (e) {}
    islandWindow = null;
  }
}

// IPC resize listener to resize content and center it horizontally at the top of the primary display
ipcMain.on('resize', (event, { width, height }) => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      islandWindow.setSize(width, height);
      const primary = screen.getPrimaryDisplay();
      const workArea = primary.workAreaSize;
      const displayBounds = primary.bounds;
      const x = Math.round(displayBounds.x + (workArea.width - width) / 2);
      const y = displayBounds.y;
      islandWindow.setPosition(x, y);
    } catch (e) {
      console.error('Failed to resize island:', e);
    }
  }
});

// IPC ignore mouse events listener
ipcMain.on('island-mouse', (event, ignore) => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      islandWindow.setIgnoreMouseEvents(ignore, { forward: true });
    } catch (e) {
      console.error('Failed to set ignore mouse events:', e);
    }
  }
});

module.exports = {
  createIslandWindow,
  destroyIslandWindow,
  getIslandWindow: () => islandWindow
};
