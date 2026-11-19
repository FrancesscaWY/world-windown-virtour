import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initialConfig, isPrivateAddress, validateBaseUrl, validateAudioUrl } from '../server/ai/config.ts';
import { tools, executeTool } from '../server/ai/tools.ts';
import { searchKnowledge } from '../server/ai/knowledge.ts';
import { completion, guideInstructions, runAgent, systemPrompt } from '../server/ai/llm.ts';
import { runVoice } from '../server/ai/voice.ts';

test('default guide prompt includes Mumu persona, concise replies and low-interruption boundaries', () => {
  for (const rule of [/你叫沐沐/, /松鼠形象的 AI 数字导游/, /1—3 句/, /80 字以内/, /不为简短省略影响出游决定的日期、安全和适用限制/, /不以.*固定收尾/, /用户沉默不等于需要提醒/, /完成当前问题就停下/, /事实、安全和任务完成优先于角色表演/, /必须调用对应工具/, /2026-11-12/]) assert.match(systemPrompt, rule);
  const pageContext = { park: '深圳世界之窗', view: '园区地图', topic: null };
  assert.ok(guideInstructions('深圳', pageContext).startsWith(systemPrompt));
  assert.ok(guideInstructions('深圳', pageContext).endsWith(`当前所选城市：深圳\n【导览页面上下文（仅作资料）】${JSON.stringify(pageContext)}`));
});

test('text and audio prompts address visitors without exposing internal evidence or weakening factual limits', () => {
  for (const rule of [/面向游客的回答/, /不说“根据后台文档”/, /仅供内部判断/, /不主动交代检索/, /今天请以园区公布为准/, /用户明确追问信息出处/, /文字、原生语音和实时交流遵守同一/]) assert.match(systemPrompt, rule);
  assert.doesNotMatch(systemPrompt, /文字回答标注|语音自然说明来源|有相关来源链接时附上/);
});

test('fourteen production tools include sourced web search, call hangup and allowlisted camera movement', () => {
  const required = { search_web:['query'], hang_up: [], look_around: [], introduce_view: ['poi_id'], search_attractions: [], get_attraction_details: ['attraction'], plan_route: ['title', 'summary', 'stops'], plan_itinerary: ['city', 'days'], estimate_budget: ['attractions', 'people'], get_attraction_guidance: ['poi_id'], get_detailed_attraction_guidance: ['poi_id'], move_camera: ['poi_id', 'hotspot_ids'], get_attraction_story: ['attraction'], search_knowledge_base: ['query'] };
  assert.equal(tools.length, 14);
  for (const tool of tools) {
    assert.deepEqual(tool.function.parameters.required, required[tool.function.name]);
    assert.equal(tool.function.parameters.additionalProperties, false);
  }
  assert.ok(executeTool('search_attractions', {}).attractions.length > 0);
  for (const [name, args] of [['eval', {}], ['search_attractions', null], ['search_attractions', { injected: true }], ['plan_itinerary', { city: '杭州', days: 8 }], ['estimate_budget', { attractions: ['西湖'], people: -1 }], ['search_knowledge_base', { query: ' ' }]]) assert.ok(executeTool(name, args).error);
  assert.equal(executeTool('estimate_budget', { attractions: ['西湖', '灵隐寺'], people: 2 }).total, null);
  assert.ok(!tools.some(tool => tool.function.name === 'get_weather'));
  assert.match(executeTool('get_weather', { city: '深圳' }).error, /不支持/);
  assert.equal(executeTool('search_attractions', { city: '杭州' }).attractions.length, 0);
  assert.equal(executeTool('search_attractions', { max_price: 0 }).status, 'unavailable');
});

test('hangup requires trusted active call context and explicit end-of-call intent in the prompt', () => {
  assert.deepEqual(executeTool('hang_up', {}, { callActive: true }), { status: 'success', action: 'hang_up' });
  for (const context of [undefined, {}, { callActive: false }]) assert.ok(executeTool('hang_up', {}, context).error);
  assert.ok(executeTool('hang_up', { injected: true }, { callActive: true }).error);
  for (const rule of [/必须立即调用 hang_up/, /不能只口头答应却保持通话/, /不追问确认/, /单独说“谢谢”/, /安静一下/, /别挂电话/, /引用或转述/]) assert.match(systemPrompt, rule);
});

