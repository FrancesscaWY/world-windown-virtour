import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';
import { validateAudioUrl } from './config.ts';
import { voiceInstructions } from './voice.ts';
import { tools, executeTool, modelToolOutput } from './tools.ts';
import { guidePayload } from '../guide.ts';
import type { AudioProvider, Trace, ToolOutput } from './types.ts';
import { diagnosticSchema } from '../call-log.ts';
import type { CallJournal } from '../call-log.ts';
import { getPoi } from '../../src/data/pois.js';
import { distanceMeters, toCoordinates } from '../../src/guide/location.js';
import { arrivalInstructions } from './guide-style.ts';
import { createWebSearch, executeWebSearch } from './web-search.ts';
import type { WebSearch } from './web-search.ts';

interface Options {
  client: WebSocket;
  provider: AudioProvider;
  connect?: (url: string, options: ClientOptions) => WebSocket;
  validateUrl?: typeof validateAudioUrl;
  onClose?: () => void;
  setupTimeoutMs?: number;
  journal?: CallJournal;
  webSearch?: WebSearch;
}
interface ResponseState {
  id: string;
  turn: number;
  cancelled: boolean;
  done: boolean;
  internal: boolean;
  parts: Map<string, { transcript?: string; text?: string }>;
  audio: Map<string, { bytes: number; index: number }>;
  calls: Map<string, { name: string; arguments: string }>;
}

