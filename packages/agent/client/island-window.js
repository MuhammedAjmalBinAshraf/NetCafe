const { BrowserWindow, screen, ipcMain, powerMonitor } = require('electron');
const path = require('path');

let islandWindow = null;
let currentXPosition = 'centre';

function repositionIsland() {
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      const primary = screen.getPrimaryDisplay();
      const displayBounds = primary.bounds;
      islandWindow.setBounds({
        x: displayBounds.x,
        y: displayBounds.y + 12,
        width: displayBounds.width,
        height: 350
      });
    } catch (e) {
      console.error('Failed to position island:', e);
    }
  }
}

function createIslandWindow(sessionData) {
  if (islandWindow && !islandWindow.isDestroyed()) {
    return islandWindow;
  }

  const primary = screen.getPrimaryDisplay();
  const displayBounds = primary.bounds;

  islandWindow = new BrowserWindow({
    width: displayBounds.width,
    height: 350,
    x: displayBounds.x,
    y: displayBounds.y + 12,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    movable: false,
    type: 'toolbar',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Display on top of full-screen games/apps if possible
  try { islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
  try { islandWindow.setAlwaysOnTop(true, 'screen-saver', 2); } catch (e) {}
  try { islandWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (e) {}

  // Position dynamic island on primary display
  repositionIsland();

  // Load our dynamic-island.html component
  islandWindow.loadFile(path.join(__dirname, 'dynamic-island.html'));

  islandWindow.on('closed', () => {
    islandWindow = null;
  });

  // Block F11, Escape, Alt+F4 to prevent bypassing blackout/lock
  islandWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' || (input.alt && input.key === 'F4') || input.key === 'Escape') {
      event.preventDefault();
    }
  });

  // Send initial session data when page finishes loading
  islandWindow.webContents.on('did-finish-load', () => {
    if (sessionData) {
      islandWindow.webContents.send('session-update', sessionData);
    }
  });

  return islandWindow;
}

let isAnnouncementBlocking = false;

// Keep it permanent and visible, auto-restoring if minimized or hidden, resetting always-on-top.
setInterval(() => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      if (islandWindow.isMinimized()) {
        islandWindow.restore();
      }
      if (!islandWindow.isVisible()) {
        islandWindow.showInactive();
      }
      if (isAnnouncementBlocking) {
        islandWindow.setKiosk(true);
        islandWindow.setFullScreen(true);
        islandWindow.setAlwaysOnTop(true, 'screen-saver', 3);
        islandWindow.focus();
      } else {
        islandWindow.setAlwaysOnTop(true, 'screen-saver', 2);
      }
    } catch (e) {
      console.error('Failed to keep island on top:', e);
    }
  }
}, 1000); // Shorter check interval for prompt lockdown response

// Watch for system wakeup/unlock events to show/restore the window
powerMonitor.on('resume', () => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.showInactive();
    if (isAnnouncementBlocking) {
      islandWindow.setKiosk(true);
      islandWindow.setFullScreen(true);
      islandWindow.setAlwaysOnTop(true, 'screen-saver', 3);
      islandWindow.focus();
    } else {
      islandWindow.setAlwaysOnTop(true, 'screen-saver', 2);
    }
  }
});
powerMonitor.on('unlock-screen', () => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.showInactive();
    if (isAnnouncementBlocking) {
      islandWindow.setKiosk(true);
      islandWindow.setFullScreen(true);
      islandWindow.setAlwaysOnTop(true, 'screen-saver', 3);
      islandWindow.focus();
    } else {
      islandWindow.setAlwaysOnTop(true, 'screen-saver', 2);
    }
  }
});

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

// IPC resize listener (no longer resizes BrowserWindow since it's full-width)
ipcMain.on('resize', (event, { width, height }) => {
  // Keeping window full-width, no resize needed
});

// IPC listener for moving dynamic island horizontally (HTML positioning handles the alignment)
ipcMain.on('move-island', (event, position) => {
  currentXPosition = position;
});

// IPC ignore mouse events listener
ipcMain.on('island-mouse', (event, ignore) => {
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      // Never ignore mouse events if we are blocking input for announcements
      const shouldIgnore = isAnnouncementBlocking ? false : ignore;
      islandWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    } catch (e) {
      console.error('Failed to set ignore mouse events:', e);
    }
  }
});

// IPC listener for announcement blocking — expand window to full screen to swallow all clicks
ipcMain.on('set-announcement-blocking', (event, blocking) => {
  isAnnouncementBlocking = blocking;
  if (islandWindow && !islandWindow.isDestroyed()) {
    try {
      if (blocking) {
        const primary = screen.getPrimaryDisplay();
        const { x, y, width, height } = primary.bounds;
        islandWindow.setBounds({ x, y, width, height });
        islandWindow.setKiosk(true);
        islandWindow.setFullScreen(true);
        islandWindow.setIgnoreMouseEvents(false);
        islandWindow.setAlwaysOnTop(true, 'screen-saver', 3);
        islandWindow.focus();
      } else {
        islandWindow.setKiosk(false);
        islandWindow.setFullScreen(false);
        // Restore normal position
        repositionIsland();
        islandWindow.setIgnoreMouseEvents(true, { forward: true });
        islandWindow.setAlwaysOnTop(true, 'screen-saver', 2);
      }
    } catch (e) {
      console.error('Failed to toggle announcement blocking:', e);
    }
  }
});

module.exports = {
  createIslandWindow,
  destroyIslandWindow,
  getIslandWindow: () => islandWindow
};