test('document knowledge preserves provenance, citations, temporal limitations and empty retrieval', () => {
  const result = searchKnowledge({ query: '世界之窗地铁怎么去', limit: 1 });
  assert.equal(result.retrieval, 'local-keyword');
  assert.equal(result.results[0].citation, 'WOW:transport');
  assert.equal(result.snapshot_date, '2026-11-12');
  assert.equal(result.results[0].sources[0].accessed_at, null);
  assert.match(result.results[0].sources[0].verification, /用户提供|未独立核验/);
  assert.equal(result.results[0].current_status, 'not_verified');
  for (const query of ['门票多少钱', '几点开放', '烟花演出']) assert.equal(searchKnowledge({ query, limit: 1 }).results[0].kind, 'dynamic');
  assert.equal(searchKnowledge({ query: '亲子带娃', limit: 1 }).results[0].kind, 'editorial');
  assert.equal(searchKnowledge({ query: '世界之窗火星基地暗号' }).status, 'not_found');
  assert.equal(executeTool('estimate_budget', { attractions: ['世界之窗'], people: 2 }).total, null);
});

test('production catalog tools use sourced park records with no invented operational fields', () => {
  const found = executeTool('search_attractions', { keyword: '铁塔' });
  assert.ok(found.attractions.some(a => a.id === 'eiffel' && a.source.startsWith('https://')));
  const details = executeTool('get_attraction_details', { attraction: '铁塔' });
  assert.equal(details.attraction.id, 'eiffel');
  assert.equal(details.ticket_price, null); assert.equal(details.opening_hours, null);
  const story = executeTool('get_attraction_story', { attraction: '不存在的景点' });
  assert.equal(story.status, 'not_found'); assert.equal(story.story, null);
  const plan = executeTool('plan_itinerary', { city: '深圳', days: 1 });
  assert.equal(plan.route, null); assert.equal(plan.ticket_total, null);
  assert.ok(plan.results.some(entry => entry.citation === 'WOW:route-r01'));
  assert.equal(executeTool('plan_itinerary', { city: '杭州', days: 1 }).status, 'unavailable');
});

test('model completions call the supplier directly with path, port, auth and redirect protection', async () => {
  for (const baseUrl of ['https://8.8.8.8:8443/v1', 'https://8.8.8.8:8443/compatible-mode/v1/']) {
    const result = await completion({ baseUrl, model: 'test-model', apiKey: 'private-key' }, { messages: [{ role: 'user', content: '你好' }], tools }, {
      fetchImpl: async (url, options) => {
        assert.equal(url, baseUrl.replace(/\/$/, '') + '/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer private-key'); assert.equal(options.redirect, 'error');
        assert.equal(JSON.parse(options.body).tools.length, 14);
        return Response.json({ choices: [{ message: { content: '你好！' } }] });
      },
    });
    assert.equal(result.choices[0].message.content, '你好！');
  }
  await assert.rejects(completion({ baseUrl: 'https://8.8.8.8', model: 'test', apiKey: 'key' }, { messages: [] }, { fetchImpl: async () => new Response('PRIVATE', { status: 401 }) }), error => !error.message.includes('PRIVATE') && error.message.includes('401'));
  await assert.rejects(completion({ baseUrl: 'https://8.8.8.8', model: 'test', apiKey: 'key' }, { messages: [] }, {
    fetchImpl: async () => Response.json({ error: { code:'model_not_found', message:'PRIVATE upstream details' } }, { status:503 }),
  }), error => /没有可用通道/.test(error.message) && !error.message.includes('PRIVATE'));
});

test('text model executes local tools, preserves reasoning only upstream and returns sourced answers', async () => {
  const requests = [];
  const result = await runAgent({ provider: {}, city: '深圳', pageContext: { park: '深圳世界之窗', view: '园区地图', topic: null }, messages: [{ role: 'user', content: '世界之窗怎么坐地铁去' }], complete: async (_provider, body) => {
    requests.push(structuredClone(body));
    if (requests.length === 1) return { choices: [{ message: { content: null, reasoning_content: 'PRIVATE-REASONING', tool_calls: [{ id: 'kb', function: { name: 'search_knowledge_base', arguments: '{"query":"世界之窗地铁","limit":1}' } }] } }], usage: { total_tokens: 10 } };
    const evidence = JSON.parse(body.messages.at(-1).content);
    assert.equal(evidence.results[0].citation, 'WOW:transport');
    assert.equal(body.messages.at(-2).reasoning_content, 'PRIVATE-REASONING');
    return { choices: [{ message: { content: '来源待复核的资料列出世界之窗站。[WOW:transport]' } }], usage: { total_tokens: 5 } };
  } });
  assert.equal(requests[0].messages[0].role, 'system');
  assert.ok(requests[0].messages[0].content.startsWith(systemPrompt));
  assert.match(requests[0].messages[0].content, /页面上下文/);
  assert.equal(result.usage.total_tokens, 15); assert.equal(result.traces[0].status, 'done');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-REASONING/);
});

