import { externalAssets } from '../data/external-assets.js';
import { rotateMapPoint } from './map-controller.js';
import { mapOffset } from './map-layout.js';
import { mapCalibration } from '../data/map-calibration.js';

/** Invert the exact artwork plane, including portrait tilt, camera pan and rotation. */
export function mapScreenToArtwork(point, { state, width, height, artWidth, artHeight, layout }) {
  const screen = rotateMapPoint({
    x:(point.x-width/2-state.x)/state.scale,
    y:(point.y-height/2-state.y)/state.scale,
  }, -state.rotation);
  const x=screen.x-layout.centerX, y=screen.y-layout.centerY;
  const ry=y/(layout.tiltY ?? 1), rx=x-(layout.shear ?? 0)*ry;
  const raw=rotateMapPoint({x:rx,y:ry},-layout.angle);
  return {x:(raw.x/artWidth+.5)*100,y:(raw.y/artHeight+.5)*100};
}

export function mapViewportFootprint(camera) {
  return [[0,0],[camera.width,0],[camera.width,camera.height],[0,camera.height]]
    .map(([x,y])=>mapScreenToArtwork({x,y},camera));
}

export function mapOverviewMarkup() {
  return `<button type="button" class="map-overview" data-expanded="false" aria-expanded="false" aria-label="展开全园小地图">
    <span class="map-overview-image"><img src="${externalAssets.map.file}" alt="" draggable="false"/>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon class="overview-window" points="0,0 100,0 100,100 0,100"/>
        <circle class="overview-target" r="3" hidden/>
        <g class="overview-visitor" hidden><path d="M0 -8 -4 0 0 -2 4 0Z"/><circle r="2.8"/></g>
      </svg>
    </span><span class="map-overview-label">全园 · <span data-overview-place>当前视野</span></span>
  </button>`;
}

export function mountMapOverview(viewport, onNavigate) {
  const button=viewport.querySelector('.map-overview');
  const image=button?.querySelector('.map-overview-image');
  const polygon=button?.querySelector('.overview-window');
  const target=button?.querySelector('.overview-target');
  const visitor=button?.querySelector('.overview-visitor');
  const label=button?.querySelector('[data-overview-place]');
  let camera=null,expanded=false,wasZoomed=false,collapsedByUser=false;
  const paint=()=>{
    if(!button)return;
    // No collapsed, empty "全园" bubble at the overview scale.
    button.hidden=!camera || camera.state.scale<=1.05;
    button.dataset.expanded=String(expanded);button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',expanded?'全园小地图，点击位置查看细节，点文字收起':'展开全园小地图');
  };
  const click=event=>{
    if (!camera) return;
    if(!expanded){expanded=true;collapsedByUser=false;paint();return;}
    if(event.detail===0 || event.target.closest('.map-overview-label')){expanded=false;collapsedByUser=true;paint();return;}
    const r=image.getBoundingClientRect();
    onNavigate({x:Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100)),
      y:Math.max(0,Math.min(100,(event.clientY-r.top)/r.height*100))});
  };
  button?.addEventListener('click',click);
  return {
    update(next) {
      if(!(next.artWidth>0) || !(next.artHeight>0))return;
      camera=next;
      const zoomed=next.state.scale>1.05;
      if(!zoomed){expanded=false;collapsedByUser=false;}
      else if(!wasZoomed && !collapsedByUser)expanded=true;
      wasZoomed=zoomed;paint();
      polygon?.setAttribute('points',mapViewportFootprint(next).map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' '));
      button?.setAttribute('data-zoomed',String(zoomed));
    },
    target(point,name) {
      if (!target) return;
      target.toggleAttribute('hidden',!point);
      if(point) { target.setAttribute('cx',point.x);target.setAttribute('cy',point.y); }
      label.textContent=name || '当前视野';
    },
    visitor(point,ahead) {
      if (!visitor) return;
      visitor.toggleAttribute('hidden',!point);
      if(point){
        const {width,height}=mapCalibration.artwork;
        const a=mapOffset(point,width,height),b=mapOffset(ahead ?? point,width,height);
        const angle=Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI;
        visitor.setAttribute('transform',`translate(${point.x} ${point.y}) rotate(${angle})`);
      }
    },
    destroy(){button?.removeEventListener('click',click);},
  };
}
