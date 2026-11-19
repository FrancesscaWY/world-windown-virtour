export function mountConversationHistory({app,history,onContinue}){
  const $=selector=>app.querySelector(selector),doc=app.ownerDocument,dialog=$('#history-sheet');
  let opener=null,resuming=false;
  const labels={text:'文字',voice:'语音',companion:'伴游'};
  const render=()=>{
    const error=history.status();$('#history-storage-status').hidden=!error;$('#history-storage-status').textContent=error;
    const records=history.list();
    $('#history-list').replaceChildren(...records.map(record=>{
      const button=doc.createElement('button');button.type='button';button.dataset.historyId=record.id;
      button.setAttribute('aria-label',`继续对话：${record.title}`);
      const title=doc.createElement('strong');title.textContent=record.title;
      const meta=doc.createElement('small');
      const modes=[...new Set(record.messages.map(row=>row.source))].map(mode=>labels[mode]??labels[record.mode]).join(' / ');
      meta.textContent=`${modes} · ${new Date(record.updatedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`;
      button.append(title,meta);return button;
    }));
    if(!records.length){const empty=doc.createElement('p');empty.className='history-empty';empty.textContent='暂无历史对话';$('#history-list').append(empty);}
  };
  const open=()=>{history.flush();resuming=false;opener=doc.activeElement;render();if(!dialog.open)dialog.showModal();};
  const close=()=>dialog.close();
  const choose=event=>{
    const id=event.target.closest('[data-history-id]')?.dataset.historyId;if(!id)return;
    resuming=true;dialog.close();onContinue(id);
  };
  const closed=()=>{if(!resuming)opener?.focus?.({preventScroll:true});};
  const unsubscribe=history.subscribe(()=>{if(dialog.open)render();});
  const bindings=[[$('#conversation-history'),'click',open],[$('#call-history'),'click',open],[$('#history-close'),'click',close],
    [$('#history-list'),'click',choose],[dialog,'close',closed]];
  bindings.forEach(([node,event,fn])=>node.addEventListener(event,fn));
  return {open,dispose(){unsubscribe();bindings.forEach(([node,event,fn])=>node.removeEventListener(event,fn));}};
}