test('text tool errors are fed back and tool loops remain bounded', async () => {
  let calls = 0;
  const result = await runAgent({ provider: {}, messages: [], city: '深圳', complete: async (_provider, body) => {
    if (!calls++) return { choices: [{ message: { tool_calls: [{ id: 'bad', function: { name: 'search_knowledge_base', arguments: '{broken' } }] } }] };
    assert.match(body.messages.at(-1).content, /不是合法 JSON/);
    return { choices: [{ message: { content: '请再说一次。' } }] };
  } });
  assert.equal(result.traces[0].status, 'error');
  calls = 0;
  await assert.rejects(runAgent({ provider: {}, messages: [], city: '深圳', complete: async () => ({ choices: [{ message: { tool_calls: [{ id: String(calls++), function: { name: 'search_knowledge_base', arguments: '{"query":"深圳世界之窗"}' } }] } }] }) }), /超出/);
  assert.equal(calls, 6);
});

test('model endpoint restrictions reject private networks, credentials, queries and non-TLS URLs', async () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(isPrivateAddress(address), true);
  for (const url of ['http://8.8.8.8', 'https://127.0.0.1', 'https://user:pass@8.8.8.8', 'https://8.8.8.8?key=secret']) await assert.rejects(validateBaseUrl(url));
  assert.equal((await validateAudioUrl('wss://8.8.8.8:9443/realtime')).port, '9443');
});

class FakeSocket extends EventEmitter {
  sent = [];
  terminated = false;
  send(raw) { this.sent.push(JSON.parse(raw)); }
  terminate() { this.terminated = true; }
  event(type, data = {}) { this.emit('message', Buffer.from(JSON.stringify({ type, ...data }))); }
}
async function voiceFixture(extra = {}) {
  const socket = new FakeSocket(), events = [];
  const promise = runVoice({ provider: initialConfig({ DASHSCOPE_API_KEY: 'private-native-key' }).audio, audio: Buffer.alloc(6400).toString('base64'), city: '深圳', messages: [{ role: 'assistant', content: '你好' }], onEvent: e => events.push(e),
    validateUrl: async value => new URL(value), connect: (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer private-native-key'); assert.equal(options.followRedirects, false);
      return socket;
    }, ...extra });
  await Promise.resolve();
  return { socket, events, promise };
}
function start(socket) {
  for (const type of ['session.created', 'session.updated', 'input_audio_buffer.committed']) socket.event(type);
  socket.event('response.created', { response: { id: 'response-1' } });
}
const done = socket => socket.event('response.done', { response: { status: 'completed' } });
const call = (socket, id, name, args) => socket.event('response.function_call_arguments.done', { call_id: id, name, arguments: args });

test('native Qwen PCM/tool/knowledge/audio protocol runs entirely in the migrated backend', async () => {
  const { socket, events, promise } = await voiceFixture(); start(socket);
  assert.equal(socket.sent[0].session.tools.length, 14);
  assert.equal(socket.sent[0].session.turn_detection, null);
  assert.ok(socket.sent[0].session.instructions.startsWith(systemPrompt));
  assert.match(socket.sent[0].session.instructions, /回答结束就交还话轮，不自行续讲/);
  assert.match(socket.sent[0].session.instructions, /必须在本轮重新调用对应工具/);
  assert.equal(socket.sent.filter(e => e.type === 'input_audio_buffer.append').length, 2);
  socket.event('conversation.item.input_audio_transcription.completed', { transcript: '世界之窗怎么坐地铁去' });
  call(socket, 'knowledge', 'search_knowledge_base', '{"query":"世界之窗地铁","limit":1}'); done(socket);
  assert.equal(JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output).results[0].citation, 'WOW:transport');
  socket.event('response.created', { response: { id: 'response-2' } });
  socket.event('response.audio_transcript.done', { transcript: '资料待复核。' });
  socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') }); done(socket);
  const result = await promise;
  assert.equal(result.content, '资料待复核。'); assert.equal(result.traces[0].name, 'search_knowledge_base');
  assert.equal(events.filter(e => e.type === 'audio_delta').length, 1);
  assert.ok(socket.terminated); assert.doesNotMatch(JSON.stringify(events), /private-native-key/);
});

