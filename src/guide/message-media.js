import { getPoi, pois } from '../data/pois.js';

let sequence=0;
export const messageId = () => `msg-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
export const messageSource = state => state.tourMode==='companion'?'companion':state.interactionMode==='realtime'?'voice':'text';

/** Presentation preference only; it never chooses the answer or invents a POI. */
export function visualNavigationAllowed(text='') {
  return !/(?:不要|不用|别|不必|不需要|无需).{0,8}(?:切换|换图|换画面|打开图片|打开全景|移动镜头)|不(?:切换|换图|换画面|移动镜头)|只(?:讲|听).{0,8}不(?:看|切)/u.test(text);
}

/** IDs come from successful structured tool results, never from guessed answer keywords or URLs. */
export function messagePoiIds(traces=[]) {
  if(!Array.isArray(traces))return [];
  const ids=[];
  for(const trace of traces){
    const result=trace?.result;
    if(trace?.status!=='done' || !result || result.error)continue;
    if(['get_attraction_guidance','get_detailed_attraction_guidance','introduce_view','move_camera'].includes(trace.name)
      && ['found','placeholder','success'].includes(result.status))ids.push(result.poi_id);
    if(trace.name==='get_attraction_details' && result.attraction)ids.push(result.attraction.id);
    if(trace.name==='look_around' && result.status==='success' && Array.isArray(result.items))ids.push(...result.items.map(item=>item?.poiId));
    if(trace.name==='plan_route' && result.status==='success')ids.push(...(result.route?.stops??[]).map(item=>item.poiId));
    if(['search_knowledge_base','get_attraction_story','get_attraction_details'].includes(trace.name)){
      const entities=(result.results??[]).flatMap(item=>item.entities??[]);
      if(result.name)entities.push(result.name);
      for(const name of entities){const poi=pois.find(poi=>[poi.id,poi.name,...(poi.aliases??[])].includes(name));if(poi)ids.push(poi.id);}
    }
  }
  return [...new Set(ids)].filter(id=>getPoi(id)).slice(0,4);
}

export function mediaUrl(value) {
  if(typeof value!=='string' || value.length>2048)return null;
  try{
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && url.hostname.includes('.')
      && !/^(?:localhost|[\d.]+)$|:|(?:^|\.)(?:local|internal|localhost|test)$/i.test(url.hostname)?url.href:null;
  }catch{return null;}
}
export function cleanReferenceCards(rows) {
  if(!Array.isArray(rows))return [];
  return rows.slice(0,6).flatMap(row=>{
    if(!row || typeof row.title!=='string' || !row.title.trim())return [];
    return [{title:row.title.slice(0,160),description:String(row.description??'').slice(0,500),
      kind:row.kind==='web'?'web':'reference',url:mediaUrl(row.url),image:row.kind==='web'?mediaUrl(row.image):null,
      label:row.kind==='web'?'联网资料 · 非园内实拍':'游览资料',retrievedAt:typeof row.retrievedAt==='string'?row.retrievedAt.slice(0,40):null}];
  });
}
/** Cards are tied to successful results in this turn, not the previously selected POI. */
export function messageReferences(traces=[]) {
  const rows=[];
  for(const trace of Array.isArray(traces)?traces:[]){
    const result=trace?.result;if(trace.status!=='done' || !result || result.error)continue;
    if(trace.name==='search_web' && result.status==='success'){
      for(const image of result.images??[])rows.push({title:image.description,image:image.url,url:image.source,kind:'web',retrievedAt:result.retrievedAt});
      for(const item of result.results??[])rows.push({title:item.title,description:item.content,url:item.url,kind:'web',retrievedAt:result.retrievedAt});
    }else if(result.status==='found' && Array.isArray(result.results)){
      for(const item of result.results.slice(0,2))rows.push({title:item.title??'游览资料',description:item.content,
        url:item.sources?.find(source=>mediaUrl(source.url))?.url,kind:'reference'});
    }
  }
  const seen=new Set();
  return cleanReferenceCards(rows).filter(row=>{const key=row.image??row.url??row.title;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,4);
}
