import { parkServices } from './park-services.js';
import { parkCatalog } from './park-catalog.js';
export { parkServices };
const diningSource = 'https://sz.bendibao.com/tour/202057/ly835993.html';
// Relative evidence identifies an area, never an exact restaurant coordinate.
const diningAreas = [
  ['rome-dining','罗马餐厅','eiffel','罗马假日广场，铁塔对面'],
  ['caesar-dining','恺撒宫餐厅','caesar','恺撒宫西侧'],
  ['falls-dining','瀑布餐厅','niagara','尼亚加拉大瀑布旁'],
].map(([id,name,anchorPoiId,area]) => ({ id, kind:'food', name, position:null, anchorPoiId, area,
  source:diningSource, sourceKind:'深圳本地宝 · 2020-11-02 餐饮导览', checkedAt:'2026-11-16',
  note:`资料位置：${area}。仅标示所在区域，非精确店址；2020 年资料，当前名称、营业与通行情况请向园方确认。`, accessVerified:false,
}));
export function facilityMapPosition(item) {
  return item.position ?? (item.anchorPoiId ? parkCatalog.find(p=>p.id === item.anchorPoiId)?.position : null) ?? null;
}
export const facilities = [...parkServices.facilities, ...diningAreas, {
  id:'official-ticket-center',kind:'service',name:'前广场票务中心',position:null,
  source:'https://www.ctgii.com/scenic/theme_park/62',sourceKind:'中旅国际 · 运营方',
  note:'官方公布的线下票务办理地点：世界之窗前广场票务中心。咨询电话 0755-26608000（票务分机 8105）。尚未取得可核实坐标。',phone:'075526608000',
}, {
  id:'international-street',kind:'service',name:'国际街商业服务区',position:null,
  source:'https://m.bendibao.com/show3448_5.html',sourceKind:'深圳本地宝 · 2024 年资料',
  note:'公开资料介绍为休憩、购物和餐饮区域。尚未取得可核实坐标，当前营业内容请以现场为准。',
}];
export const facilityKinds = {toilets:'卫生间',gate:'出入口',service:'服务',other:'其他设施',food:'餐饮',parking:'停车场'};
export function facilityResult(kind, id = null) {
  const items = facilities.filter(item => id ? item.id === id : kind === 'other' ? !['food','toilets'].includes(item.kind) : item.kind === kind);
  const title = id && items.length ? items[0].name : facilityKinds[kind] ?? '园区服务';
  const text = kind === 'gate' ? '找到两处园界门，还不能确认是否开放。离园请跟随现场出口指示。'
    : kind === 'toilets' ? '卫生间标好啦。还没有你的定位，不能判断哪一处最近；开放情况以现场为准。'
    : kind === 'service' || kind === 'other' ? '票务和咨询可联系前广场票务中心；服务地点没有可靠坐标时仅展示资料。园界门通行与设施开放请以现场为准。'
    : kind === 'food' ? '已标出资料提到的餐饮区域。依据 2020 年导览，只能作附近参考，不是精确店址；当前营业请向园方确认。'
    : items.length ? `已标出公开地图中的${title}，开放情况以现场为准。` : `还没有核实园内${title}的位置，可以向工作人员询问，或查看服务资料联系园区。`;
  return {kind,id,title,text,items:items.length ? items : facilities.filter(item => item.kind === 'service')};
}
