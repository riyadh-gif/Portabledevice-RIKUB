const { contextBridge, ipcRenderer } = require('electron');

// Expose safe API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigation
  loadPage: (pageName) => {
    // No IPC needed, use location.href in renderer
  },

  // You can add more APIs here if needed
  // Example: window management, file dialogs, etc.
});
