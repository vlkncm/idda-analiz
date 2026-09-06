const { app, BrowserWindow, shell, screen } = require('electron');
const path = require('node:path');

let backend;
app.whenReady().then(async () => {
  process.env.IDDA_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.IDDA_ENV_FILE = path.join(path.dirname(process.execPath), '.env');
  process.env.PORT = '0';
  const { startServer, server } = require('./server'); backend = server;
  const port = await startServer(0);
  const displays = screen.getAllDisplays();
  const requestedDisplay = Math.max(1, Number(process.env.IDDA_DISPLAY || 1));
  const targetDisplay = displays[requestedDisplay - 1] || displays[0];
  const width = Math.min(1420, targetDisplay.workArea.width);
  const height = Math.min(920, targetDisplay.workArea.height);
  const win = new BrowserWindow({ x: targetDisplay.workArea.x + Math.round((targetDisplay.workArea.width - width) / 2), y: targetDisplay.workArea.y + Math.round((targetDisplay.workArea.height - height) / 2), width, height, minWidth: Math.min(940, width), minHeight: Math.min(650, height), backgroundColor: '#0b0e0d', title: 'İDDA Analiz Merkezi', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({url}) => { if(url.startsWith('https://')) shell.openExternal(url); return {action:'deny'}; });
  await win.loadURL(`http://127.0.0.1:${port}`);
});
app.on('window-all-closed', () => { if (backend) backend.close(); app.quit(); });
