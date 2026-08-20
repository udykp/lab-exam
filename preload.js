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
  minimizeApp: () => {
    ipcRenderer.send('minimize-app');
  },
  saveLocalFile: (folderName, fileName, content, encoding = 'utf8') => {
    return ipcRenderer.invoke('save-local-file', folderName, fileName, content, encoding);
  },
  // Local code execution
  runCode: (code, language, attachments = []) => {
    ipcRenderer.send('run-code', { code, language, attachments });
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
  },
  getServerUrl: () => {
    return ipcRenderer.invoke('get-server-url');
  },
  runPipInstall: (packages) => {
    ipcRenderer.send('run-pip-install', packages);
  },
  onPipExit: (callback) => {
    ipcRenderer.on('pip-exit', (event, data) => callback(data));
  },
  removePipListeners: () => {
    ipcRenderer.removeAllListeners('pip-exit');
  },
  onPlotUpdated: (callback) => {
    ipcRenderer.on('plot-updated', (event, data) => callback(data));
  },
  removePlotListeners: () => {
    ipcRenderer.removeAllListeners('plot-updated');
  }
});