/** A persistent, bidirectional call. Only this server can configure the model or execute tools. */
export function createRealtimeBridge({ client, provider, connect = (url, options) => new WebSocket(url, options),
  validateUrl = validateAudioUrl, onClose = () => {}, setupTimeoutMs = 25000, journal, webSearch = createWebSearch() }: Options) {
  let upstream: WebSocket | null = null, closed = false, started = false, ready = false, configured = false;
  let turn = 0, speaking = false, currentId = '', rounds = 0, inputBytes = 0, windowStart = Date.now();
  let blockedThroughTurn = -1;
  let lastUserAt = -Infinity, lastArrivalAt = -Infinity, arrivalPending = false;
  const arrived = new Set<string>();
  let diagnostics = 0, diagnosticWindow = Date.now();
  let traces: Trace[] = [];
  let toolContext: ReturnType<typeof guidePayload>['pageContext'];
  let responseTimeout: ReturnType<typeof setTimeout> | undefined;
  const responses = new Map<string, ResponseState>();
  const inputTurns=new Map<string,number>();
  const cancellationEvents = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const searchAbort = new AbortController();
  const later = (fn: () => void, delay: number) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; };
  function close(reason = 'closed') {
    if (closed) return;
    closed = true;
    searchAbort.abort();
    for (const timer of timers) clearTimeout(timer);
    clearInterval(heartbeat);
    upstream?.terminate();
    client.close(1000, 'call ended');
    // A dead peer must not hold the API shutdown or a call slot open.
    const timer = setTimeout(() => client.terminate(), 1000); timer.unref();
    client.once('close', () => clearTimeout(timer));
    void journal?.close(reason);
    onClose();
  }
  function emit(event: Record<string, unknown>) {
    if (closed || client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 512 * 1024) { close('downstream-backpressure'); return; }
    journal?.record('browser.out', event, { turn });
    client.send(JSON.stringify(event));
  }
  function fail(code: string, message: string) { emit({ type: 'error', code, message }); close(code); }
  function send(event: Record<string, unknown>) {
    if (closed || upstream?.readyState !== WebSocket.OPEN) return '';
    if (upstream.bufferedAmount > 128 * 1024) { fail('network', '语音网络拥堵，请重新拨打。'); return ''; }
    const id = `evt_${randomUUID()}`;
    journal?.record('provider.out', { event_id: id, ...event }, { turn });
    upstream.send(JSON.stringify({ event_id: id, ...event }));
    return id;
  }
  function cancel(response: ResponseState | undefined) {
    if (!response || response.cancelled) return;
    response.cancelled = true;
    journal?.record('server', { type: 'response.cancel_requested', responseId: response.id, responseTurn: response.turn, generationDone: response.done }, { turn });
    response.calls.clear();
    if (!response.done && response.id === currentId) {
      const id = send({ type: 'response.cancel' });
      if (id) cancellationEvents.set(id, Date.now());
      while (cancellationEvents.size > 32) cancellationEvents.delete(cancellationEvents.keys().next().value!);
    }
  }
  const setup = later(() => fail('connection-timeout', '通话连接超时，请重新拨打。'), setupTimeoutMs);
  later(() => fail('session-expired', '本次通话已到时，请重新拨打。'), 30 * 60 * 1000);
  let alive = true, pingId = '';
  const heartbeat = setInterval(() => {
    if (!alive) { close('heartbeat-timeout'); return; }
    alive = false;
    pingId = randomUUID(); emit({ type: 'ping', id: pingId });
  }, 15000);
  heartbeat.unref();
  client.on('error', () => close('client-error'));
  client.on('close', (code, reason) => {
    journal?.record('server', { type: 'client.socket_closed', code, reason: reason?.toString().slice(0, 1000) }); close('client-disconnected');
  });

  async function start(context: unknown) {
    if (!provider.apiKey) { fail('unconfigured', '实时语音未配置，请配置服务端语音密钥。'); return; }
    try {
      const url = await validateUrl(provider.baseUrl);
      if (closed) return;
      url.searchParams.set('model', provider.model);
      const payload = guidePayload({ context });
      toolContext = payload.pageContext;
      if (toolContext) toolContext.callActive = true;
      upstream = connect(url.toString(), { headers: { Authorization: `Bearer ${provider.apiKey}` },
        followRedirects: false, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
      upstream.on('error', error => {
        journal?.record('server', { type: 'provider.socket_error', name: error.name, message: error.message });
        fail('network', '实时语音连接失败，请检查网络与模型配置。');
      });
      upstream.on('unexpected-response', (_request, response) => {
        journal?.record('server', { type: 'provider.handshake_rejected', status: response.statusCode });
        response.resume(); fail('unavailable', '实时语音服务拒绝连接，请检查模型与权限。');
      });
      upstream.on('close', (code, reason) => {
        if (!closed) { journal?.record('server', { type: 'provider.socket_closed', code, reason: reason?.toString().slice(0, 1000) }); fail('network', '语音连接已断开，请重新拨打。'); }
      });
      upstream.on('message', async (raw: RawData) => {
        if (closed) return;
        try {
          const event = JSON.parse(raw.toString());
          journal?.record('provider.in', event, { turn: event.type === 'input_audio_buffer.speech_started' ? turn + 1 : turn });
          // Some Qwen access errors use a root code/message instead of type:error.
          if(typeof event.code==='string' && /AccessDenied|InvalidApiKey|Forbidden|Unauthorized/i.test(event.code)){
            fail('provider-access','当前账号无法使用已配置的实时语音模型，请在供应商控制台检查模型开通权限或额度。');return;
          }
          if (event.type === 'error') {
            // Cloud VAD can cancel before our request arrives. Qwen sometimes omits
            // error.event_id, so accept only this exact error against a recent cancel.
            for (const [id, at] of cancellationEvents) if (Date.now() - at > 10000) cancellationEvents.delete(id);
            const error = event.error;
            const cancellationId = error?.event_id === undefined ? cancellationEvents.keys().next().value : error.event_id;
            if (error?.type === 'invalid_request_error' && error.code === 'invalid_value'
              && error.param === 'response.cancel' && error.message === 'Conversation has no active response.'
              && cancellationEvents.delete(cancellationId)) {
              journal?.record('server', { type: 'cancel.race_ignored', eventId: cancellationId, providerEventId: event.event_id }); return;
            }
            fail('provider-error', '实时语音服务未能完成请求，请检查模型配置后重拨。'); return;
          }
          if (event.type === 'session.created' && !configured) {
            configured = true;
            send({ type: 'session.update', session: {
              modalities: ['text', 'audio'], voice: provider.voice,
              instructions: `${voiceInstructions(payload.city, toolContext)}\n这是全双工电话。连接成功只主动问候一次，之后等待用户。用户插话立即让出话轮，只回应最新问题，不催促。`,
              input_audio_format: 'pcm', output_audio_format: 'pcm',
              // Verified against Qwen Audio 3.1: acoustic endpointing avoids long semantic waits.
              turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 450 },
              tools, max_history_turns: 20,
            } });
          }
          if (event.type === 'session.updated' && !ready) {
            for (const message of payload.messages) send({ type: 'conversation.item.create', item: {
              type: 'message', role: message.role,
              content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
            } });
            ready = true; clearTimeout(setup);
            emit({ type: 'ready', model: provider.model, ...(journal ? { callId: journal.id, logging: true } : {}) });
            if(toolContext?.tourMode==='interactive'){
              const instruction='【通话接通事件，不是游客发言】现在用一句简短友好的中文招呼游客：“你好，我在！想听哪一处的故事？也可以点地图，我带你看。”只问候这一次，不调用工具，不介绍景点，不回答历史问题。说完等待游客，游客开口立即停止。';
              send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:instruction}]}});
              send({type:'response.create',response:{modalities:['text','audio'],tool_choice:'none',instructions:instruction}});
              responseTimeout=later(()=>fail('response-timeout','开场语暂时未能接通，请重拨。'),90000);
            }
          }
           if (event.type === 'input_audio_buffer.speech_started') {
             lastUserAt = Date.now(); arrivalPending = false;
            clearTimeout(responseTimeout);
            cancel(responses.get(currentId));
             turn++; rounds = 0; traces = []; speaking = true;
             if(typeof event.item_id==='string')inputTurns.set(event.item_id,turn);
             while(inputTurns.size>64)inputTurns.delete(inputTurns.keys().next().value!);
            emit({ type: 'speech_started', turn });
          }
           if (event.type === 'input_audio_buffer.speech_stopped') {
             lastUserAt = Date.now();
            speaking = false; emit({ type: 'speech_stopped', turn });
            clearTimeout(responseTimeout);
            responseTimeout = later(() => fail('response-timeout', '沐沐暂时没有回应，请重新拨打。'), 90000);
          }
          if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') {
            emit({ type: 'transcript', itemId: event.item_id,turn:inputTurns.get(event.item_id)??turn, text: event.transcript.slice(0, 20000) });
          }
           if (event.type === 'response.created') {
             arrivalPending = false;
            const id = event.response?.id;
            if (typeof id !== 'string') throw new Error('Missing response ID');
            currentId = id;
            const response: ResponseState = { id, turn, cancelled: false, done: false, internal: false, parts: new Map(), audio: new Map(), calls: new Map() };
            responses.set(id, response);
            while (responses.size > 32) responses.delete(responses.keys().next().value!);
            if (speaking || turn <= blockedThroughTurn) cancel(response);
            else emit({ type: 'response_started', responseId: id, turn });
          }
          const id = event.response_id ?? event.response?.id;
          const response = responses.get(id);
          if (!response) return;
          if (event.type === 'response.done') response.done = true;
          if (response.cancelled || response.turn !== turn) {
            journal?.record('server', { type: 'response.event_dropped', eventType: event.type, responseId: id, reason: response.cancelled ? 'cancelled' : 'stale-turn' }, { turn }); return;
          }
          const meta = { responseId: id, turn: response.turn };
          // Suppress speech attached to the tool phase; tool execution and map effects still run.
          if (event.type === 'response.output_item.added' && event.item?.type === 'function_call'
            || event.type.startsWith('response.function_call_arguments.')) response.internal = true;
          if (response.internal && /^(response\.audio\.|response\.audio_transcript\.|response\.text\.)/.test(event.type)) {
            journal?.record('server', { type: 'response.event_dropped', eventType: event.type, responseId: id, reason: 'internal-tool-phase' }, { turn });
          }
          if (event.type === 'response.audio.delta' && !response.internal) {
            if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.delta) || typeof event.item_id !== 'string') throw new Error('Invalid audio');
            const pcm = Buffer.from(event.delta, 'base64');
            const item = response.audio.get(event.item_id) ?? { bytes: 0, index: event.content_index ?? 0 };
            item.bytes += pcm.length;
            if (pcm.length % 2 || item.bytes > 24000 * 2 * 120) throw new Error('Audio too long');
            response.audio.set(event.item_id, item);
            emit({ type: 'audio', ...meta, itemId: event.item_id, contentIndex: item.index, audio: event.delta });
          }
          const textKind = event.type.startsWith('response.audio_transcript.') ? 'transcript' : event.type.startsWith('response.text.') ? 'text' : null;
          if (textKind && !response.internal) {
            const value = event.type.endsWith('.delta') ? event.delta : event[textKind];
            if (typeof value === 'string') {
              const key = `${event.item_id}:${event.content_index ?? 0}`;
              const part = response.parts.get(key) ?? {};
              part[textKind] = event.type.endsWith('.delta') ? (part[textKind] ?? '') + value : value;
              response.parts.set(key, part);
              const text = [...response.parts.values()].map(part => part.transcript || part.text || '').join('\n');
              if (text.length > 30000) throw new Error('Text too long');
              emit({ type: 'answer', ...meta, text });
            }
          }
          if (event.type === 'response.function_call_arguments.done') {
            if (typeof event.call_id !== 'string' || typeof event.name !== 'string' || typeof event.arguments !== 'string' || event.arguments.length > 65536) throw new Error('Invalid tool');
            response.calls.set(event.call_id, { name: event.name, arguments: event.arguments });
            if (response.calls.size > 8) throw new Error('Too many tools');
          }
          if (event.type === 'response.done') {
            if (event.response.status === 'cancelled') { cancel(response); emit({ type: 'response_cancelled', ...meta }); return; }
            if (event.response.status !== 'completed') throw new Error('Incomplete response');
            if (response.calls.size) {
              if (++rounds > 5) throw new Error('Too many tool rounds');
              for (const [callId, call] of response.calls) {
                const trace: Trace = { id: callId, name: call.name, args: {}, result: null, duration: 0, status: 'running' };
                const at = Date.now(); let output: ToolOutput | undefined;
                try { trace.args = JSON.parse(call.arguments); } catch { output = { error: '工具参数不是合法 JSON。' }; }
                journal?.record('server', { type: 'tool_start', ...meta, trace: { ...trace } });
                output ??= call.name === 'search_web' ? await executeWebSearch(trace.args, webSearch, searchAbort.signal) : executeTool(call.name, trace.args, toolContext);
                if (closed || response.cancelled || response.turn !== turn) return;
                Object.assign(trace, { result: output, duration: Date.now() - at, status: output.error ? 'error' : 'done' });
                traces.push(trace); emit({ type: 'tool_end', ...meta, trace });
                send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(modelToolOutput(call.name, output)) } });
                if (call.name === 'hang_up' && !output.error && output.status === 'success' && output.action === 'hang_up') {
                  response.calls.clear();
                  emit({ type: 'call_ended', ...meta, reason: 'visitor-request' });
                  close('visitor-request'); return;
                }
              }
              response.calls.clear();
              emit({ type: 'response_done', ...meta, continuing: true, traces });
              send({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
            } else { clearTimeout(responseTimeout); emit({ type: 'response_done', ...meta, traces }); }
          }
        } catch { fail('protocol-error', '实时语音返回了无效数据，请重新拨打。'); }
      });
    } catch { fail('unavailable', '无法连接实时语音服务，请检查服务端配置。'); }
  }

  client.on('message', (raw: RawData, binary: boolean) => {
    if (closed) return;
    try {
      if (binary) {
        if (!ready) throw new Error('Not ready');
        const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (!pcm.length || pcm.length % 2 || pcm.length > 6400) throw new Error('Invalid PCM');
        if (Date.now() - windowStart >= 1000) { inputBytes = 0; windowStart = Date.now(); }
        inputBytes += pcm.length;
        if (inputBytes > 128000) throw new Error('Input flooding');
        journal?.input(pcm, { turn });
        send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
        return;
      }
      const event = JSON.parse(raw.toString());
      if (event.type === 'diagnostic') {
        const parsed = diagnosticSchema.safeParse(event);
        if (!parsed.success || raw.toString().length > 8192) throw new Error('Invalid diagnostic');
        if (Date.now() - diagnosticWindow >= 1000) { diagnostics = 0; diagnosticWindow = Date.now(); }
        if (++diagnostics > 250) throw new Error('Diagnostic flooding');
        journal?.record('browser.in', parsed.data, { turn }); return;
      }
      journal?.record('browser.in', event, { turn });
      if (event.type === 'pong' && event.id === pingId) { alive = true; return; }
      if (event.type === 'start' && !started) { started = true; void start(event.context); return; }
      if (event.type === 'hangup') { close('hangup'); return; }
      if (!ready) throw new Error('Not ready');
       if (event.type === 'barge_in') {
         lastUserAt = Date.now(); arrivalPending = false;
        // A local onset invalidates even an in-flight response with no ID yet. Only cloud
        // speech_started advances turns; a delayed local notice cannot cancel that new turn.
        if (!Number.isInteger(event.turn) || event.turn < 0 || event.turn > turn) throw new Error('Invalid turn');
        if (event.turn !== turn || speaking) { journal?.record('server', { type: 'barge_in.ignored', requestedTurn: event.turn, reason: speaking ? 'cloud-already-speaking' : 'stale-turn' }, { turn }); return; }
        blockedThroughTurn = Math.max(blockedThroughTurn, event.turn);
        clearTimeout(responseTimeout);
        for (const response of responses.values()) if (response.turn <= blockedThroughTurn) cancel(response);
        return;
      }
      if (event.type === 'interrupt') {
        // IDs scope cancellation: a late playout acknowledgement cannot kill the next answer.
        const response = responses.get(event.responseId);
        if (!response) return;
        cancel(response);
        if (Array.isArray(event.played)) {
          for (const [itemId, audio] of response.audio) {
            const cursor = event.played.find((item: { itemId?: unknown }) => item?.itemId === itemId);
            const heard = Number.isFinite(cursor?.audioEndMs) ? Math.max(0, Math.floor(cursor.audioEndMs)) : 0;
            send({ type: 'conversation.item.truncate', item_id: itemId, content_index: audio.index,
              audio_end_ms: Math.min(heard, Math.floor(audio.bytes / 48)) });
          }
          response.audio.clear();
        }
        return;
      }
       if (event.type === 'context') {
        const payload = guidePayload({ context: event.context });
        toolContext = payload.pageContext;
        if (toolContext) toolContext.callActive = true;
        send({ type: 'session.update', session: { instructions: `${voiceInstructions(payload.city, toolContext)}\n用户插话就让出话轮，等待用户主动说话。` } });
         return;
       }
       if (event.type === 'arrival') {
         const poi = typeof event.poiId === 'string' ? getPoi(event.poiId) : null;
         const context = guidePayload({ context:event.context }).pageContext;
         const busy = speaking || arrivalPending || [...responses.values()].some(response => !response.cancelled && !response.done);
         if (toolContext?.tourMode !== 'companion' || context?.tourMode !== 'companion' || !poi?.position || !context.visitorPosition ||
           distanceMeters(context.visitorPosition, toCoordinates(poi.position)) > 65 ||
           arrived.has(poi.id) || busy || Date.now()-lastUserAt < 15000 || Date.now()-lastArrivalAt < 20000) {
           emit({ type:'arrival', status:'skipped' }); return;
         }
         toolContext = { ...context, callActive:true };
         turn++; rounds = 0; traces = []; arrivalPending = true;
         arrived.add(poi.id); lastArrivalAt = Date.now();
         emit({ type:'arrival', status:'started', poiId:poi.id, turn });
         send({ type:'session.update', session:{ instructions:voiceInstructions('深圳',toolContext) } });
         // Qwen requires an input item before response.create, including proactive
         // speech. This is an explicit application event, NEVER a browser transcript
         // or a fabricated visitor chat row. Both entry points require companion opt-in.
          const instruction=arrivalInstructions(poi,context.locationSource==='simulated');
         send({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{type:'input_text',text:instruction}] } });
         send({ type:'response.create', response:{ modalities:['text','audio'], tool_choice:'none', instructions:instruction } });
         clearTimeout(responseTimeout);
         responseTimeout = later(() => fail('response-timeout', '沿途讲解暂时没有回应，请重新连接。'),90000);
          return;
        }
       if (event.type === 'selection') {
         const poi = typeof event.poiId === 'string' ? getPoi(event.poiId) : null;
         const context = guidePayload({ context:event.context }).pageContext;
         if (!poi || context?.tourMode !== 'interactive' || toolContext?.tourMode !== 'interactive') {
           emit({type:'selection',status:'skipped'});return;
         }
         for(const response of responses.values())cancel(response);
         clearTimeout(responseTimeout);
         turn++;rounds=0;traces=[];speaking=false;arrivalPending=false;lastUserAt=Date.now();
         toolContext={...context,callActive:true,topic:{id:poi.id,name:poi.name,summary:poi.summary,source:poi.source}};
         const instruction=`【页面点击事件，不是游客语音】游客手动选择了${poi.name}。客户端将播放对应的固定讲解并同步镜头，请勿抢讲或重复。后续问题以此景点及当前热点为上下文；点击不代表游客在该地。`;
         send({type:'session.update',session:{instructions:`${voiceInstructions('深圳',toolContext)}\n${instruction}`}});
         send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:instruction}]}});
         emit({type:'selection',status:'started',poiId:poi.id,turn});return;
       }
      throw new Error('Unsupported event');
    } catch { fail('invalid-request', '通话数据格式无效，请重新拨打。'); }
  });
  return { close };
}
