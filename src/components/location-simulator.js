import { icon } from './icons.js';
import { locatedPois, toCoordinates, distanceMeters } from '../guide/location.js';

/** One settings dialog, opened from the final map-tool button. No floating duplicate. */
export function mountSimulator({ container, trigger, onPosition, onSource, scope = globalThis }) {
  const route = ['liberty','pyramid','eiffel','arc','sydney'].map(id=>locatedPois.find(p=>p.id===id)).filter(Boolean);
  container.innerHTML = `<dialog id="simulation-sheet" class="sheet simulation-sheet" aria-labelledby="simulation-title" aria-describedby="simulation-description">
    <header><div><h2 id="simulation-title">定位与演示</h2><p id="simulation-description">模拟位置仅用于演示，不代表你的实际位置</p></div><button type="button" class="icon-button" data-close aria-label="关闭定位设置">${icon('close')}</button></header>
    <label class="simulation-source">位置来源<select data-source><option value="device">设备定位 · 需授权</option><option value="simulated">模拟定位 · 演示</option></select></label>
    <section data-controls hidden aria-label="模拟行程设置">
      <div class="simulation-fields"><label>演示起点<select data-location>${route.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('')}</select></label><label>行进速度<select data-speed><option value="1.4">步行 · 1×</option><option value="7" selected>快进 · 5×</option><option value="14">快进 · 10×</option></select></label></div>
      <label class="simulation-walk"><span>自动行进<small>开始伴游后，沿演示行程移动</small></span><input type="checkbox" role="switch" data-walk/></label>
      <button type="button" class="simulation-reset" data-reset>${icon('compass')}回到所选起点</button>
    </section>
    <p class="simulation-device-note" data-device>开始伴游后使用设备定位；浏览器切后台或锁屏可能暂停更新。</p>
    <footer><output class="location-readout" aria-live="polite">尚未定位</output><button type="button" class="primary-button" data-done>完成</button></footer>
  </dialog>`;
  const dialog=container.querySelector('#simulation-sheet');
  const source=container.querySelector('[data-source]'), walk=container.querySelector('[data-walk]');
  const location=container.querySelector('[data-location]'), speed=container.querySelector('[data-speed]');
  const lengths=route.slice(1).map((p,i)=>distanceMeters(toCoordinates(route[i].position),toCoordinates(p.position)));
  let active=false, companion=false, paused=false, disposed=false, progress=0, timer=null, lastTime=0, revision=0;
  const listeners=[];
  const listen=(node,type,handler)=>{if(!node)return;node.addEventListener(type,handler);listeners.push(()=>node.removeEventListener(type,handler));};
  const stop=()=>{if(timer!==null)scope.clearInterval(timer);timer=null;};
  const sourceUI=()=>{
    container.querySelector('[data-controls]').hidden=source.value==='device';
    const note=container.querySelector('[data-device]');if(note)note.hidden=source.value!=='device';
  };
  const emit=()=>{
    if(!active || disposed || route.length<2 || source.value!=='simulated')return;
    const segment=Math.min(route.length-2,Math.floor(progress)), fraction=progress-segment;
    const a=route[segment].position,b=route[segment+1].position,from=toCoordinates(a),to=toCoordinates(b);
    const heading=(Math.atan2((to.longitude-from.longitude)*Math.cos(from.latitude*Math.PI/180),to.latitude-from.latitude)*180/Math.PI+360)%360;
    onPosition({...toCoordinates({x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction}),accuracy:5,heading,simulationRevision:revision},'模拟定位');
  };
  const start=()=>{
    stop();
    if(disposed || !active || paused || !walk.checked || source.value!=='simulated' || progress>=route.length-1)return;
    lastTime=scope.Date.now();
    timer=scope.setInterval(()=>{
      const now=scope.Date.now();let remaining=Math.max(0,Math.min(now-lastTime,1000))/1000*Number(speed.value);lastTime=now;
      while(remaining>0 && progress<route.length-1){
        const segment=Math.floor(progress),available=(1-(progress-segment))*lengths[segment];
        if(remaining>=available){progress=segment+1;remaining-=available;}
        else {progress+=remaining/lengths[segment];remaining=0;}
      }
      emit();if(progress>=route.length-1){walk.checked=false;stop();}
    },250);
  };
  const reset=()=>{progress=Number(location.value);revision++;emit();start();};
  const changeSource=(notify=true)=>{stop();sourceUI();if(notify)onSource?.(source.value);if(source.value==='simulated'){emit();start();}};
  const close=()=>{dialog?.close?.();trigger?.setAttribute('aria-expanded','false');};
  listen(source,'change',()=>changeSource());
  listen(walk,'change',start);listen(speed,'change',start);listen(location,'change',reset);
  listen(container.querySelector('[data-reset]'),'click',reset);
  listen(container.querySelector('[data-close]'),'click',close);
  listen(container.querySelector('[data-done]'),'click',close);
  listen(dialog,'close',()=>{trigger?.setAttribute('aria-expanded','false');trigger?.focus({preventScroll:true});});
  sourceUI();
  return {
    open(){if(disposed || !active || dialog?.open)return;sourceUI();dialog?.showModal();trigger?.setAttribute('aria-expanded','true');},
    close,
    getSource:()=>source.value,
    reset,
    refresh:emit,
    setSource(value,{notify=true}={}){if(!['device','simulated'].includes(value)||source.value===value)return;source.value=value;changeSource(notify);},
    setPaused(value){paused=Boolean(value);start();},
    setActive(value,{moving=value}={}){
      if(disposed)return;
      const wasActive=active,changed=companion!==Boolean(moving);companion=Boolean(moving);
      active=Boolean(value);container.hidden=!active;
      if(changed)walk.checked=companion;
      if(!active){stop();close();return;}
      if(!wasActive)emit();start();
    },
    dispose(){disposed=true;active=false;stop();close();listeners.splice(0).forEach(remove=>remove());container.replaceChildren();},
  };
}
