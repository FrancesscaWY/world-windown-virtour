import { getPoi, pois } from '../data/pois.js';
import { messageId, cleanReferenceCards } from './message-media.js';

export const HISTORY_KEY='virtour.conversations.v1';
const MODES=['text','voice','companion'],MAX_CONVERSATIONS=80,MAX_MESSAGES=500;
export function conversationTitle(rows) {
  const text=rows.map(row=>row.text??row.content??'').join(' ');
  const ids=new Set(rows.flatMap(row=>Array.isArray(row.poiIds)?row.poiIds:[]));
  const landmarks=pois.filter(p=>ids.has(p.id) || [p.name,...(p.aliases??[])].some(name=>name.length>1 && text.includes(name)));
  if(/路线|行程|怎么逛|规划/.test(text))return landmarks.length?`${landmarks[0].name}与游览路线`:'世界之窗游览路线';
  if(/餐饮|餐厅|吃饭|美食/.test(text))return '园区餐饮与补给';
  if(landmarks.length)return `${landmarks[0].name}${landmarks.length>1?'与周边景点':'游览与故事'}`;
  const questionRow=rows.find(row=>row.role==='user' && !/^(?:hi|hello|你好[呀啊]?|您好|嗨|谢谢|在吗)[。！!？?\s]*$/i.test(row.text??row.content??''));
  const question=questionRow?.text??questionRow?.content;
  return question?question.replace(/\s+/g,' ').slice(0,18):rows.length?'园区随聊':'新对话';
}
function cleanMessage(row,mode,now) {
  if(!row || !['user','assistant'].includes(row.role))return null;
  const text=typeof(row.text??row.content)==='string'?(row.text??row.content).slice(0,row.role==='user'?2000:30000):'';
  if(!text.trim())return null;
  return {id:typeof row.id==='string'?row.id.slice(0,128):messageId(),role:row.role,text,content:text,
    source:MODES.includes(row.source)?row.source:mode,createdAt:Number.isFinite(row.createdAt)?row.createdAt:now,
    ...(row.partial?{partial:true}:{}),...(row.interrupted?{interrupted:true}:{}),
    poiIds:[...new Set(Array.isArray(row.poiIds)?row.poiIds:[])].filter(id=>typeof id==='string' && getPoi(id)).slice(0,4),
    references:cleanReferenceCards(row.references)};
}
export function parseConversations(value) {
  try {
    const parsed=JSON.parse(value);
    if(parsed?.version!==1 || !Array.isArray(parsed.conversations))return [];
    const seen=new Set();
    return parsed.conversations.slice(0,MAX_CONVERSATIONS).flatMap(record=>{
      if(!record || typeof record.id!=='string' || record.id.length>128 || seen.has(record.id))return [];
      seen.add(record.id);const mode=MODES.includes(record.mode)?record.mode:'text',now=Date.now();
      const messages=(Array.isArray(record.messages)?record.messages:[]).slice(-MAX_MESSAGES).map(row=>cleanMessage(row,mode,now)).filter(Boolean);
      if(!messages.length)return [];
      return [{id:record.id,mode,title:typeof record.title==='string'?record.title.slice(0,32):conversationTitle(messages),
        createdAt:Number.isFinite(record.createdAt)?record.createdAt:now,updatedAt:Number.isFinite(record.updatedAt)?record.updatedAt:now,
        messages,titleRevision:Number.isFinite(record.titleRevision)?record.titleRevision:0,titleGenerated:record.titleGenerated===true,titleTopic:typeof record.titleTopic==='string'?record.titleTopic:''}];
    });
  }catch{return [];}
}

