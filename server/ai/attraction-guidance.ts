// Use the merged discovery catalog so document aliases share the same canonical POI ID.
// Every attraction has an entry; fill in more scripts here later.
export function createAttractionGuidance(attractions: { id: string }[]): Readonly<Record<string, string>> {
  return Object.freeze({
    ...Object.fromEntries(attractions.map(attraction => [attraction.id, '暂无提示'])),
    eiffel: [
      '简单讲解：控制在两三句话，从四座塔脚与逐渐收拢的钢架轮廓讲起，用有趣的观察线索带游客欣赏，不以真假声明开场。园内高度108米、与巴黎原塔约1:3的比例可在游客问高度或比例时自然补充，不必每次都念。不自动进入全景或连续转动镜头；用户要求详细讲解时改用 get_detailed_attraction_guidance。',
      '参考导游词：四座塔脚像把铁塔稳稳托起，钢架的线条再一路向塔尖收拢。沿着这个轮廓慢慢看，厚重的钢铁也有了轻盈的感觉。',
      '使用时按游客是否在现场调整“眼前”“抬头”等措辞，不假定游客已到达；不承诺登塔、电梯、灯光秀等当天开放安排。',
      '高度与比例沿用本地知识库的文档口径（截至2026-11-12，附录来源未独立核验），不是实时运营信息。',
    ].join(''),
  });
}
