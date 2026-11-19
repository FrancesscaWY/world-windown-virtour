// Camera angles are radians; FOV is degrees. Calibrated against the local cube faces.
// Share this allowlist between backend tools and frontend projection/camera controls.
export const panoramaHotspots = Object.freeze({
  eiffel: Object.freeze([
    { id: 'tower-feet', title: '舒展的塔脚', yaw: -0.50, pitch: 0.28, fov: 65,
      body: '先看画面左侧向外舒展的塔脚，再沿钢架向上观察。宽阔的底部像稳稳站住的双脚，上部的线条一路收拢，把目光轻轻带向塔尖。' },
    { id: 'tower-arch', title: '拱形与钢架', yaw: 0, pitch: 0.58, fov: 58,
      body: '看塔脚之间的弧形轮廓，再看看后面交叉排列的钢架。曲线与几何线条层层相叠，让铁塔既显得稳重，又有向上生长的轻盈感。' },
    { id: 'tower-spire', title: '向上收拢的塔身', yaw: 0, pitch: 1.07, fov: 55,
      body: '把视线抬高，塔身的线条一路向上收拢，直到细长的塔尖。这里重现了巴黎埃菲尔铁塔的轮廓，从宽阔的塔脚望向天空，最能感受它的挺拔。' },
    { id: 'garden-shade', title: '塔旁绿荫', yaw: Math.PI / 2, pitch: 0.10, fov: 65,
      body: '转向塔旁，画面里能看到树荫、步道和座椅。钢铁建筑与园林绿意形成对照，换个方向取景，又是不一样的味道。' },
  ].map(point => Object.freeze({ ...point, note: '看点位置依据用户提供的铁塔实景素材标注；高度与比例沿用本地文档口径（截至2026-11-12，附录来源未独立核验），非实时运营信息。' }))),
});

export const getPanoramaHotspot = (poiId, hotspotId) =>
  (panoramaHotspots[poiId] ?? []).find(point => point.id === hotspotId) ?? null;
