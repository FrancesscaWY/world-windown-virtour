import { readFile, mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
await cp(resolve(root, 'public'), out, { recursive: true });
await cp(resolve(root, 'src'), resolve(out, 'src'), { recursive: true });

// Fully embed local modules and assets for file:// preview without installing a bundler.
// This intentionally handles this project's static ESM imports only; no runtime code fetching.
const modules = new Map();
const imports = {};
const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
async function embedAsset(path) {
  const bytes = await readFile(resolve(root, 'public', path.replace(/^\.\//, '')));
  return `data:${mime[extname(path)] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}
async function embedModule(file) {
  if (modules.has(file)) return modules.get(file);
  const key = `virtour/${relative(root, file).replaceAll('\\', '/')}`;
  modules.set(file, key);
  let code = await readFile(file, 'utf8');
  for (const match of [...code.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)]) {
    const url = await embedModule(resolve(dirname(file), match[1]));
    code = code.replace(match[0], `from '${url}'`);
  }
  for (const match of [...code.matchAll(/(['"])(\.\/assets\/[^'"]+)\1/g)]) code = code.replace(match[0], JSON.stringify(await embedAsset(match[2])));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  imports[key] = url;
  return key;
}
// The normal static site starts at the new welcome page. Keep the existing
// self-contained tour preview available for the established offline workflow.
let html = await readFile(resolve(root, 'public/tour.html'), 'utf8');
const css = await readFile(resolve(root, 'public/styles.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./styles.css" />', `<style>${css}</style>`);
const returnLinkCss = await readFile(resolve(root, 'public/assets/arrival/tour-link.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/arrival/tour-link.css" />', `<style>${returnLinkCss}</style>`);
const tourTheme = (await readFile(resolve(root, 'public/assets/tour-theme.css'), 'utf8'))
  .replace("url('./arrival/paper.png')", `url('${await embedAsset('./assets/arrival/paper.png')}')`);
html = html.replace('<link rel="stylesheet" href="./assets/tour-theme.css" />', `<style>${tourTheme}</style>`);
const callCss = await readFile(resolve(root, 'public/assets/call.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/call.css" />', `<style>${callCss}</style>`);
const introductionCss = await readFile(resolve(root, 'public/assets/introduction-view.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/introduction-view.css" />', `<style>${introductionCss}</style>`);
const nearbyCss = await readFile(resolve(root, 'public/assets/nearby-view.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./assets/nearby-view.css" />', `<style>${nearbyCss}</style>`);
const mapCutout = `data:image/svg+xml;base64,${(await readFile(resolve(root, 'public/assets/map-cutout.svg'))).toString('base64')}`;
const homeCss = (await readFile(resolve(root, 'public/assets/home.css'), 'utf8')).replaceAll("url('./map-cutout.svg')", `url('${mapCutout}')`);
html = html.replace('<link rel="stylesheet" href="./assets/home.css" />', `<style>${homeCss}</style>`);
const experienceCss=await readFile(resolve(root,'public/assets/experience-v12.css'),'utf8');
html=html.replace('<link rel="stylesheet" href="./assets/experience-v12.css" />',`<style>${experienceCss}</style>`);
html = html.replace('./assets/favicon.svg', await embedAsset('./assets/favicon.svg'));
for(const asset of ['./assets/brand-favicon.png','./assets/brand-touch-icon.png'])
  html=html.replaceAll(asset,await embedAsset(asset));
const main = await embedModule(resolve(root, 'src/main.js'));
html = html.replace('<script type="module" src="/src/tour-entry.js"></script>', `<script type="module">import '${main}';</script>`);
html = html.replace('</head>', `<script type="importmap">${JSON.stringify({imports})}</script></head>`);
await writeFile(resolve(out, 'offline-preview.html'), html);
console.log('Built welcome, modes and tour pages; retained self-contained dist/offline-preview.html');
