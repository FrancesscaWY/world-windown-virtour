import { getPoi } from '../data/pois.js';
import { locatedPois, toCoordinates } from '../guide/location.js';

/** Only the signed iOS wrapper installs this handler. Safari never advertises native playback. */
export function createNativeCompanion({scope=globalThis,store,history}){
  const handler=scope.webkit?.messageHandlers?.virtourNative;
  const available=Boolean(handler?.postMessage);
  let active=false,conversationId=null;
  const send=payload=>{if(available)handler.postMessage(payload);};
  const receive=event=>{
    if(!available || event.source!==scope || event.origin!==scope.location.origin || event.data?.channel!=='virtour.native')return;
    const data=event.data;
    if(data.type==='records'){
      for(const row of data.records??[]){
        if(typeof row.conversationId!=='string' || typeof row.id!=='string' || !getPoi(row.poiId))continue;
        history.archive(row.conversationId,{id:`native-${row.id}`,role:'assistant',source:'companion',createdAt:row.createdAt,
          text:row.status==='finished'?getPoi(row.poiId).summary:row.status==='interrupted'?'（原生伴游讲解已中断）':'（原生伴游正在解说…）',
          partial:row.status==='playing',interrupted:row.status==='interrupted',poiIds:[row.poiId]});
      }
    }
    if(!conversationId && data.type==='state' && history.get(data.conversationId)){
      conversationId=data.conversationId;history.resume(conversationId);
    }
    if(data.conversationId!==conversationId)return;
    if(data.type==='state'){
      const playing=data.state==='playing';
      active=!['stopped','error','finished'].includes(data.state);
      store.set({nativeCompanionState:data.state,nativeCompanionActive:active,guideStatus:playing?'speaking':data.state==='preparing'?'preparing':'idle',
        companionPaused:data.state==='paused',guideError:data.state==='error'?'原生伴游暂时不可用，请检查网络和定位权限。':null});
    }
    if(data.type==='position' && Number.isFinite(data.latitude) && Number.isFinite(data.longitude))
      store.set({visitorOrigin:{latitude:data.latitude,longitude:data.longitude,accuracy:data.accuracy},visitorOriginSource:'设备定位',locationUpdatedAt:Date.now(),locationAccuracy:data.accuracy});
  };
  scope.addEventListener?.('message',receive);
  if(available)(scope.queueMicrotask??queueMicrotask)(()=>send({command:'sync'}));
  return {available,get active(){return active;},
    start(){
      if(!available)return false;
      conversationId=history.start('companion');active=true;
      const state=store.get(),ids=state.plannedRoute?.stops?.map(stop=>stop.poiId);
      const items=(ids?.length?ids.map(getPoi):[getPoi(state.selectedPoiId),...locatedPois])
        .filter((poi,index,all)=>poi?.position && poi.locationVerified && all.findIndex(item=>item?.id===poi.id)===index).slice(0,12)
        .map(poi=>({id:poi.id,name:poi.name,text:poi.summary,...toCoordinates(poi.position)}));
      store.set({nativeCompanionActive:true,nativeCompanionState:'preparing',companionPaused:false,guideStatus:'preparing'});
      send({command:'start',conversationId,mode:state.visitorOriginSource==='模拟定位'?'sequence':'location',items});return true;
    },
    pause(paused){send({command:paused?'pause':'resume'});},
    stop(){if(!active)return;send({command:'stop'});active=false;store.set({nativeCompanionActive:false,nativeCompanionState:'stopped',guideStatus:'idle'});},
    sync(){send({command:'sync'});},
    dispose(){scope.removeEventListener?.('message',receive);},
  };
}
