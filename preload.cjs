const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posUpdates', {
  check: () => ipcRenderer.invoke('pos-check-updates'),
  install: () => ipcRenderer.invoke('pos-install-update'),
  onStatus: callback => ipcRenderer.on('pos-update-status', (_event, message) => callback(message))
});
