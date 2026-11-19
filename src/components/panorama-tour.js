import { getPanoramaHotspot } from '../data/panorama-hotspots.js';
import { panoramaNarration, narrationSentence } from '../guide/panorama-narration.js';
import { messageId, messageSource } from '../guide/message-media.js';

/** One cancellable camera sequence shared by text, recorded voice and realtime tools. */
export function mountPanoramaTour({ store, getPanorama, speech, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let request = null, timer = null, epoch = 0, started = false, narrating = false, cancelling = false, finishTranscript = null;
  function cancel() {
    cancelling = true;
    epoch++;
    clearTimer(timer); timer = null;
    getPanorama()?.cancelMove();
    const wasNarrating = narrating;
    narrating = false;
    started = false;
    const finalize = finishTranscript; finishTranscript = null;
    finalize?.(false);
    if (wasNarrating) speech?.stopSpeaking();
    cancelling = false;
  }
  function refresh() {
    if (cancelling) return;
    const state = store.get();
    const next = (state.view === 'panorama' || state.cameraTour?.scene === 'photo') && state.cameraTour?.poiId === state.selectedPoiId ? state.cameraTour : null;
    if (state.cameraTour && !next) { store.set({ cameraTour: null }); return; }
    if (state.tourMode === 'companion' && state.companionPaused && next) { store.set({ cameraTour: null }); return; }
    if (narrating && state.interactionInput === 'text' && state.callState !== 'connected' && !state.cameraNarrationEnabled) {
      store.set({ cameraTour: null }); return;
    }
    if (request !== next) {
      const wasNarrating = narrating;
      cancel(); request = next;
      if (wasNarrating && !next) {
        store.set({ cameraSentence: null, speechCharIndex: null, narrationCue: null,
          guideStatus: state.callState === 'connected' ? 'listening' : 'idle' });
        return;
      }
    }
    if (!request || started) return;
    const photo = request.scene === 'photo', camera = getPanorama();
    if (['error', 'unsupported'].includes(camera?.getView().status)) { store.set({ cameraTour: null }); return; }
    if (!photo && !camera?.getView().ready) return; // Keep the command until all six faces have loaded.
    if (request.narration === 'sentence' && (state.interactionInput === 'text' || state.tourMode === 'immersive') && state.callState !== 'connected' && !state.cameraNarrationEnabled) return;
    started = true;
    const token = epoch, tour = request;
    if (tour.narration === 'sentence') {
      const script = panoramaNarration(tour);
      if (!script || !speech?.speak) { store.set({ cameraTour: null, cameraSentence: null, guideError: '逐句讲解暂时不可用。' }); return; }
      narrating = true;
      store.set({ guideStatus: 'preparing', cameraSentence: null, guideError: null });
      const valid = () => token === epoch && request === tour;
      if (!valid()) return; // A synchronous subscriber may have interrupted preparation.
      let pointId = null, lastIndex = -1;
      const id = messageId(), conversationId = state.conversationId, source = messageSource(state), createdAt = Date.now();
      let completedText = '', heard = false;
      const record = (text, partial, interrupted = false) => {
        if (!heard || store.get().conversationId !== conversationId) return;
        const row = { id, role: 'assistant', text, content: text, source, createdAt,
          poiIds: [tour.poiId], partial, interrupted };
        const rows = store.get().messages, index = rows.findIndex(message => message.id === id);
        store.set({ messages: index < 0 ? [...rows, row].slice(-12) : rows.map((message, i) => i === index ? row : message) });
      };
      // A boundary confirms the previous sentence finished, not that the next one did.
      finishTranscript = success => record(success ? script.text
        : `${completedText}${completedText ? '\n' : ''}（全景讲解已中断，当前句未完整播完）`, false, !success);
      const boundary = index => {
        if (!valid() || index <= lastIndex) return;
        const sentence = narrationSentence(script, index);
        if (!sentence) return;
        lastIndex = index;
        heard = true;
        completedText = script.text.slice(0, sentence.charIndex).trimEnd();
        record(completedText || '（全景逐句讲解中）', true);
        if (!valid()) return;
        store.set({ guideStatus: 'speaking', guideText: script.text, speechCharIndex: index,
          cameraSentence: sentence, activeHotspotId: sentence.hotspotId,
          narrationCue: { poiId: tour.poiId, text: sentence.text } });
        if (!valid()) return;
        if (!photo && pointId !== sentence.hotspotId) {
          pointId = sentence.hotspotId;
          void camera.moveTo(getPanoramaHotspot(tour.poiId, pointId), { duration: 650 });
        }
      };
      const finish = result => {
        if (!valid()) return;
        narrating = false;
        const finalize = finishTranscript; finishTranscript = null;
        finalize?.(result?.status === 'success');
        if (!valid()) return;
        store.set({ cameraTour: null, cameraSentence: null, speechCharIndex: null, narrationCue: null,
          guideStatus: store.get().callState === 'connected' ? 'listening' : 'idle',
          guideError: result?.status === 'success' ? null : '语音讲解暂时不可用，已停止自动带看，可点击热点阅读讲解。' });
      };
      try {
        Promise.resolve(speech.speak(script.text, {
          onStart() { if (valid()) store.set({ guideStatus: 'speaking' }); },
          onBoundary: boundary,
        })).then(finish, () => finish({ status: 'error' }));
      } catch { finish({ status: 'error' }); }
      return;
    }
    const visit = async index => {
      if (token !== epoch || request !== tour) return;
      const point = getPanoramaHotspot(tour.poiId, tour.hotspotIds[index]);
      if (!point) { store.set({ cameraTour: null }); return; }
      store.set({ activeHotspotId: point.id });
      const arrived = await camera.moveTo(point);
      if (token !== epoch || request !== tour) return;
      if (!arrived) { store.set({ cameraTour: null }); return; }
      if (index + 1 < tour.hotspotIds.length) timer = setTimer(() => { void visit(index + 1); }, tour.dwellMs);
      else store.set({ cameraTour: null });
    };
    void visit(0);
  }
  const unsubscribe = store.subscribe(refresh);
  refresh();
  return { refresh, dispose() { unsubscribe(); cancel(); request = null; } };
}
