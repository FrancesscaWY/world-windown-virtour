import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {experienceMarkup} from '../src/components/experience.js';

test('the supplied logo original is preserved byte-for-byte and derived icons have the required dimensions',async()=>{
  const original=await readFile('public/assets/brand-logo-original.jpg');
  assert.equal(createHash('sha256').update(original).digest('hex'),'762e015c6cb6784cd9ce8884c457419190c8e5d784347758f6d2177c16d11974');
  for(const [file,size] of [
    ['public/assets/brand-logo.png',128],['public/assets/brand-favicon.png',32],
    ['public/assets/brand-touch-icon.png',180],['public/assets/brand-app-icon.png',512],
    ['native/ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png',1024],
  ]){
    const info=await sharp(await readFile(file)).metadata();
    assert.equal(info.width,size);assert.equal(info.height,size);assert.equal(info.hasAlpha,false);
  }
});
test('welcome, mode selection and tour consistently use the user logo and phone bookmark icon',async()=>{
  for(const file of ['index.html','modes.html','tour.html']){
    const html=await readFile(`public/${file}`,'utf8');
    assert.match(html,/rel="icon" href="\.\/assets\/brand-favicon\.png"/);
    assert.match(html,/rel="apple-touch-icon" href="\.\/assets\/brand-touch-icon\.png"/);
    assert.doesNotMatch(html,/favicon\.svg/);
  }
  assert.match(experienceMarkup(),/id="wordmark"[^>]*><img src="\.\/assets\/brand-logo\.png"/);
  assert.doesNotMatch(experienceMarkup(),/一园看世界/);
});
