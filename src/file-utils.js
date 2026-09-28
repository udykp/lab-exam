const fs = require('fs');
const path = require('path');

async function handleSaveLocalFile(app, folderName, fileName, content, encoding = 'utf8') {
  try {
    const desktopPath = app.getPath('desktop');
    const studentFolder = path.join(desktopPath, folderName);
    if (!fs.existsSync(studentFolder)) {
      fs.mkdirSync(studentFolder, { recursive: true });
    }
    const filePath = path.join(studentFolder, fileName);
    if (encoding === 'base64') {
      fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(filePath, content, 'utf8');
    }
    console.log(`[ExamGuard] File successfully saved locally: ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    console.error('[ExamGuard] Failed to save file locally:', err);
    return { success: false, error: err.message };
  }
}

async function handleFetchTextUrl(url) {
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const text = await response.text();
          return { success: true, text };
        }
        console.warn(`[fetch-text-url] Attempt ${attempt} HTTP ${response.status}`);
      } catch (err) {
        console.warn(`[fetch-text-url] Attempt ${attempt} network error:`, err.message);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 600));
    }
    return { success: false, error: 'Failed to download dataset after 3 attempts' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleFetchBinaryUrl(url) {
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return { success: true, base64 };
        }
        console.warn(`[fetch-binary-url] Attempt ${attempt} HTTP ${response.status}`);
      } catch (err) {
        console.warn(`[fetch-binary-url] Attempt ${attempt} network error:`, err.message);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 600));
    }
    return { success: false, error: 'Failed to download file after 3 attempts' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function registerFileUtilsIPC(ipcMain, app) {
  ipcMain.handle('save-local-file', async (event, folderName, fileName, content, encoding = 'utf8') => {
    return handleSaveLocalFile(app, folderName, fileName, content, encoding);
  });
  ipcMain.handle('fetch-text-url', async (event, url) => {
    return handleFetchTextUrl(url);
  });
  ipcMain.handle('fetch-binary-url', async (event, url) => {
    return handleFetchBinaryUrl(url);
  });
}

module.exports = {
  handleSaveLocalFile,
  handleFetchTextUrl,
  handleFetchBinaryUrl,
  registerFileUtilsIPC
};
