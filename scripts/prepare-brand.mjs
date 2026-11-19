import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

// Deterministic derivatives of the user-supplied image; keep the original bytes.
const source='public/assets/brand-logo-original.jpg';
const files=[
  ['public/assets/brand-logo.png',128],
  ['public/assets/brand-favicon.png',32],
  ['public/assets/brand-touch-icon.png',180],
  ['public/assets/brand-app-icon.png',512],
  ['native/ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png',1024],
];
await mkdir('native/ios/Sources/Assets.xcassets/AppIcon.appiconset',{recursive:true});
for(const [file,size] of files)await sharp(source).resize(size,size,{fit:'contain',background:'#ffffff'}).removeAlpha().png().toFile(file);
console.log('Prepared web and native icons from the supplied logo; no redraw or recoloring.');
