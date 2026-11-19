import {readFile,writeFile} from 'node:fs/promises';
import {buildOsmMap} from './osm-map.mjs';
import {externalAssets} from '../src/data/external-assets.js';

// Existing attributed OSM snapshot: no fabricated roads, remote tiles or new data provider.
const source=JSON.parse(await readFile('public/assets/world-window-osm-source.json','utf8'));
const {svg}=buildOsmMap(source,{bbox:externalAssets.map.bbox,surroundings:true});
await writeFile('public/assets/park-surroundings.svg',svg);
console.log('Prepared geographic surroundings from the existing OSM snapshot.');
