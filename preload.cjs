const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posUpdates', {
  check: () => ipcRenderer.invoke('pos-check-updates'),
  getInitialAdmin: () => ipcRenderer.invoke('pos-get-initial-admin'),
  completeInitialAdmin: () => ipcRenderer.invoke('pos-complete-initial-admin'),
  openUpdatePage: () => ipcRenderer.invoke('pos-open-update-page'),
  lanStatus: () => ipcRenderer.invoke('pos-lan-status'),
  lanStartHost: payload => ipcRenderer.invoke('pos-lan-start-host', payload),
  lanConnect: details => ipcRenderer.invoke('pos-lan-connect', details),
  lanGetSnapshot: () => ipcRenderer.invoke('pos-lan-get-snapshot'),
  lanSaveSnapshot: update => ipcRenderer.invoke('pos-lan-save-snapshot', update),
  lanDisconnect: () => ipcRenderer.invoke('pos-lan-disconnect'),
  onStatus: callback => ipcRenderer.on('pos-update-status', (_event, message) => callback(message))
});

