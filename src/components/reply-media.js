import { conversationMessage } from './conversation-message.js';
import { synchronizedTour } from '../guide/panorama-narration.js';

export function mountReplyMedia({app,store}){
  const panel=app.querySelector('#reply-media'),content=panel.querySelector('[data-reply-media]');
  let key='',dismissed=null;
  const render=state=>{
    const row=state.messages?.at(-1);
    const eligible=state.tourMode==='interactive' && state.interactionMode==='realtime' && row?.role==='assistant'
      && !row.interrupted && !synchronizedTour(state) && (row.poiIds?.length || row.references?.length);
    panel.hidden=!eligible || row?.id===dismissed;
    if(panel.hidden)return;
    const next=JSON.stringify([row.id,row.poiIds,row.references]);if(next===key)return;key=next;
    const message=conversationMessage(app.ownerDocument,row);
    content.replaceChildren(...message.querySelectorAll('.message-photos,.message-references'));
  };
  const close=()=>{dismissed=store.get().messages.at(-1)?.id;panel.hidden=true;};
  panel.querySelector('button').addEventListener('click',close);
  const unsubscribe=store.subscribe(render);render(store.get());
  return()=>{unsubscribe();panel.querySelector('button').removeEventListener('click',close);};
}