/** A durable local transcript, separate from the model's bounded context window. */
export function createConversationHistory({store,storage,scope=globalThis,requestTitle}){
  let records=[],draft=null,disposed=false,timer=null,titleTimer=null,storageError='',titleQueued=false;
  const listeners=new Set(),requests=new Map(),legacyIds=new WeakMap();
  try{records=parseConversations(storage?.getItem(HISTORY_KEY));}catch{storageError='浏览器未允许持久保存，当前页面仍可查看记录。';}
  const notify=()=>listeners.forEach(fn=>fn());
  const active=()=>records.find(record=>record.id===store.get().conversationId)??(draft?.id===store.get().conversationId?draft:null);
  const syncTitle=()=>{
    if(titleQueued)return;titleQueued=true;
    (scope.queueMicrotask??queueMicrotask)(()=>{
      titleQueued=false;if(disposed)return;
      const record=active();
      if(record && (store.get().conversationTitle!==record.title || store.get().conversationRevision!==(record.revision??0)))
        store.set({conversationTitle:record.title,conversationRevision:record.revision??0,conversationTranscript:record.messages.slice()});
    });
  };
  const flush=()=>{
    if(timer!==null)scope.clearTimeout(timer);timer=null;
    try{
      const saved=records.filter(record=>record.messages.length).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,MAX_CONVERSATIONS);
      let value=JSON.stringify({version:1,conversations:saved});
      // Keep the active transcript; expire oldest visits before reaching typical browser quotas.
      while(value.length>1800000 && saved.length>1){saved.pop();value=JSON.stringify({version:1,conversations:saved});}
      if(!storage)throw new Error('Storage unavailable');
      storage.setItem(HISTORY_KEY,value);records=saved;storageError='';
    }catch{storageError='浏览器空间不足或未允许保存，部分记录暂时仅保留在本页面。';}
    notify();
  };
  const scheduleSave=()=>{if(timer!==null)scope.clearTimeout(timer);timer=scope.setTimeout(flush,180);};
  const titleInput=record=>record.messages.filter(row=>!row.partial && !row.interrupted).slice(-8).map(({role,text})=>({role,content:text.slice(0,1400)}));
  const scheduleTitle=record=>{
    if(!requestTitle || requests.has(record.id) || record.messages.some(row=>row.partial))return;
    const revision=record.messages.length;
    if(!record.messages.some(row=>row.role==='assistant') || record.titleRevision && revision-record.titleRevision<6 && record.titleTopic===conversationTitle(record.messages))return;
    if(titleTimer!==null)scope.clearTimeout(titleTimer);
    const id=record.id;
    titleTimer=scope.setTimeout(async()=>{
      titleTimer=null;if(disposed)return;
      const target=records.find(row=>row.id===id);if(!target || target.messages.some(row=>row.partial))return;
      const input=titleInput(target),signature=JSON.stringify(input),controller=new AbortController();
      requests.set(id,controller);target.titleRevision=revision;target.titleTopic=conversationTitle(target.messages);
      try{
        const title=await requestTitle(input,{signal:controller.signal});
        if(disposed || typeof title!=='string' || !title.trim() || title.length>32)return;
        const current=records.find(row=>row.id===id);
        if(current && JSON.stringify(titleInput(current))===signature){current.title=title.trim();current.titleGenerated=true;syncTitle();scheduleSave();notify();}
      }catch{/* A useful local title is already available; never block a conversation on naming. */}
      finally{
        requests.delete(id);
        const current=records.find(row=>row.id===id);
        if(!disposed && current && JSON.stringify(titleInput(current))!==signature)scheduleTitle(current);
      }
    },1200);
  };
  const capture=state=>{
    if(disposed || !state.conversationId)return;
    const record=records.find(row=>row.id===state.conversationId)??(draft?.id===state.conversationId?draft:null);
    if(!record)return;
    let changed=false;
    for(const raw of state.messages??[]){
      let id=raw.id;
      if(!id){id=legacyIds.get(raw);if(!id){id=messageId();legacyIds.set(raw,id);}}
      const index=record.messages.findIndex(old=>old.id===id);
      const old=record.messages.find(row=>row.id===id);
      const row=cleanMessage({...raw,id},record.mode,old?.createdAt??Date.now());if(!row)continue;
      if(index<0){record.messages.push(row);changed=true;}
      else if(JSON.stringify(record.messages[index])!==JSON.stringify(row)){record.messages[index]=row;changed=true;}
    }
    if(!changed)return;
    record.messages=record.messages.slice(-MAX_MESSAGES);record.updatedAt=Date.now();
    record.revision=(record.revision??0)+1;
    if(!record.titleGenerated)record.title=conversationTitle(record.messages);
    if(!records.includes(record) && record.messages.length){records.push(record);draft=null;}
    syncTitle();scheduleSave();scheduleTitle(record);notify();
  };
  const start=(mode='text')=>{
    if(!MODES.includes(mode))mode='text';
    capture(store.get());flush();
    draft={id:`chat-${messageId()}`,mode,title:'新对话',createdAt:Date.now(),updatedAt:Date.now(),messages:[],titleRevision:0};
    store.set({conversationId:draft.id,conversationTitle:draft.title,conversationTranscript:[],conversationRevision:0,messages:[],guideTraces:[],currentTranscript:'',guideText:'',guideError:null,
      introductionView:null,nearbyView:null,clarification:null,recommendedPoiIds:[],cameraTour:null,cameraSentence:null});
    notify();return draft.id;
  };
  const resume=id=>{
    const record=records.find(row=>row.id===id);if(!record)return false;
    capture(store.get());flush();draft=null;
    store.set({conversationId:id,conversationTitle:record.title,conversationTranscript:record.messages.slice(),conversationRevision:record.revision??0,messages:record.messages.slice(-12).map(row=>({...row})),
      guideTraces:[],currentTranscript:'',guideText:record.messages.filter(row=>row.role==='assistant').at(-1)?.text??'',
      introductionView:null,nearbyView:null,clarification:null,recommendedPoiIds:[],cameraTour:null,cameraSentence:null});
    notify();return true;
  };
  const unsubscribe=store.subscribe(capture);
  const storageChanged=event=>{
    if(event.key!==HISTORY_KEY)return;
    for(const record of parseConversations(event.newValue)){
      if(record.id===store.get().conversationId)continue;
      const i=records.findIndex(old=>old.id===record.id);
      if(i<0)records.push(record);else if(record.updatedAt>records[i].updatedAt)records[i]=record;
    }notify();
  };
  scope.addEventListener?.('storage',storageChanged);
  return {start,resume,flush,
    archive(id,raw){
      const record=records.find(row=>row.id===id)??(draft?.id===id?draft:null);
      if(!record)return false;
      const row=cleanMessage(raw,record.mode,Date.now());if(!row)return false;
      if(JSON.stringify(record.messages.find(old=>old.id===row.id))===JSON.stringify(row))return true;
      if(store.get().conversationId===id){
        const rows=store.get().messages,index=rows.findIndex(old=>old.id===row.id);
        store.set({messages:index<0?[...rows,row].slice(-12):rows.map((old,i)=>i===index?row:old)});
      }else{
        const index=record.messages.findIndex(old=>old.id===row.id);
        if(index<0)record.messages.push(row);else record.messages[index]=row;
        record.messages=record.messages.slice(-MAX_MESSAGES);record.updatedAt=Date.now();record.revision=(record.revision??0)+1;
        if(!record.titleGenerated)record.title=conversationTitle(record.messages);
        if(!records.includes(record)){records.push(record);draft=null;}
        scheduleSave();scheduleTitle(record);notify();
      }
      return true;
    },
    get:id=>records.find(record=>record.id===id)??(draft?.id===id?draft:null),
    list:()=>[...records].filter(row=>row.messages.length).sort((a,b)=>b.updatedAt-a.updatedAt),
    current:active,status:()=>storageError,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    dispose(){capture(store.get());flush();disposed=true;unsubscribe();scope.clearTimeout(titleTimer);for(const request of requests.values())request.abort();
      scope.removeEventListener?.('storage',storageChanged);listeners.clear();},
  };
}
