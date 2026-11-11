const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');

app.setName('Mi Caja C$');
// Keep business data separate from the program files so reinstalling preserves it.
app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Punto de Venta MO'));
const UPDATE_OWNER = 'wilber123442-spec';
const UPDATE_REPOSITORY = 'punto-de-venta-mo';
const CURRENT_VERSION = require('./package.json').version;
let latestInstallerUrl = null;
const initialCurrencyPath = path.join(app.getPath('userData'), 'initial-currency.txt');
let initialCurrency = null;
try {
  initialCurrency = fs.readFileSync(initialCurrencyPath, 'utf8').trim();
  fs.unlinkSync(initialCurrencyPath);
} catch {}
let mainWindow;
const initialAdminPath = path.join(app.getPath('userData'), 'initial-admin.txt');
const lanConfigPath = path.join(app.getPath('userData'), 'lan-config.bin');
const lanSnapshotPath = path.join(app.getPath('userData'), 'shared-inventory.json');
const LAN_PORT = 38745;
let lanConfig = null;
let lanServer = null;
let lanRevision = 0;
let lanPayload = null;
let initialAdmin = null;
try {
  const values = fs.readFileSync(initialAdminPath, 'utf8').split(/\r?\n/);
  const decode = value => Buffer.from(value || '', 'base64').toString('utf8');
  if (values.length >= 4) {
    const [businessName, name, username, password] = values.slice(0, 4).map(decode);
    if (businessName && name && username && password.length >= 6)
      initialAdmin = { businessName, name, username, password };
  }
} catch {}

function readLanConfig() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(lanConfigPath)));
  } catch { return null; }
}

function writeLanConfig(config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no pudo proteger la clave de conexión en esta computadora.');
  const temporary = lanConfigPath + '.tmp';
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(config)));
  fs.renameSync(temporary, lanConfigPath);
  lanConfig = config;
}

function privateAddresses() {
  const addresses = [];
  for (const rows of Object.values(os.networkInterfaces())) for (const item of rows || []) {
    if (item.family !== 'IPv4' || item.internal) continue;
    const octets = item.address.split('.').map(Number);
    if (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)) addresses.push(item.address);
  }
  return [...new Set(addresses)];
}

function readLanSnapshot() {
  try {
    const value = JSON.parse(fs.readFileSync(lanSnapshotPath, 'utf8'));
    if (Number.isInteger(value.revision) && value.payload && typeof value.payload === 'object') {
      lanRevision = value.revision;
      lanPayload = value.payload;
    }
  } catch {}
}

function persistLanSnapshot(payload) {
  const next = { revision: lanRevision + 1, payload };
  const temporary = lanSnapshotPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, lanSnapshotPath);
  lanRevision = next.revision;
  lanPayload = payload;
}

function sendLanJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  });
  if (status === 204) response.end();
  else response.end(JSON.stringify(value));
}

