import { touristMapSections } from '../data/map-discovery.js';
import { getPoi } from '../data/pois.js';
import { escapeHTML as esc } from './html.js';

export function touristMapIndexMarkup() {
  return `<details class="tourist-map-index"><summary>按景区导览图查看主要景点</summary><p>按参考导览图整理，分区沿用现有名录，编号只对应该图。未校准的地点不猜放标记，开放情况以现场为准。</p><div>${touristMapSections.map(section=>`<section><h3>${esc(section.name)}</h3><ul>${section.entries.map(item=>{
    const poi=getPoi(item.poiId);
    const label=`${item.number?`<span class="reference-number">${item.number}</span>`:''}<span>${esc(item.name)}</span>`;
    return `<li>${poi?`<button type="button" data-reference-poi="${poi.id}">${label}${!poi.position?'<small>位置待核实</small>':''}</button>`:`<span class="reference-unlocated">${label}<small>位置待核实</small></span>`}</li>`;
  }).join('')}</ul></section>`).join('')}</div></details>`;
}
