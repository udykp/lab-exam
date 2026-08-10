const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onWindowFocusChanged: (callback) => {
    ipcRenderer.on('window-focus-changed', (event, value) => callback(value));
  },
  requestFullscreen: (fullscreen) => {
    ipcRenderer.send('request-fullscreen', fullscreen);
  },
  lockExamWindow: () => {
    ipcRenderer.send('lock-exam-window');
  },
  unlockExamWindow: () => {
    ipcRenderer.send('unlock-exam-window');
  },
  exitApp: () => {
    ipcRenderer.send('exit-app');
  },
  saveLocalFile: (folderName, fileName, content) => {
    return ipcRenderer.invoke('save-local-file', folderName, fileName, content);
  }
});
