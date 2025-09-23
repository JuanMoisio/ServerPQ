// scripts/copy-electron.js
// Copia los archivos relevantes del build de electron (tsc) a dist-electron
const fs = require('fs');
const path = require('path');

function copyIfExists(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    const dir = path.dirname(dst);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('copied', src, '->', dst);
    return true;
  } catch (e) {
    console.warn('copy failed', src, e && e.message);
    return false;
  }
}

const root = process.cwd();
const out = path.resolve(root, 'dist-electron');
const srcDir = path.resolve(root, 'electron');
const buildDir = path.resolve(root, 'dist-electron', 'electron');

// Ensure out dirs
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

// Files to copy from electron/ (compiled by tsc into dist-electron/electron in many setups)
const candidates = [
  { from: path.resolve(root, 'dist-electron', 'electron', 'main.js'), to: path.resolve(out, 'electron', 'main.js') },
  { from: path.resolve(root, 'dist-electron', 'electron', 'preload.js'), to: path.resolve(out, 'electron', 'preload.js') },
  { from: path.resolve(root, 'dist-electron', 'electron', 'security.js'), to: path.resolve(out, 'electron', 'security.js') },
  // fallback: if electron/ was not compiled to dist-electron/electron but to electron/*.js
  { from: path.resolve(root, 'electron', 'main.js'), to: path.resolve(out, 'electron', 'main.js') },
  { from: path.resolve(root, 'electron', 'preload.js'), to: path.resolve(out, 'electron', 'preload.js') },
  { from: path.resolve(root, 'electron', 'security.js'), to: path.resolve(out, 'electron', 'security.js') },
];

let any = false;
for (const c of candidates) {
  any = copyIfExists(c.from, c.to) || any;
}

// Also copy services
const servicesSrc = path.resolve(root, 'dist-electron', 'services');
const servicesDst = path.resolve(out, 'services');
if (fs.existsSync(servicesSrc)) {
  fs.rmSync(servicesDst, { recursive: true, force: true });
  fs.mkdirSync(servicesDst, { recursive: true });
  for (const f of fs.readdirSync(servicesSrc)) {
    copyIfExists(path.join(servicesSrc, f), path.join(servicesDst, f));
    any = true;
  }
}

// If nothing copied, warn but exit 0 to not break builds unnecessarily
if (!any) console.warn('copy-electron: no files found to copy.');
console.log('copy-electron: done.');
process.exit(0);
