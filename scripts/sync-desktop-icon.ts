import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const svgPath = resolve(root, 'public', 'token-work-icon.svg');
const pngPath = resolve(root, 'public', 'token-work-icon.png');
const iconsetDir = resolve(root, 'public', 'token-work-icon.iconset');
const icnsPath = resolve(root, 'public', 'token-work-icon.icns');
const electronIcnsPath = resolve(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Resources', 'electron.icns');

if (process.platform !== 'darwin') {
  ensureBundledPng();
  console.log('Desktop icon sync skipped: native Electron app icon patching is only needed on macOS.');
  process.exit(0);
}

ensureBundledPng();
syncMacIcon();

function ensureBundledPng() {
  if (existsSync(pngPath)) return;
  throw new Error(`Missing bundled PNG icon: ${pngPath}`);
}

function syncMacIcon() {
  if (!existsSync(svgPath)) {
    throw new Error(`Missing icon source: ${svgPath}`);
  }

  let pngRegenerated = false;
  if (commandExists('qlmanage')) {
    pngRegenerated = runOptional('qlmanage', ['-t', '-s', '1024', '-o', 'public', svgPath]);
    const qlPngPath = resolve(root, 'public', 'token-work-icon.svg.png');
    if (existsSync(qlPngPath)) {
      copyFileSync(qlPngPath, pngPath);
      rmSync(qlPngPath, { force: true });
      pngRegenerated = true;
    }
  } else {
    console.log('Skipping PNG regeneration: qlmanage is unavailable.');
  }
  if (!existsSync(pngPath)) {
    throw new Error(`Failed to generate PNG icon: ${pngPath}`);
  }
  if (!pngRegenerated && existsSync(icnsPath)) {
    syncElectronIcns();
    return;
  }
  if (!commandExists('sips') || !commandExists('iconutil')) {
    console.log('Skipping macOS ICNS sync: sips or iconutil is unavailable.');
    return;
  }

  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });

  let iconsetReady = true;
  for (const [name, size] of [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ]) {
    if (!runOptional('sips', ['-z', String(size), String(size), pngPath, '--out', resolve(iconsetDir, name)])) {
      iconsetReady = false;
      break;
    }
  }

  if (iconsetReady) {
    runOptional('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
  }
  rmSync(iconsetDir, { recursive: true, force: true });

  syncElectronIcns();
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status ?? 'unknown'}`);
  }
}

function runOptional(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    console.log(`${command} failed; using the bundled desktop icon assets instead.`);
    return false;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return true;
}

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function syncElectronIcns() {
  if (!existsSync(icnsPath)) {
    console.log('Skipping Electron app icon sync: bundled ICNS is unavailable.');
    return;
  }
  if (existsSync(electronIcnsPath)) {
    copyFileSync(icnsPath, electronIcnsPath);
    console.log(`Synced Electron app icon: ${electronIcnsPath}`);
  } else {
    console.log('Electron app is not installed yet; bundled ICNS is ready.');
  }
}
