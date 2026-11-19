import { escapeHTML as esc } from './html.js';
import { icon } from './icons.js';

/** Pins already carry their names. Only one quiet source/status line is needed. */
export function mountFacilityBubbles(viewport, onDismiss) {
  const layer = viewport.querySelector('.map-bubbles');
  let open = false;
  const dismiss = () => { onDismiss(); viewport.ownerDocument.querySelector('[data-top-facility-kind][aria-pressed="true"]')?.focus({preventScroll:true}); };
  const click = event => { if (event.target.closest('[data-dismiss-bubble]')) dismiss(); };
  layer?.addEventListener('click', click);
  return {
    refresh() {}, dismiss, isOpen:() => open,
    show(info) {
      if (!layer) return;
      open = Boolean(info);
      if (!info) { layer.replaceChildren(); return; }
      const area = info.items.some(item => item.anchorPoiId);
       const located = info.items.some(item => item.position);
       const unlocated = info.items.filter(item => !item.position && !item.anchorPoiId);
       const label = area ? '餐饮区域参考' : located ? '地图设施' : '设施位置可咨询园区工作人员';
        layer.innerHTML = `<div class="facility-source-line"><span>${esc(label)}</span>${info.items[0] ? `<a href="${esc(info.items[0].source)}" target="_blank" rel="noopener noreferrer" aria-label="查看设施资料来源">${icon('info')}</a>` : ''}<button type="button" data-dismiss-bubble="all" aria-label="收起设施标注">${icon('close')}</button></div>${unlocated.length ? `<div class="facility-unlocated">${unlocated.map(item=>`<a href="${esc(item.source)}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>`).join('')}</div>` : ''}`;
    },
    destroy() { layer?.removeEventListener('click', click); layer?.replaceChildren(); open = false; },
  };
}