function startLanServer() {
  if (lanServer?.listening) return Promise.resolve();
  readLanSnapshot();
  const bindAddress = privateAddresses()[0];
  if (!bindAddress) throw new Error('Conecta la computadora principal al Wi‑Fi del negocio antes de activar el inventario compartido.');
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') return sendLanJson(response, 204, {});
    if (request.url === '/api/health' && request.method === 'GET') return sendLanJson(response, 200, { ok: true, name: 'Mi Caja C$', revision: lanRevision });
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!lanConfig?.token || supplied !== lanConfig.token) return sendLanJson(response, 401, { error: 'Código de conexión incorrecto.' });
    if (request.url === '/api/snapshot' && request.method === 'GET') {
      if (!lanPayload) return sendLanJson(response, 404, { error: 'La computadora principal todavía no ha preparado el inventario compartido.' });
      return sendLanJson(response, 200, { revision: lanRevision, payload: lanPayload });
    }
    if (request.url === '/api/snapshot' && request.method === 'PUT') {
      let body = '';
      try {
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 32 * 1024 * 1024) return sendLanJson(response, 413, { error: 'El respaldo supera el tamaño permitido.' });
        }
        const update = JSON.parse(body);
        if (!Number.isInteger(update.expectedRevision) || !update.payload || typeof update.payload !== 'object' || !update.payload.state || !Array.isArray(update.payload.state.products) || !Array.isArray(update.payload.state.sales)) return sendLanJson(response, 400, { error: 'Los datos de la caja no tienen un formato válido.' });
        if (lanPayload && update.payload.businessId !== lanPayload.businessId) return sendLanJson(response, 403, { error: 'El negocio de esta caja no coincide con el inventario principal.' });
        if (update.expectedRevision !== lanRevision) return sendLanJson(response, 409, { error: 'Otra caja guardó cambios primero. Se actualizará el inventario antes de continuar.', revision: lanRevision, payload: lanPayload });
        persistLanSnapshot(update.payload);
        return sendLanJson(response, 200, { revision: lanRevision });
      } catch (error) {
        return sendLanJson(response, 400, { error: error.message || 'No se pudieron guardar los datos compartidos.' });
      }
    }
    return sendLanJson(response, 404, { error: 'Ruta no encontrada.' });
  });
  lanServer = server;
  return new Promise((resolve, reject) => {
    const failed = error => { lanServer = null; console.error('Servidor de red local:', error); reject(new Error('No se pudo abrir la conexión local. Verifica que el puerto esté libre y permite Mi Caja en el aviso del firewall de Windows.')); };
    server.once('error', failed);
    server.listen(LAN_PORT, bindAddress, () => { server.removeListener('error', failed); server.on('error', error => { console.error('Servidor de red local:', error); report('error', 'Se perdió la conexión de red compartida.'); }); resolve(); });
  });
}

async function requestLanSnapshot(config) {
  const response = await fetch(`${config.url.replace(/\/$/, '')}/api/snapshot`, {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo leer el inventario compartido.');
  return result;
}

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
      latestInstallerUrl = null;
      report('current', `Ya tienes la versión más reciente (${CURRENT_VERSION}).`);
      return false;
    }

    const asset = (release.assets || []).find(item =>
      /^Punto-de-Venta-MO-Setup-[\d.]+\.exe$/i.test(item.name || '')
    );
    if (!asset?.browser_download_url) throw new Error(`Se encontró la versión ${latestVersion}, pero falta su instalador de Windows.`);
    latestInstallerUrl = asset.browser_download_url;
    report('available', `La versión ${latestVersion} está lista. Pulsa “Descargar actualización” para abrir el navegador; tus datos se conservan al instalarla.`);
    return true;
  } catch (error) {
    report('error', `No se pudo revisar o descargar la actualización: ${error.message}`);
    throw error;
  }
}

