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
  },
  // Local code execution
  runCode: (code, language) => {
    ipcRenderer.send('run-code', { code, language });
  },
  stopCode: () => {
    ipcRenderer.send('stop-code');
  },
  onCodeOutput: (callback) => {
    ipcRenderer.on('code-output', (event, data) => callback(data));
  },
  onCodeExit: (callback) => {
    ipcRenderer.on('code-exit', (event, data) => callback(data));
  },
  removeCodeListeners: () => {
    ipcRenderer.removeAllListeners('code-output');
    ipcRenderer.removeAllListeners('code-exit');
  },
  sendStdin: (text) => {
    ipcRenderer.send('code-stdin', text);
  }
});
