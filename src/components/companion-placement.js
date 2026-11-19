const intersects=(a,b)=>a.x<b.right+8 && a.x+a.width>b.left-8 && a.y<b.bottom+8 && a.y+a.height>b.top-8;

/** Choose a nearby free area. No free area means hide, not cover a reading surface. */
export function safeCompanionPlacement({x,y,width,height,bounds,obstacles=[]}) {
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const candidates=[{x,y},...obstacles.flatMap(o=>[
    {x:o.left-width-12,y},{x:o.right+12,y},{x,y:o.top-height-12},{x,y:o.bottom+12}])];
  for(let col=0;col<=4;col++)for(let row=0;row<=4;row++)
    candidates.push({x:bounds.left+(bounds.right-bounds.left)*col/4,y:bounds.top+(bounds.bottom-bounds.top)*row/4});
  return candidates.map(p=>({x:clamp(p.x,bounds.left,bounds.right),y:clamp(p.y,bounds.top,bounds.bottom)}))
    .filter(p=>!obstacles.some(o=>intersects({...p,width,height},o)))
    .sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0] ?? null;
}