ipcMain.handle('pos-open-update-page', async () => {
  if (!latestInstallerUrl) await checkForAppUpdate();
  if (!latestInstallerUrl) return false;
  await shell.openExternal(latestInstallerUrl);
  report('opening-download', 'Se abrió el navegador. Descarga el instalador y ejecútalo para actualizar Mi Caja.');
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    icon: path.join(process.resourcesPath, 'mi-caja.ico'),
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
ipcMain.handle('pos-get-initial-admin', () => initialAdmin);
ipcMain.handle('pos-complete-initial-admin', () => {
  try { fs.rmSync(initialAdminPath, { force: true }); } catch {}
  initialAdmin = null;
  return true;
});

ipcMain.handle('pos-lan-status', () => {
  if (!lanConfig) return { mode: 'off' };
  if (lanConfig.mode === 'host') return { mode: 'host', addresses: privateAddresses().slice(0, 1), port: LAN_PORT, token: lanConfig.token };
  return { mode: 'client', url: lanConfig.url };
});

ipcMain.handle('pos-lan-start-host', async (_event, payload) => {
  if (!payload || !payload.businessId || !payload.state || !Array.isArray(payload.state.products) || !Array.isArray(payload.state.sales)) throw new Error('No se pudieron preparar los datos del negocio para compartir.');
  if (lanConfig?.mode === 'client') throw new Error('Esta caja está conectada a otra computadora principal. Desconéctala primero.');
  readLanSnapshot();
  if (!lanPayload) {
    const backupPath = path.join(app.getPath('userData'), `respaldo-antes-de-compartir-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    persistLanSnapshot(payload);
  }
  else if (lanPayload.businessId !== payload.businessId) throw new Error('Ya existe un inventario compartido de otro negocio en esta computadora.');
  const config = lanConfig?.mode === 'host' ? lanConfig : { mode: 'host', token: crypto.randomBytes(24).toString('base64url') };
  writeLanConfig(config);
  await startLanServer();
  return { mode: 'host', addresses: privateAddresses().slice(0, 1), port: LAN_PORT, token: config.token, revision: lanRevision };
});

ipcMain.handle('pos-lan-connect', async (_event, details) => {
  const url = String(details?.url || '').trim().replace(/\/$/, '');
  const token = String(details?.token || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Escribe la dirección que muestra la computadora principal.'); }
  const host = parsed.hostname;
  const octets = host.split('.').map(Number);
  const privateIPv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  if (parsed.protocol !== 'http:' || !privateIPv4 || !token) throw new Error('Usa la dirección IPv4 privada y el código que aparecen en la computadora principal.');
  const candidate = { mode: 'client', url, token };
  const healthResponse = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
  const health = await healthResponse.json();
  if (!healthResponse.ok || !health.ok) throw new Error('No se encontró Mi Caja en esa dirección. Revisa que ambas computadoras estén en el mismo Wi‑Fi.');
  const snapshot = await requestLanSnapshot(candidate);
  if (!snapshot.payload?.businessId || !snapshot.payload?.accounts || !Array.isArray(snapshot.payload.state?.products)) throw new Error('La computadora principal respondió con datos incompletos.');
  writeLanConfig(candidate);
  return snapshot;
});

ipcMain.handle('pos-lan-get-snapshot', async () => {
  if (!lanConfig) return null;
  if (lanConfig.mode === 'host') { if (!lanServer?.listening) await startLanServer(); return lanPayload ? { revision: lanRevision, payload: lanPayload } : null; }
  return requestLanSnapshot(lanConfig);
});

ipcMain.handle('pos-lan-save-snapshot', async (_event, update) => {
  if (!lanConfig) return { ok: false, disconnected: true };
  if (!update || !Number.isInteger(update.expectedRevision) || !update.payload) throw new Error('Los datos compartidos no tienen un formato válido.');
  if (lanConfig.mode === 'host') {
    if (update.expectedRevision !== lanRevision) return { ok: false, conflict: true, revision: lanRevision, payload: lanPayload };
    if (lanPayload && update.payload.businessId !== lanPayload.businessId) throw new Error('El negocio de esta caja no coincide con el inventario principal.');
    persistLanSnapshot(update.payload);
    return { ok: true, revision: lanRevision };
  }
  const response = await fetch(`${lanConfig.url}/api/snapshot`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${lanConfig.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(7000)
  });
  const result = await response.json();
  if (response.status === 409) return { ok: false, conflict: true, revision: result.revision, payload: result.payload };
  if (!response.ok) throw new Error(result.error || 'No se pudieron guardar los datos en la computadora principal.');
  return { ok: true, revision: result.revision };
});

ipcMain.handle('pos-lan-disconnect', () => {
  if (lanServer) { lanServer.close(); lanServer = null; }
  try { fs.rmSync(lanConfigPath, { force: true }); } catch {}
  lanConfig = null;
  return true;
});

app.whenReady().then(async () => {
  lanConfig = readLanConfig();
  if (lanConfig?.mode === 'host') { try { await startLanServer(); } catch (error) { console.error(error); } }
  createWindow();
  setTimeout(() => checkForAppUpdate().catch(() => {}), 12000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