test('native voice uses imported document evidence and preserves source/date restrictions', async () => {
  const { socket, promise } = await voiceFixture(); start(socket);
  assert.match(socket.sent[0].session.instructions, /2026-11-12/);
  call(socket, 'doc-knowledge', 'search_knowledge_base', '{"query":"埃菲尔铁塔复制比例","limit":1}'); done(socket);
  const evidence = JSON.parse(socket.sent.find(e => e.item?.type === 'function_call_output').item.output);
  assert.equal(evidence.results[0].citation, 'WOW:eiffel-scale');
  assert.match(evidence.results[0].content, /1:3/);
  assert.match(evidence.disclaimer, /未独立核验/);
  socket.event('response.created', { response: { id: 'doc-response' } });
  socket.event('response.audio_transcript.done', { transcript: '用户文档记载园内铁塔按一比三仿建。' });
  socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') }); done(socket);
  const result = await promise;
  assert.equal(result.traces[0].result.results[0].id, 'eiffel-scale');
  assert.match(result.content, /用户文档/);
});

test('native voice executes nearby discovery with the current page location context', async () => {
  const { socket, events, promise } = await voiceFixture({ pageContext: { park: '深圳世界之窗', view: '园区地图', topic: { id: 'eiffel', name: '埃菲尔铁塔' } } });
  start(socket);
  call(socket, 'nearby-voice', 'look_around', '{}'); done(socket);
  const output = JSON.parse(socket.sent.find(event => event.item?.type === 'function_call_output').item.output);
  assert.equal(output.status, 'success'); assert.equal(output.origin.poiId, 'eiffel'); assert.ok(output.items.length);
  assert.ok(events.some(event => event.type === 'tool_end' && event.trace.name === 'look_around'));
  socket.event('response.created', { response: { id: 'nearby-answer' } });
  socket.event('response.audio_transcript.done', { transcript: '以铁塔为中心，附近有这些景点。' });
  socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') }); done(socket);
  assert.equal((await promise).traces[0].name, 'look_around');
});

test('native voice executes attraction guidance using the shared tool allowlist', async () => {
  const { socket, promise } = await voiceFixture(); start(socket);
  assert.ok(socket.sent[0].session.tools.some(tool => tool.function.name === 'get_attraction_guidance'));
  assert.match(socket.sent[0].session.instructions, /先调用 get_attraction_guidance/);
  call(socket, 'tower-guidance', 'get_attraction_guidance', '{"poi_id":"eiffel"}'); done(socket);
  const evidence = JSON.parse(socket.sent.find(event => event.item?.type === 'function_call_output').item.output);
  assert.equal(evidence.status, 'found');
  assert.match(evidence.guidance, /参考导游词/);
  socket.event('response.created', { response: { id: 'guidance-answer' } });
  socket.event('response.text.done', { text: '园内铁塔高108米，塔身从四个塔脚向上逐渐收拢。' }); done(socket);
  assert.equal((await promise).traces[0].name, 'get_attraction_guidance');
});

test('native voice executes route planning on the backend and emits its route before the answer', async () => {
  const { socket, events, promise } = await voiceFixture(); start(socket);
  const definitions = socket.sent[0].session.tools;
  assert.ok(definitions.some(tool => tool.function.name === 'plan_route'));
  assert.ok(!definitions.some(tool => tool.function.name === 'get_weather'));
  call(socket, 'route-voice', 'plan_route', JSON.stringify({ title: '建筑游', summary: '欣赏欧洲建筑轮廓', stops: [{ poi_id: 'arc', reason: '拱门' }, { poi_id: 'eiffel', reason: '塔身' }] }));
  done(socket);
  const result = JSON.parse(socket.sent.find(event => event.item?.type === 'function_call_output').item.output);
  assert.deepEqual(result.route.stops.map(stop => stop.poiId), ['arc', 'eiffel']);
  assert.equal(result.route.geometry.points, undefined, 'voice model receives a compact route summary');
  assert.ok(events.find(event => event.type === 'tool_end').trace.result.route.geometry.points.length > 2, 'frontend receives the complete road geometry');
  assert.equal(events.find(event => event.type === 'tool_end').trace.result.route.title, '建筑游');
  socket.event('response.created', { response: { id: 'route-answer' } });
  socket.event('response.text.done', { text: '建议先看凯旋门，再看铁塔，入口连接待核实。' }); done(socket);
  assert.equal((await promise).traces[0].name, 'plan_route');
});

