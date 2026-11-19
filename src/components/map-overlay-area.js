/** Reserve side rails, not their full height, when framing map photo annotations. */
export function mapOverlayArea(viewport) {
  const rect=viewport.getBoundingClientRect(),doc=viewport.ownerDocument;
  const controls=viewport.querySelector('.map-controls')?.getBoundingClientRect();
  const overview=viewport.querySelector('.map-overview')?.getBoundingClientRect();
  const dock=doc.querySelector('.voice-dock')?.getBoundingClientRect();
  const call=doc.querySelector('.call-info:not([hidden])')?.getBoundingClientRect();
  let left=12,right=rect.width-12,top=8,bottom=rect.height-10;
  if(controls?.width && controls.left>rect.left)right=Math.min(right,controls.left-rect.left-8);
  if(overview?.width){
    if(overview.left-rect.left>rect.width/2)right=Math.min(right,rect.width-54-(Number.parseFloat(viewport.style.getPropertyValue('--map-overview-width'))||84)-8);
    else left=Math.max(left,overview.right-rect.left+8);
  }
  if(call?.height && call.bottom>rect.top && call.top<rect.bottom)top=Math.max(top,call.bottom-rect.top+8);
  if(dock?.height && dock.top>rect.top && dock.top<rect.bottom)bottom=Math.min(bottom,dock.top-rect.top-10);
  return {left,top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
