const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
module.exports = {
  appId: 'com.puntodeventamo.pos',
  electronDownload: { cache: path.join(__dirname, '.electron-cache') },
  productName: 'Mi Caja C$',
  extraResources: [{ from: 'assets/mi-caja.ico', to: 'mi-caja.ico' }],
  afterPack: async context => {
    const exe = path.join(context.appOutDir, 'Mi Caja C$.exe');
    const rcedit = path.join(__dirname, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
    await execFileAsync(rcedit, [exe, '--set-icon', path.join(__dirname, 'assets', 'mi-caja.ico')]);
  },
  directories: { output: '../../outputs/instalador-windows' },
  files: ['main.cjs', 'preload.cjs', 'ventas-mi-negocio.html', 'package.json', 'assets/mi-caja.png'],
  win: {
    icon: path.join(__dirname, 'assets', 'mi-caja.ico'),
    signAndEditExecutable: false,
    target: [{ target: 'dir', arch: ['x64'] }],
    artifactName: 'Punto-de-Venta-MO-Setup-${version}.${ext}'
  },
};


