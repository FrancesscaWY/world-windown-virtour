import test from 'node:test';
import assert from 'node:assert/strict';
import {pois} from '../src/data/pois.js';
import {landmark,icon} from '../src/components/icons.js';

test('every catalog entry has a local building, landscape or experience illustration rather than a globe/empty SVG',()=>{
  for(const poi of pois){const art=landmark(poi.id);assert.match(art,/<(?:path|rect|ellipse|circle|g)\b/,poi.id);assert.doesNotMatch(art,/<ellipse cx="48" cy="49" rx="13" ry="29"/,poi.id);}
  assert.notEqual(landmark('eiffel'),landmark('fuji'));assert.notEqual(landmark('pyramid'),landmark('niagara'));
  assert.notEqual(icon('send'),icon('arrow'));
});
