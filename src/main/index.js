const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,      // Security best practice
      contextIsolation: true,       // Security best practice
      preload: path.join(__dirname, '../preload/preload.js')
    }
  });

  // Load splash screen
  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/splash.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Toggle fullscreen with F11, exit with ESC
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11') {
        event.preventDefault();
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
        event.preventDefault();
        mainWindow.setFullScreen(false);
      }
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Export for IPC handlers if needed
module.exports = { getMainWindow: () => mainWindow };
