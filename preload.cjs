const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posUpdates', {
  check: () => ipcRenderer.invoke('pos-check-updates'),
  install: state => ipcRenderer.invoke('pos-install-update', state),
  getUpdateResumeState: () => ipcRenderer.invoke('pos-get-update-resume-state'),
  getInitialAdmin: () => ipcRenderer.invoke('pos-get-initial-admin'),
  completeInitialAdmin: () => ipcRenderer.invoke('pos-complete-initial-admin'),
  onStatus: callback => ipcRenderer.on('pos-update-status', (_event, message) => callback(message))
});

