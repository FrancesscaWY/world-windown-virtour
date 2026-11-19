import { getPoi } from '../data/pois.js';
import { introductionPhotos } from '../data/introduction-views.js';
import { renderMarkdown } from './markdown.js';
import { cleanReferenceCards } from '../guide/message-media.js';
const signatures=new WeakMap();

/** Reuse unchanged rows/photos while a realtime answer streams. */
export function renderConversationMessages(log,rows) {
  const existing=new Map([...log.children].map(node=>[node.dataset.messageId,node]));
  const nodes=rows.map((row,index)=>{
    const id=row.id??`row-${index}`,signature=JSON.stringify(row),old=existing.get(id);
    if(old && signatures.get(old)===signature)return old;
    const node=conversationMessage(log.ownerDocument,row);node.dataset.messageId=id;signatures.set(node,signature);return node;
  });
  log.replaceChildren(...nodes);
}

export function conversationMessage(doc,row) {
  const item=doc.createElement('div');item.className=`conversation-message ${row.role==='user'?'from-visitor':'from-guide'}`;
  if(row.id)item.dataset.messageId=row.id;
  const author=doc.createElement('span');author.className='sr-only';author.textContent=row.role==='user'?'你':'数字导游';
  const text=row.role==='user'?doc.createElement('p'):renderMarkdown(doc,row.text??row.content??'');
  if(row.role==='user')text.textContent=row.text??row.content??'';
  item.append(author,text);
  if(row.role!=='user' && !row.interrupted){
    const photos=doc.createElement('div');photos.className='message-photos';
    for(const id of [...new Set(row.poiIds??[])].slice(0,4)){
      const poi=getPoi(id);if(!poi)continue;
      for(const photo of introductionPhotos(id).slice(0,1)){
        const figure=doc.createElement('figure');figure.className='message-photo';figure.dataset.photoPoi=id;
        const image=doc.createElement('img');image.src=photo.file;image.alt=`${poi.name} · ${photo.caption}`;image.loading='lazy';
        image.addEventListener('error',()=>figure.remove(),{once:true});
        const caption=doc.createElement('figcaption');caption.textContent=`${poi.name} · ${photo.title}`;figure.title=photo.attribution;
        figure.append(image,caption);photos.append(figure);
      }
    }
    if(photos.childElementCount)item.append(photos);
  }
  if(row.role!=='user' && !row.interrupted){
      const cards=doc.createElement('div');cards.className='message-references';cards.setAttribute('aria-label','相关来源');
    for(const reference of cleanReferenceCards(row.references)){
      const card=doc.createElement(reference.url?'a':'div');card.className='reply-source-card';
      if(reference.url){card.href=reference.url;card.target='_blank';card.rel='noopener noreferrer';}
      if(reference.image){
        const image=doc.createElement('img');image.src=reference.image;image.alt=reference.title;image.loading='lazy';image.referrerPolicy='no-referrer';
        image.addEventListener('error',()=>image.remove(),{once:true});card.append(image);
      }
      const label=doc.createElement('small');label.textContent=reference.image?'资料图':reference.kind==='web'?'网页':'来源';
      const title=doc.createElement('strong');title.textContent=reference.image?'查看相关资料图片':reference.title;card.title=reference.title;
      card.append(label,title);
      if(reference.url){const source=doc.createElement('small');source.textContent=new URL(reference.url).hostname;card.append(source);}
      cards.append(card);
    }
    if(cards.childElementCount)item.append(cards);
  }
  return item;
}
