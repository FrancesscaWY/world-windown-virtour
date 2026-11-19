import { z } from 'zod';
import { parkCatalog } from '../../src/data/park-catalog.js';
import { artworkNetwork, shortestArtworkPath, artworkPosition } from './artwork-network.ts';
import type { PageContext } from './types.ts';
import { toMapPosition, nearestPoi } from '../../src/guide/location.js';
import { projectMapPosition } from '../../src/components/map-projection.js';
import { validVisitorPosition } from '../../src/data/nearby-attractions.js';

// The model selects the stops and their order; only the server supplies map coordinates.
const routePois = parkCatalog.filter(poi => poi.locationVerified && poi.position);
const poiIds = routePois.map(poi => poi.id) as [string, ...string[]];
const poiId = z.enum(poiIds).describe(`可规划的园内景点 ID：${routePois.map(poi => `${poi.id}=${poi.name}（${poi.region}）`).join('；')}`);

export const routeSchema = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(500).describe('结合用户需求说明路线安排，不承诺实时开放、最短路径或精确时长'),
  stops: z.array(z.object({
    poi_id: poiId,
    reason: z.string().trim().min(1).max(200).describe('该站的游览建议或选择原因，基于已查询的景点资料'),
  }).strict()).min(2).max(12).refine(stops => new Set(stops.map(stop => stop.poi_id)).size === stops.length, '路线不能包含重复景点'),
}).strict();

export function planRoute({ title, summary, stops }: z.infer<typeof routeSchema>, loadNetwork = artworkNetwork, context?: PageContext) {
  let network: ReturnType<typeof artworkNetwork>;
  try { network = loadNetwork(); }
  catch { return { status: 'unavailable', error: '手绘路网数据暂时不可用，无法生成路线示意。', route: null }; }
  const {graph,sha256}=network;
  const anchors=stops.map(stop=>{
    const poi=routePois.find(p=>p.id===stop.poi_id)!;
    const nodeId = graph.anchors[poi.id];
    return {poi,reason:stop.reason,road:graph.nodes.has(nodeId) ? {nodeId} : null};
  });
  const missing=anchors.find(a=>!a.road);
  if(missing) return {status:'unavailable',error:`${missing.poi.name}尚未关联手绘道路，无法生成路线示意。`,route:null};
  // Never substitute the selected landmark for the visitor's configured location.
  let origin = null;
  if (validVisitorPosition(context?.visitorPosition)) {
    const coordinates = context!.visitorPosition!, geographic = toMapPosition(coordinates);
    const point = projectMapPosition(geographic), nearest = nearestPoi(coordinates);
    const knownAnchor = nearest && nearest.distance <= 35 ? graph.anchors[nearest.poi.id] : undefined;
    const node = knownAnchor !== undefined ? graph.nodes.get(knownAnchor)
      : [...graph.nodes.values()].sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
    if (!node || geographic.x<0 || geographic.x>100 || geographic.y<0 || geographic.y>100
      || knownAnchor === undefined && Math.hypot(node.x-point.x,node.y-point.y)>5)
      return {status:'unavailable',error:'当前位置尚未关联园区手绘道路，请在定位设置选择园内起点。',route:null};
    origin = {kind:'visitor' as const, ...coordinates, locationSource:context?.locationSource ?? 'device',
      name:nearest && nearest.distance<=35 ? `${nearest.poi.name}附近` : '当前位置', position:geographic,
      roadAnchor:{nodeId:node.id,position:artworkPosition(graph,node.id),entranceVerified:false as const}};
  }
  const nodeIds=[origin?.roadAnchor.nodeId ?? anchors[0].road!.nodeId],roadIds:string[]=[],stopIndices:number[]=[];
  const legs=[];
  if(origin && origin.roadAnchor.nodeId!==anchors[0].road!.nodeId){
    const path=shortestArtworkPath(graph,origin.roadAnchor.nodeId,anchors[0].road!.nodeId);
    if(!path)return {status:'unavailable',error:'当前位置与首站之间的手绘道路尚未连通。',route:null};
    nodeIds.push(...path.nodes.slice(1));roadIds.push(...path.edges.map(e=>e.roadId));
    legs.push({from:'visitor',to:anchors[0].poi.id,startIndex:0,endIndex:nodeIds.length-1});
  }
  stopIndices.push(nodeIds.length-1);
  for(let i=1;i<anchors.length;i++) {
    const path=shortestArtworkPath(graph,anchors[i-1].road!.nodeId,anchors[i].road!.nodeId);
    if(!path) return {status:'unavailable',error:`${anchors[i-1].poi.name}与${anchors[i].poi.name}之间的手绘路网尚未连通，未生成路线。`,route:null};
    const startIndex=nodeIds.length-1;
    nodeIds.push(...path.nodes.slice(1));roadIds.push(...path.edges.map(e=>e.roadId));stopIndices.push(nodeIds.length-1);
    legs.push({from:anchors[i-1].poi.id,to:anchors[i].poi.id,startIndex,endIndex:nodeIds.length-1});
  }
  if(nodeIds.length<2) return {status:'unavailable',error:'所选景点对应同一个手绘道路点，暂不能据此生成路线示意。',route:null};
  return {
    status: 'success',
    route: {
      title, summary, kind: 'llm-suggested', origin,
      stops: anchors.map(({poi,reason,road}) => ({poiId:poi.id,name:poi.name,region:poi.region,position:poi.position,source:poi.source,reason,roadAnchor:{nodeId:road!.nodeId,position:artworkPosition(graph,road!.nodeId),entranceVerified:false}})),
      geometry: {kind:'artwork-traced',coordinateSpace:'artwork-percent',points:nodeIds.map(id=>artworkPosition(graph,id)),nodeIds,roadIds,stopIndices,legs,sourceSha256:sha256},
      distanceMeters: null,
      source: {name:'按手绘底图描绘的路网',url:'/assets/map.jpg',kind:'illustration'},
      disclaimer: '路线沿手绘底图上描绘的道路展示游览顺序；这是图像坐标示意，不是实测地理路网，不提供真实距离或导航保证。入口与当天通行请以现场为准。',
    },
  };
}
