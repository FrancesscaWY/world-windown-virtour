import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttractionGuidance } from '../server/ai/attraction-guidance.ts';
import { executeTool, modelToolOutput, tools } from '../server/ai/tools.ts';
import { runAgent, systemPrompt } from '../server/ai/llm.ts';

test('guidance covers all searchable attractions with only Eiffel Tower filled in', () => {
  const attractions = executeTool('search_attractions', {}).attractions;
  const attractionGuidance = createAttractionGuidance(attractions);
  assert.deepEqual(Object.keys(attractionGuidance).sort(), attractions.map(a => a.id).sort());
  for (const attraction of attractions) {
    const result = executeTool('get_attraction_guidance', { poi_id: attraction.id });
    assert.equal(result.poi_id, attraction.id);
    assert.equal(result.name, attraction.name);
    if (attraction.id === 'eiffel') {
      assert.equal(result.status, 'found');
      for (const expected of [/108米/, /1:3/, /参考导游词：四座塔脚/, /不以真假声明开场/, /不假定游客已到达/, /不承诺登塔/]) assert.match(result.guidance, expected);
    } else {
      assert.equal(result.status, 'placeholder');
      assert.equal(result.guidance, '暂无提示');
    }
    assert.deepEqual(modelToolOutput('get_attraction_guidance', result), result);
  }
});

test('guidance validates its only parameter and distinguishes unknown IDs from placeholders', () => {
  const tool = tools.find(t => t.function.name === 'get_attraction_guidance');
  assert.deepEqual(tool.function.parameters.required, ['poi_id']);
  assert.equal(tool.function.parameters.additionalProperties, false);
  for (const args of [null, {}, { poi_id: '' }, { poi_id: ' ' }, { poi_id: 123 }, { poi_id: 'eiffel', extra: true }, { poi_id: 'x'.repeat(81) }]) {
    assert.ok(executeTool('get_attraction_guidance', args).error);
  }
  for (const poi_id of ['unknown', '埃菲尔铁塔', 'toString', '__proto__']) {
    const result = executeTool('get_attraction_guidance', { poi_id });
    assert.equal(result.status, 'not_found');
    assert.equal(result.guidance, null);
    assert.ok(result.error);
  }
  assert.equal(executeTool('get_attraction_guidance', { poi_id: ' eiffel ' }).status, 'found');
});

test('text agent exposes and executes guidance before composing the visitor answer', async () => {
  assert.match(systemPrompt, /先调用 get_attraction_guidance/);
  assert.match(systemPrompt, /不把占位文本当作景点介绍/);
  let rounds = 0;
  const result = await runAgent({ provider: {}, city: '深圳', messages: [{ role: 'user', content: '介绍一下铁塔' }], complete: async (_provider, body) => {
    assert.ok(body.tools.some(t => t.function.name === 'get_attraction_guidance'));
    if (!rounds++) return { choices: [{ message: { tool_calls: [{ id: 'guidance', function: { name: 'get_attraction_guidance', arguments: '{"poi_id":"eiffel"}' } }] } }] };
    const evidence = JSON.parse(body.messages.at(-1).content);
    assert.equal(evidence.status, 'found');
    assert.match(evidence.guidance, /参考导游词/);
    return { choices: [{ message: { content: '园内铁塔高108米，以巴黎埃菲尔铁塔为原型仿建。' } }] };
  } });
  assert.equal(result.traces[0].name, 'get_attraction_guidance');
  assert.equal(result.traces[0].status, 'done');
});
