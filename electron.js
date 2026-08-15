const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

let backend;
app.whenReady().then(async () => {
  process.env.IDDA_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.PORT = '0';
  const { startServer, server } = require('./server'); backend = server;
  const port = await startServer(0);
  const win = new BrowserWindow({ width: 1420, height: 920, minWidth: 940, minHeight: 650, backgroundColor: '#0b0e0d', title: 'İDDA Analiz Merkezi', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({url}) => { if(url.startsWith('https://')) shell.openExternal(url); return {action:'deny'}; });
  await win.loadURL(`http://127.0.0.1:${port}`);
});
app.on('window-all-closed', () => { if (backend) backend.close(); app.quit(); });
