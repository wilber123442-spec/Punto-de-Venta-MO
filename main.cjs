const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

app.setName('Punto de Venta MO');
// Keep business data separate from the program files so reinstalling preserves it.
app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Punto de Venta MO'));
const UPDATE_OWNER = 'wilber123442-spec';
const UPDATE_REPOSITORY = 'punto-de-venta-mo';
const CURRENT_VERSION = require('./package.json').version;
const initialCurrencyPath = path.join(app.getPath('userData'), 'initial-currency.txt');
let initialCurrency = null;
try {
  initialCurrency = fs.readFileSync(initialCurrencyPath, 'utf8').trim();
  fs.unlinkSync(initialCurrencyPath);
} catch {}
let mainWindow;
let downloadedInstallerPath = null;

function report(state, text) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pos-update-status', { state, text });
}

function compareVersions(left, right) {
  const a = String(left).replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = String(right).replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i++) {
    const difference = (a[i] || 0) - (b[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

async function checkForAppUpdate() {
  if (!app.isPackaged) {
    report('not-configured', 'Las actualizaciones están disponibles en la versión instalada de Windows.');
    return false;
  }

  report('checking', 'Buscando actualizaciones…');
  try {
    const releaseUrl = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/latest`;
    const releaseResponse = await fetch(releaseUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Punto-de-Venta-MO-Updater' },
      signal: AbortSignal.timeout(30000)
    });
    if (releaseResponse.status === 404) {
      report('not-configured', 'El canal está listo, pero todavía no se ha publicado la primera versión.');
      return false;
    }
    if (!releaseResponse.ok) throw new Error(`GitHub respondió con el código ${releaseResponse.status}.`);

    const release = await releaseResponse.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!latestVersion) throw new Error('La publicación no indica su número de versión.');
    if (compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
      downloadedInstallerPath = null;
      report('current', `Ya tienes la versión más reciente (${CURRENT_VERSION}).`);
      return false;
    }

    const asset = (release.assets || []).find(item =>
      /^Punto-de-Venta-MO-Setup-[\d.]+\.exe$/i.test(item.name || '')
    );
    if (!asset?.browser_download_url) throw new Error(`Se encontró la versión ${latestVersion}, pero falta su instalador de Windows.`);

    const downloadResponse = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!downloadResponse.ok || !downloadResponse.body) throw new Error('No se pudo descargar el instalador.');

    const updateDirectory = path.join(app.getPath('userData'), 'updates');
    fs.mkdirSync(updateDirectory, { recursive: true });
    const targetPath = path.join(updateDirectory, path.basename(asset.name));
    const totalBytes = Number(asset.size || downloadResponse.headers.get('content-length') || 0);
    let downloadedBytes = 0;
    const progress = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        const percent = totalBytes ? Math.min(100, Math.round(downloadedBytes / totalBytes * 100)) : 0;
        report('downloading', `Descargando versión ${latestVersion}: ${percent}%`);
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(downloadResponse.body), progress, fs.createWriteStream(targetPath));
    downloadedInstallerPath = targetPath;
    report('downloaded', `La versión ${latestVersion} está lista. Pulsa “Instalar actualización” para aplicarla.`);
    return true;
  } catch (error) {
    report('error', `No se pudo revisar o descargar la actualización: ${error.message}`);
    throw error;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    icon: path.join(process.resourcesPath, 'punto-venta-mo.ico'),
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f8f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'ventas-mi-negocio.html'), {
    query: initialCurrency ? { initialCurrency } : undefined
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('pos-check-updates', () => checkForAppUpdate());

ipcMain.handle('pos-install-update', () => {
  if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
    report('error', 'Primero busca y descarga una actualización disponible.');
    return false;
  }
  const installer = spawn(downloadedInstallerPath, [], { detached: true, stdio: 'ignore' });
  installer.once('error', error => report('error', `No se pudo abrir el instalador: ${error.message}`));
  installer.once('spawn', () => {
    installer.unref();
    app.quit();
  });
  return true;
});

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => checkForAppUpdate().catch(() => {}), 12000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
