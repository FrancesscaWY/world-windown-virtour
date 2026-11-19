import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorGuideStyle, arrivalInstructions } from '../server/ai/guide-style.ts';
import { systemPrompt } from '../server/ai/llm.ts';
import { voiceInstructions } from '../server/ai/voice.ts';
import { createAttractionGuidance } from '../server/ai/attraction-guidance.ts';
import { panoramaHotspots } from '../src/data/panorama-hotspots.js';

test('text and voice share engaging narration policy without sacrificing factual boundaries',()=>{
  for(const prompt of [systemPrompt,voiceInstructions('深圳')]){
    assert.ok(prompt.includes(visitorGuideStyle));
    assert.match(prompt,/不要主动、反复说/);assert.match(prompt,/只有游客问真假、比例、建造年代/);
    assert.match(prompt,/不得把海外原景的年代、尺寸或事件直接说成园内发生/);
    assert.match(prompt,/不确定仍须坦诚/);
    assert.match(prompt,/不要补写资料未提供的天气、光影、声音/);
  }
});
test('arrival instructions keep application consent and interruption but never command a replica disclaimer',()=>{
  const prompt=arrivalInstructions({name:'埃菲尔铁塔',summary:'沿钢架看向逐渐收拢的塔尖。'},true);
  assert.match(prompt,/应用位置通知，并非游客发言/);assert.match(prompt,/游客开口立即让出话轮/);
  assert.match(prompt,/围绕一个值得看的细节/);assert.match(prompt,/模拟来源由界面标识/);
  assert.doesNotMatch(prompt,/这是园内仿建景观，不是海外原建筑/);
  assert.match(prompt,/不把它当作游客真实到场的证据/);
});
test('fixed narration and guidance do not lead with generic authenticity warnings',()=>{
  const guidance=createAttractionGuidance([{id:'eiffel'}]).eiffel;
  assert.doesNotMatch(guidance,/先点明.*仿建|各位游客/);
  assert.match(guidance,/不以真假声明开场/);
  for(const point of panoramaHotspots.eiffel)assert.doesNotMatch(point.body,/不是巴黎原塔|不是海外原建筑|不代表今天的设施/);
});