test('native voice suppresses duplicate tool calls and rejects bad arguments, excessive loops, errors and truncation', async () => {
  const one = await voiceFixture(); start(one.socket);
  call(one.socket, 'bad', 'search_knowledge_base', '{broken'); done(one.socket);
  call(one.socket, 'bad', 'search_knowledge_base', '{broken');
  one.socket.event('response.created', { response: { id: 'error-answer' } });
  one.socket.event('response.text.done', { text: '请再说一次。' }); done(one.socket);
  assert.equal((await one.promise).traces.length, 1);
  for (const type of ['calls', 'rounds', 'error', 'close', 'empty', 'invalid-audio', 'failed']) {
    const f = await voiceFixture(); start(f.socket);
    const rejection = assert.rejects(f.promise);
    if (type === 'calls') for (let i = 0; i < 9; i++) call(f.socket, String(i), 'search_knowledge_base', '{"query":"深圳世界之窗"}');
    if (type === 'rounds') for (let i = 0; i < 6; i++) { call(f.socket, String(i), 'search_knowledge_base', '{"query":"深圳世界之窗"}'); done(f.socket); }
    if (type === 'error') f.socket.event('error', { error: { message: 'private-native-key' } });
    if (type === 'close') f.socket.emit('close');
    if (type === 'empty') done(f.socket);
    if (type === 'invalid-audio') f.socket.event('response.audio.delta', { delta: 'invalid!' });
    if (type === 'failed') f.socket.event('response.done', { response: { status: 'failed' } });
    await rejection; assert.ok(f.socket.terminated);
  }
});

test('native voice cancellation and timeout release the supplier WebSocket', async () => {
  const controller = new AbortController();
  const f = await voiceFixture({ signal: controller.signal });
  const rejection = assert.rejects(f.promise, /取消/); controller.abort(); await rejection;
  assert.ok(f.socket.terminated);
  const timeout = await voiceFixture({ timeoutMs: 10 });
  await assert.rejects(timeout.promise, /超时/); assert.ok(timeout.socket.terminated);
});

test('native voice keeps function-call speech internal and streams the following answer immediately', async () => {
  for (const marker of ['item', 'arguments']) {
    const { socket, events, promise } = await voiceFixture(); start(socket);
    assert.match(socket.sent[0].session.instructions, /工具调用前和执行期间保持安静/);
    if (marker === 'item') socket.event('response.output_item.added', { item: { type: 'function_call' } });
    else socket.event('response.function_call_arguments.delta', { delta: '{"query":' });
    socket.event('response.audio_transcript.delta', { delta: '我现在调用 search_knowledge_base。' });
    socket.event('response.text.done', { text: '内部参数 {"query":"铁塔"}' });
    socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') });
    assert.ok(!events.some(e => ['audio_delta', 'answer_delta'].includes(e.type)));
    call(socket, 'quiet-lookup', 'search_knowledge_base', '{"query":"世界之窗 铁塔"}'); done(socket);
    assert.equal(events.find(e => e.type === 'tool_end').trace.status, 'done');
    socket.event('response.created', { response: { id: 'spoken-answer' } });
    socket.event('response.output_item.added', { item: { type: 'message', role: 'assistant' } });
    socket.event('response.audio_transcript.delta', { delta: '园内铁塔是仿建景观。' });
    socket.event('response.audio.delta', { delta: Buffer.alloc(4800).toString('base64') });
    assert.equal(events.filter(e => e.type === 'audio_delta').length, 1, 'normal answer streams before response.done');
    done(socket);
    assert.equal((await promise).content, '园内铁塔是仿建景观。');
  }
});
