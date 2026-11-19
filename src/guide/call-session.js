import { createRealtimeCall } from '../services/realtime-call.js';
import { createCallSounds } from '../services/call-sounds.js';
import { guideVisualEffect, introductionEffect } from './tool-effects.js';
import { synchronizedTour } from './panorama-narration.js';
import { messageSource, messagePoiIds, messageReferences, visualNavigationAllowed } from './message-media.js';

/** Independent capture/playout states: speaking never means the mic is closed. */
export function createCallSession({ store, guide, scope = globalThis, createTransport = createRealtimeCall,
  sounds = createCallSounds({ scope }) } = {}) {
  let enabled = false, epoch = 0, pendingArrival = false;
  const appliedTools = new Set();
  let currentTurn=0;
  const turnPois=new Map(),turnVisuals=new Map(),turnReferences=new Map();
  function message(id, role, text, patch = {}) {
    if (!text) return;
    const key = `call-${epoch}-${id}`;
    const messages = [...store.get().messages];
    const index = messages.findIndex(row => row.id === key);
    const row = { id:key,role,text,content:text,source:messageSource(store.get()),createdAt:messages[index]?.createdAt??Date.now(),...patch };
    if (index >= 0) messages[index] = row; else messages.push(row);
    store.set({ messages: messages.slice(-12) });
  }
  function stop({ audible = true } = {}) {
    const hadCall = store.get().callState !== 'idle';
    // Let transport report queued/unheard audio interruptions before closing this session.
    pendingArrival=false; transport.stop(); enabled = false;
    store.set({ callState: 'idle', callStartedAt: null, callMuted: false, callInput: 'off', voiceSession: false,
      guideStatus: 'idle', cameraTour: null, voiceCaptureStage: null, currentTranscript: '', guideError: null, voiceErrorCode: null,
      messages:store.get().messages.map(row=>row.partial?{...row,partial:false}:row) });
    if (hadCall && audible) void sounds.play('ended'); else sounds.stop();
  }
  const transport = createTransport({ scope, shouldPlayResponse: () => !synchronizedTour(store.get()), onEvent(event) {
    if (!enabled) return;
    switch (event.type) {
      case 'ready':
        store.set({ callState: 'connected', callId: event.callId ?? null, callStartedAt: Date.now(), callInput: 'listening', guideStatus: 'listening',
          microphoneState: 'granted', voiceCaptureStage: 'listening', guideModel: event.model, guideText: '我在听，直接说就好。' });
        void sounds.play('connected'); break;
      case 'speech_started':
        currentTurn=event.turn??currentTurn+1;
        pendingArrival=false;
        // Refresh the current hotspot before the next spoken follow-up is interpreted.
        transport.updateContext?.(store.get());
        store.set({ callInput: 'speaking', guideStatus: 'listening', currentTranscript: '', guideText: '我在听。', cameraTour: null }); break;
      case 'speech_stopped':
        store.set({ callInput: 'listening', guideStatus: 'thinking' }); break;
      case 'selection':
        if(event.status==='started')currentTurn=event.turn??currentTurn;
        break;
      case 'arrival':
        if(event.status==='started' && typeof event.poiId==='string'){
          currentTurn=event.turn??currentTurn;
          const patch=introductionEffect(event.poiId);
          if(patch){turnPois.set(currentTurn,[event.poiId]);store.set(patch);}
        }
        if (pendingArrival && store.get().callInput !== 'speaking') store.set({ guideStatus:event.status === 'started' ? 'thinking' : 'listening' });
        pendingArrival=false;
        break;
      case 'transcript':
        turnVisuals.set(event.turn??currentTurn,visualNavigationAllowed(event.text));
        store.set({ currentTranscript: event.text });
        message(event.itemId, 'user', event.text); break;
      case 'response_started': currentTurn=event.turn??currentTurn;if (!synchronizedTour(store.get())) store.set({ guideStatus: 'thinking' }); break;
      case 'playback_started': if (!synchronizedTour(store.get())) store.set({ guideStatus: 'speaking' }); break;
      case 'playback_done': if (!synchronizedTour(store.get())) store.set({ guideStatus: event.continuing ? 'thinking' : 'listening' }); break;
      case 'answer':
        // The dedicated sentence player archives its actual script, not this unheard summary.
        if (event.audioSuppressed || synchronizedTour(store.get())) break;
        if (!synchronizedTour(store.get()) || !store.get().cameraSentence) store.set({ guideText: event.text });
        message(event.responseId, 'assistant', event.text,{partial:true,poiIds:turnPois.get(event.turn??currentTurn)??[],references:turnReferences.get(event.turn??currentTurn)??[]}); break;
      case 'response_done':
        if(!event.continuing){
          const key=`call-${epoch}-${event.responseId}`;
          store.set({messages:store.get().messages.map(row=>row.id===key?{...row,partial:false}:row)});
        }
        break;
      case 'interrupted': {
        // Text deltas can run ahead of the speaker. Never seed a later session with unheard claims.
        const key = `call-${epoch}-${event.responseId}`;
        store.set({ guideStatus: 'listening', cameraTour: null, messages: store.get().messages.map(row => row.id === key
          ? { ...row, text: '（这段回答已被打断）', content: '（这段回答已被打断）', interrupted: true,partial:false,poiIds:[] } : row) });
        break;
      }
      case 'tool_end': {
        if (appliedTools.has(event.trace?.id)) break;
        appliedTools.add(event.trace.id);
        const turn=event.turn??currentTurn,ids=messagePoiIds([event.trace]);
        if(ids.length)turnPois.set(turn,[...new Set([...(turnPois.get(turn)??[]),...ids])].slice(0,4));
        const references=messageReferences([event.trace]);
        if(references.length)turnReferences.set(turn,[...(turnReferences.get(turn)??[]),...references].slice(-4));
        while(turnPois.size>32)turnPois.delete(turnPois.keys().next().value);
        while(turnVisuals.size>32)turnVisuals.delete(turnVisuals.keys().next().value);
        while(turnReferences.size>32)turnReferences.delete(turnReferences.keys().next().value);
        const state=store.get(),patch = guideVisualEffect(event.trace,state);
        const visual=['get_attraction_guidance','introduce_view','get_detailed_attraction_guidance','move_camera'].includes(event.trace.name);
        if (patch && (!visual || turnVisuals.get(turn)!==false)
          && !(['get_attraction_guidance','introduce_view','get_detailed_attraction_guidance'].includes(event.trace.name) && synchronizedTour(state) && state.selectedPoiId===patch.selectedPoiId))store.set(patch);
        store.set({ guideTraces: [...(store.get().guideTraces ?? []).slice(-15), event.trace] });
        break;
      }
      case 'call_ended': stop(); break;
      case 'error':
        enabled = false;
        store.set({ callState: 'error', callInput: 'off', voiceSession: false, guideStatus: 'idle', cameraTour: null,
          guideError: event.message, voiceErrorCode: event.code, ...(event.code === 'not-allowed' ? { microphoneState: 'denied' } : {}) });
        void sounds.play('ended'); break;
    }
  } });
  return {
    get active() { return enabled; },
    start() {
      if (enabled) return;
      epoch++; appliedTools.clear();currentTurn=0;turnPois.clear();turnVisuals.clear();turnReferences.clear();
      // Both audio contexts are unlocked inside the user's call-button tap.
      void sounds.play('dial');
      guide.interrupt(); enabled = true;
      store.set({ callState: 'connecting', callId: null, callStartedAt: null, callMuted: false, callInput: 'off', voiceSession: true,
        guideStatus: 'requesting', microphoneState: 'requesting', voiceCaptureStage: 'permission', guideError: null, voiceErrorCode: null,
        currentTranscript: '', guideTraces: [], mode: 'backend-native' });
      transport.start(store.get());
    },
    stop,
    updateContext() { if (enabled) transport.updateContext?.(store.get()); },
    selectPoi(id) {
      if(!enabled || store.get().callState!=='connected')return false;
      transport.interrupt();guide.interrupt();
      return transport.selectPoi?.(id,store.get())??false;
    },
    narrateLocation(id) {
      if (!enabled || store.get().callState !== 'connected') return false;
      pendingArrival=true;
      const sent = transport.narrateLocation?.(id, store.get()) ?? false;
      if (!sent) pendingArrival=false;
      if (sent) store.set({ guideStatus:'thinking' });
      return sent;
    },
    interrupt() { if (enabled) { transport.interrupt(); guide.interrupt(); store.set({ guideStatus: 'listening' }); } },
    toggleMute() {
      if (store.get().callState !== 'connected') return;
      const muted = !store.get().callMuted;
      transport.setMuted(muted); store.set({ callMuted: muted });
    },
    async run(action) {
      transport.interrupt();
      try { return await action(); }
      finally { if (enabled) { transport.updateContext(store.get()); store.set({ guideStatus: 'listening' }); } }
    },
    dispose() { enabled = false; transport.stop(); sounds.dispose(); },
  };
}
