import { pois } from './pois.js';
// Historical index transcription from the visitor-supplied tourist map (undated).
// Numbers describe that illustration only: no operational status or GPS is inferred.
export const touristMapSections = [
  { name:'世界广场', entries:[
    {number:1,name:'世界之窗主入口'}, {number:2,name:'世界广场地球喷泉',poiId:'world-fountain'},
    {number:3,name:'国际风情街'}, {number:4,name:'世界文化展览馆'},
  ] },
  { name:'亚洲区', entries:[
    {number:5,name:'富士山',poiId:'fuji'}, {number:6,name:'五重塔'},
    {number:7,name:'泰国大皇宫',poiId:'grand-palace'}, {number:8,name:'泰姬陵',poiId:'taj'},
  ] },
  { name:'大洋洲区', entries:[{number:18,name:'悉尼歌剧院',poiId:'sydney'}] },
  { name:'欧洲区', entries:[
    {number:9,name:'埃菲尔铁塔',poiId:'eiffel'}, {number:10,name:'凯旋门',poiId:'arc'},
    {number:11,name:'比萨斜塔',poiId:'pisa'}, {number:12,name:'荷兰风车',poiId:'windmills'},
  ] },
  { name:'非洲区', entries:[{name:'非洲村落与建筑'},{number:23,name:'金字塔与狮身人面像',poiId:'pyramid'}] },
  { name:'美洲区', entries:[
    {number:17,name:'总统山',poiId:'rushmore'}, {number:20,name:'基督像'},
    {number:21,name:'自由女神像',poiId:'liberty'}, {number:22,name:'美国国会大厦',poiId:'capitol'},
  ] },
  { name:'雕塑园／恐龙园区域', entries:[{number:13,name:'恐龙公园'},{name:'人文雕塑艺术区'}] },
  { name:'冒险峡谷', entries:[{number:14,name:'峡谷漂流'},{number:15,name:'火山景观'},{number:16,name:'极地冰川'}] },
  { name:'梅拉尼亚小镇', entries:[{name:'特色商店街'},{name:'主题餐饮'},{name:'休闲娱乐'}] },
  { name:'动感项目', entries:[
    {number:24,name:'飞跃美洲'},{name:'高空观光塔'},{name:'探险过山车'},
    {name:'VR互动体验'},{name:'沉浸式剧场'},{name:'4D动感影院'},
  ] },
];
// Current map numbering is continuous and independent of the historical reference.
export const touristMapNumbers = Object.fromEntries(pois.filter(poi=>poi.position).map((poi,index)=>[poi.id,index+1]));
export const majorMapPois = ['eiffel','liberty','taj','sydney','fuji','arc','pisa','pyramid','grand-palace','world-fountain','capitol','rushmore'];
export const mapRegions = [
  {name:'世界广场',color:'#854b6b',anchors:['world-fountain']}, {name:'亚洲区',color:'#966023',anchors:['taj','grand-palace','fuji']},
  {name:'大洋洲区',color:'#356b5c',anchors:['sydney']}, {name:'欧洲区',color:'#635386',anchors:['eiffel','arc','pisa']},
  {name:'非洲区',color:'#2c637e',anchors:['pyramid']}, {name:'美洲区',color:'#9c5142',anchors:['liberty','rushmore','capitol']},
];
const regionColors = { ...Object.fromEntries(mapRegions.map(region=>[region.name,region.color])), '游乐体验':'#4e637c' };
export function mapRegionColor(name) { return regionColors[name] ?? '#52616f'; }

export function mapDetailLevel(scale, width = 390) {
  if(scale<=1.05)return 'overview';
  const effective=scale*Math.min(1.7,Math.max(.9,width/390));
  return effective<1.4?'overview':effective<2.7?'landmarks':'detail';
}
export function mapPoiVisible(poi, {level,category='all',forced=false,route=false}={}) {
  if (level==='overview') return route;
  if (forced) return true;
  if (category!=='all') return false;
  if (level==='detail') return true;
  return majorMapPois.includes(poi.id) || level==='landmarks' && ['niagara','colosseum'].includes(poi.id);
}
/** Text label anchor only, averaged from existing registered POIs, never a facility GPS. */
export function mapRegionAnchor(name, points) {
  const anchors=mapRegions.find(region=>region.name===name)?.anchors ?? [];
  const items=points.filter(poi=>anchors.includes(poi.id) && poi.position);
  if(!items.length)return null;
  return {x:items.reduce((sum,p)=>sum+p.position.x,0)/items.length,y:items.reduce((sum,p)=>sum+p.position.y,0)/items.length};
}
