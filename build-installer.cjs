const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const projectDir = __dirname;
const packageInfo = require(path.join(projectDir, 'package.json'));
const appDir = path.resolve(projectDir, '..', '..', 'outputs', 'instalador-windows', 'win-unpacked');
const resourcesDir = path.join(appDir, 'resources');
const iconPath = path.join(projectDir, 'assets', 'punto-venta-mo.ico');
const rceditPath = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const asarPath = path.join(resourcesDir, 'app.asar');
const asarCli = path.join(projectDir, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
const extractedApp = path.join(projectDir, `.asar-installer-${Date.now()}`);
const payloadPath = path.join(projectDir, `.payload-${packageInfo.version}.zip`);
const installerPath = path.resolve(projectDir, '..', '..', 'outputs', 'instalador-windows', `Punto-de-Venta-MO-Setup-${packageInfo.version}.exe`);
const generatedBootstrapPath = path.join(projectDir, `.installer-bootstrapper-${packageInfo.version}.cs`);
const exeName = 'Punto de Venta MO.exe';

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  if (!fs.existsSync(path.join(appDir, exeName)) || !fs.existsSync(asarPath)) {
    throw new Error('No se encontró el programa empaquetado.');
  }

  fs.mkdirSync(extractedApp);
  await execFileAsync(process.execPath, [asarCli, 'extract', asarPath, extractedApp]);
  for (const file of ['main.cjs', 'package.json', 'ventas-mi-negocio.html']) {
    fs.copyFileSync(path.join(projectDir, file), path.join(extractedApp, file));
  }
  await execFileAsync(process.execPath, [asarCli, 'pack', extractedApp, path.join(resourcesDir, 'app-build.asar')]);
  fs.renameSync(path.join(resourcesDir, 'app-build.asar'), asarPath);
  fs.copyFileSync(iconPath, path.join(resourcesDir, 'punto-venta-mo.ico'));
  await execFileAsync(rceditPath, [path.join(appDir, exeName), '--set-icon', iconPath]);

  const powershell = `Compress-Archive -Path ${psQuote(path.join(appDir, '*'))} -DestinationPath ${psQuote(payloadPath)} -CompressionLevel Optimal -Force`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { maxBuffer: 1024 * 1024 });

  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(compiler)) throw new Error('No se encontró el compilador de Windows para crear Setup.exe.');
  const assemblyVersion = packageInfo.version.split('.').slice(0, 3).concat('0').join('.');
  const bootstrapSource = fs.readFileSync(path.join(projectDir, 'installer-bootstrapper.cs'), 'utf8')
    .replace(/AssemblyVersion\("[^"]+"\)/, `AssemblyVersion("${assemblyVersion}")`)
    .replace(/AssemblyFileVersion\("[^"]+"\)/, `AssemblyFileVersion("${assemblyVersion}")`)
    .replace(/key\.SetValue\("DisplayVersion", "[^"]+"\);/, `key.SetValue("DisplayVersion", "${packageInfo.version}");`);
  fs.writeFileSync(generatedBootstrapPath, bootstrapSource, 'utf8');
  const compileArgs = [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    `/win32icon:${iconPath}`,
    `/out:${installerPath}`,
    `/resource:${payloadPath},APP_ARCHIVE`,
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    generatedBootstrapPath
  ];
  await execFileAsync(compiler, compileArgs, { maxBuffer: 1024 * 1024 });
  fs.rmSync(generatedBootstrapPath, { force: true });

  const stats = fs.statSync(installerPath);
  if (stats.size < fs.statSync(payloadPath).size) throw new Error('Setup.exe quedó incompleto.');
  console.log(installerPath);
  console.log(`${(stats.size / (1024 * 1024)).toFixed(1)} MB`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
