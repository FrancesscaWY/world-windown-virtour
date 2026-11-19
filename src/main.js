import { getPoi, getHotspot, panoramaHotspots } from './data/pois.js';
import { facilities, facilityMapPosition } from './data/facilities.js';
import { catalogResults } from './components/catalog.js';
import { touristMapIndexMarkup } from './components/tourist-map-index.js';
import { icon } from './components/icons.js';
import { experienceMarkup } from './components/experience.js';
import { mountMap } from './components/map.js';
import { createSceneTransition, preloadPoiScene } from './components/scene-transition.js';
import { mountIntroductionView } from './components/introduction-view.js';
import { mountNearbyView } from './components/nearby-view.js';
import { mountPlannedRoute } from './components/planned-route.js';
import { mountPanorama, projectPanoramaHotspot } from './components/panorama.js';
import { mountPanoramaTour } from './components/panorama-tour.js';
import { mountViewport } from './components/viewport.js';
import { store } from './guide/store.js';
import { createTourActions } from './guide/tour-actions.js';
import { createGuideController } from './guide/controller.js';
import { createVoiceSession } from './guide/voice-session.js';
import { createCallSession } from './guide/call-session.js';
import { createCompanionNarrator } from './guide/companion-narrator.js';
import { callPresentation } from './components/call-status.js';
import { captionParts } from './components/captions.js';
import { createSpeechService } from './services/speech.js';
import { createAliyunSpeechService } from './services/aliyun-speech.js';
import { createNativeVoiceService } from './services/native-voice.js';
import { createGuideResolver } from './services/guide.js';
import { mountSimulator } from './components/location-simulator.js';
import { createArrivalTracker, toMapPosition, nearestPoi } from './guide/location.js';
import { projectMapPosition } from './components/map-projection.js';
import { mountWorkspaceResize } from './components/workspace-resize.js';
import { mountCompanionDemo } from './components/companion-demo.js';
import { voicePresentation, shouldAutoStartVoice } from './components/voice-status.js';
import { microphoneHelp } from './components/microphone-help.js';
import { mountModeWorkspace, INTERACTIVE_GREETING, COMPANION_GREETING } from './components/mode-workspace.js';
import { createConversationHistory } from './guide/conversation-history.js';
import { mountConversationHistory } from './components/conversation-history.js';
import { requestConversationTitle } from './services/conversation-title.js';
import { selectionTour } from './guide/panorama-narration.js';
import { mountReplyMedia } from './components/reply-media.js';
import { createNativeCompanion } from './services/native-companion.js';

const app = document.querySelector('#app');
app.innerHTML = experienceMarkup();
const $ = selector => document.querySelector(selector);
// Browsing is silent and does not imply consent to capture audio.
store.set({ interactionMode:'realtime', interactionInput:'voice', conversationExpanded:false, showConversationStarters:false });
let historyStorage;
try{historyStorage=window.localStorage;}catch{/* Private storage can be unavailable. */}
const conversations=createConversationHistory({store,storage:historyStorage,requestTitle:requestConversationTitle});
const nativeCompanion=createNativeCompanion({store,history:conversations});
store.set({nativeCompanionAvailable:nativeCompanion.available});
const browserSpeech = createSpeechService();
const speech = location.protocol === 'file:' ? browserSpeech : createNativeVoiceService({ browserSpeech });
// Dedicated fixed-script player: native model audio must not replace sentence cues.
const panoramaSpeech = createAliyunSpeechService();
store.set({ voiceProvider: speech.provider ?? 'browser' });
const actions = createTourActions(store);
const guide = createGuideController({ store, actions, speech, resolveIntent: createGuideResolver() });
const canvas = $('#panorama-canvas');
const hotspotLayer = $('#panorama-hotspots');
const voiceInput = $('#voice-input');
const microphoneSheet = $('#microphone-sheet');
const assetUrl = path => new URL(path, document.baseURI).href;
let panorama = null;
let hotspotButtons = [];
let panoramaTour = null;
let panoramaGeneration = 0;
let photoTimeout = null;
let photoStatus = null;
let lastInteraction = Date.now();
let dictatedText = '';
let lastSpeechIcon = '';
let voiceManuallyPaused = false;
let automaticVoiceStartPending = true;
let automaticVoiceStartVersion = 0;
let liveCallActive = false;
let oneShotVoicePending = false;
let oneShotMessageCount = 0;
const announcedModes = new Set();
const voiceSession = createVoiceSession({ store, guide, speech, continuous: true, onTranscript(text) {
  if (text || voiceInput.value === dictatedText) { voiceInput.value = text; updateInput(); }
  dictatedText = text;
} });
const callSession = createCallSession({ store, guide });
const companionNarrator = createCompanionNarrator({ store, callSession });
const runGuideAction = action => liveCallActive ? callSession.run(action) : voiceSession.run(action);
let previous = {};
let locationWatch = null;
let locationGeneration = 0;
const simulatorPanel = document.createElement('section');
simulatorPanel.className = 'location-simulator';
simulatorPanel.setAttribute('aria-label', '定位演示配置');
simulatorPanel.hidden = true;
app.append(simulatorPanel);
const visitorMarker = document.createElement('div');
visitorMarker.className = 'visitor-marker'; visitorMarker.hidden = true;
visitorMarker.setAttribute('aria-label', '当前位置');
visitorMarker.innerHTML = '<span class="visitor-heading"></span><span class="visitor-dot"></span>';
$('.map-art').append(visitorMarker);
const arrival = createArrivalTracker(poi => {
  if (store.get().tourMode === 'companion' && !store.get().companionPaused) companionNarrator.offer(poi.id);
});
let lastContextUpdate = 0;
let editingViewportHeight = 0, editingRestoreTimer = null, cancelEditingRestore = () => {};
function restoreMapAfterKeyboard() {
  cancelEditingRestore();
  const visual=window.visualViewport;
  cancelEditingRestore = () => { clearTimeout(editingRestoreTimer); visual?.removeEventListener('resize',changed); };
  const restore = () => {
    cancelEditingRestore();
    if (!store.get().textEditing) disposeMap.resumeLayout();
  };
  const changed = () => { if (!visual || visual.height >= editingViewportHeight-80 || visual.scale > 1.05) restore(); };
  if (!visual || visual.height >= editingViewportHeight-80) { disposeMap.resumeLayout(); return; }
  visual.addEventListener('resize',changed);
  editingRestoreTimer=setTimeout(restore,1000); // Recovery for browsers that omit the final viewport event.
}
function receiveLocation(position, source) {
  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return;
  const nearest = nearestPoi(position);
  locationStatus.textContent = nearest ? `${source} · ${nearest.poi.name} ${Math.round(nearest.distance)} 米` : source;
  locationStatus.title = `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
  store.set({ visitorOrigin:position, visitorOriginSource:source, locationUpdatedAt:Date.now(),
    locationAccuracy:position.accuracy ?? null, locationStatus:locationStatus.textContent,
    ...(Number.isFinite(position.simulationRevision)?{simulationRevision:position.simulationRevision}:{}) });
  const point = projectMapPosition(toMapPosition(position));
  const onMap = point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
  visitorMarker.hidden = !onMap;
  visitorMarker.style.left = `${point.x}%`; visitorMarker.style.top = `${point.y}%`;
  visitorMarker.setAttribute('aria-label',`${source === '模拟定位' ? '模拟当前位置' : '当前位置'}与行进方向`);
  visitorMarker.dataset.source = source === '模拟定位' ? '模拟位置' : '当前位置';
  updateVisitorHeading();
  if ((position.accuracy ?? 0) <= 80) arrival.update(position);
  if (liveCallActive && Date.now()-lastContextUpdate > 5000) { lastContextUpdate=Date.now(); callSession.updateContext(); }
}
function toggleCompanion() {
  if(nativeCompanion.active){nativeCompanion.pause(!store.get().companionPaused);return;}
  if (store.get().companionPaused) { startLiveCall(); return; }
  liveCallActive=false; callSession.stop(); guide.interrupt(); stopLocation();
  companionNarrator.reset(); arrival.reset(); simulator.setPaused(true);
  store.set({ companionPaused:true });
}
const simulator = mountSimulator({ container:simulatorPanel, trigger:$('#map-settings-button'), onPosition:receiveLocation, onSource(source) {
  nativeCompanion.stop();
  guide.interrupt();
  stopLocation(); arrival.reset(); companionNarrator.reset(); visitorMarker.hidden = true;
  store.set({ visitorOrigin:null, locationUpdatedAt:null, locationAccuracy:null, locationStatus:'等待定位', visitorOriginSource:source === 'simulated' ? '模拟定位' : '手机定位' });
  if (source === 'device') startLocation();
} });
const locationStatus = simulatorPanel.querySelector('.location-readout');
function stopLocation() {
  locationGeneration += 1;
  if (locationWatch !== null) navigator.geolocation?.clearWatch(locationWatch);
  locationWatch = null;
}
function startLocation() {
  stopLocation();
  visitorMarker.hidden=true;
  const generation = locationGeneration;
  locationStatus.textContent = '正在定位…';
  store.set({ locationStatus:locationStatus.textContent, locationUpdatedAt:null });
  if (!navigator.geolocation) { locationStatus.textContent = '设备不支持定位'; store.set({ locationStatus:locationStatus.textContent }); return; }
  try { locationWatch = navigator.geolocation.watchPosition(position => {
    if (generation !== locationGeneration) return;
    const { latitude, longitude, accuracy, heading } = position.coords;
    receiveLocation({ latitude, longitude, accuracy, heading }, '手机定位');
  }, error => {
    if (generation !== locationGeneration) return;
    locationStatus.textContent = error.code === 1 ? '定位未获授权，请重新定位' : '暂时无法定位，请重新定位';
    store.set({ locationStatus:locationStatus.textContent, locationUpdatedAt:null });
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }); }
  catch {
    locationStatus.textContent = '定位不可用，请检查站点权限';
    store.set({ locationStatus:locationStatus.textContent });
  }
}
function closeModeMenu() {
  $('#mode-menu').hidden = true;
  $('#mode-button').setAttribute('aria-expanded', 'false');
}
$('#mode-button').addEventListener('click', () => {
  const open = $('#mode-menu').hidden;
  $('#mode-menu').hidden = !open;
  $('#mode-button').setAttribute('aria-expanded', String(open));
});
$('#mode-menu').addEventListener('click', event => {
  const button = event.target.closest('[data-tour-mode]');
  if (!button) return;
  const mode = button.dataset.tourMode;
  closeModeMenu();
  $('#mode-button').focus();
  if (mode === store.get().tourMode) return;
  sceneTransition.cancel();
  nativeCompanion.stop();
  if (liveCallActive) callSession.stop();
  liveCallActive = false;
  cancelAutomaticListening();
  voiceSession.stop();
  guide.interrupt();
  stopLocation();
  simulator.setActive(false); arrival.reset(); companionNarrator.reset(); visitorMarker.hidden = true;
  voiceInput.value = ''; updateInput();
  store.set({ tourMode:mode, interactionMode:'realtime', textEditing:false, conversationExpanded:false, interactionInput:'voice', companionPaused:false, detailsOpen:false, visitInfo:null, nearbyView:null, visitorOrigin:null, locationUpdatedAt:null, locationStatus:'尚未定位', visitorOriginSource:'未获取位置', showConversationStarters:false });
  if (mode === 'companion') {
    guide.browseMap();
    simulator.setPaused(true);
    simulator.setSource('simulated',{notify:false});
    simulator.reset();
    simulator.setActive(true,{moving:true});
  }
  else if (mode === 'interactive') {
    simulator.setSource('simulated',{notify:false});
    simulator.setPaused(false);
    simulator.setActive(true,{moving:false});
  }
  $('#call-options').hidden=true; $('#call-options-button').setAttribute('aria-expanded','false');
});
document.addEventListener('click', event => { if (!event.target.closest('.mode-switch')) closeModeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#mode-menu').hidden) { closeModeMenu(); $('#mode-button').focus(); }
});

const disposeViewport = mountViewport(app, window);
function showFacilityKind(kind) {
  void runGuideAction(() => {
    guide.browseFacilities(kind);
    if (kind === 'all') disposeMap.revealScenery();
  });
}
function openPoiScene(id) {
  const state=store.get(),narrate=state.tourMode==='interactive' && state.interactionMode==='realtime';
  if(narrate){
    void panoramaSpeech.unlock();
    if(!state.conversationId)conversations.start('voice');
    // Cancel the old response now, not after the map flight. The next tap wins.
    if(callSession.active)callSession.selectPoi(id);
  }
  void runGuideAction(() => sceneTransition.open(id,{onEnter:poi=>{
    if(!narrate || store.get().tourMode!=='interactive' || store.get().interactionMode!=='realtime')return;
    store.set({cameraTour:selectionTour(poi.id),cameraNarrationEnabled:true,lastIntent:{type:'selection',poiId:poi.id}});
  }}));
}
const disposeMap = mountMap($('.map-viewport'), {
  onFacility: id => { const item = facilities.find(f => f.id === id); if (item) void runGuideAction(() => guide.browseFacilities(['food','toilets'].includes(item.kind)?item.kind:'other',id)); },
  onFacilityKind: showFacilityKind,
  onDismissFacilities: () => { void runGuideAction(() => { guide.interrupt(); store.set({facilityInfo:null}); }); },
  onSelect: openPoiScene,
  onSettings: () => simulator.open(),
});
const sceneTransition = createSceneTransition({ store, guide, actions, map:disposeMap, preload:preloadPoiScene });
function updateVisitorHeading() {
  const position=store.get().visitorOrigin;
  if (!position) { disposeMap.setVisitor(null); return; }
  const bearing=(Number.isFinite(position.heading)?position.heading:0)*Math.PI/180;
  const ahead={latitude:position.latitude+Math.cos(bearing)*.00001,longitude:position.longitude+Math.sin(bearing)*.00001/Math.cos(position.latitude*Math.PI/180)};
  const point=projectMapPosition(toMapPosition(position)),next=projectMapPosition(toMapPosition(ahead));
  const angle=disposeMap.heading(point,next);
  visitorMarker.style.setProperty('--visitor-heading',`${angle}deg`);
  disposeMap.setVisitor(visitorMarker.hidden ? null : point,next);
}
const detachVisitorHeading=disposeMap.onTransform(updateVisitorHeading);

function voiceStatus(text) { $('#voice-status').textContent = text; }
function renderMicrophoneHelp(state) {
  const help = microphoneHelp(state);
  $('#microphone-title').textContent = help.title;
  $('#microphone-explanation').textContent = help.explanation;
  $('#microphone-checks').replaceChildren(...help.checks.map(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = value;
    item.append(term, detail); return item;
  }));
  $('#microphone-steps').replaceChildren(...help.steps.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  $('#microphone-address').value = location.href;
  $('#enable-microphone').disabled = !help.canRequest;
}
function cancelAutomaticListening() { automaticVoiceStartPending = false; automaticVoiceStartVersion += 1; }
function cancelInput() {
  nativeCompanion.stop();
  cancelAutomaticListening();
  if (liveCallActive) { liveCallActive = false; callSession.stop(); }
  voiceSession.stop();
}
function startVoiceSession(options = {}) {
  if (['interactive','companion'].includes(store.get().tourMode)) { if (options.userInitiated) startLiveCall(); return false; }
  if (liveCallActive) { if (options.userInitiated) callSession.start(); return false; }
  if (options.userInitiated) { void speech.unlock?.(); void panoramaSpeech.unlock(); }
  const mode = store.get().tourMode;
  const opening = announcedModes.has(mode) ? null : mode === 'companion' ? COMPANION_GREETING : INTERACTIVE_GREETING;
  const started = voiceSession.start({ ...options, opening });
  if (started) {
    announcedModes.add(mode);
  }
  return started;
}
function scheduleAutomaticListening() {
  if (['interactive','companion'].includes(store.get().tourMode)) { automaticVoiceStartPending=false; render(store.get()); return; }
  if (liveCallActive) { automaticVoiceStartPending = false; return; }
  if (store.get().tourMode === 'interactive' && !liveCallActive) {
    automaticVoiceStartPending = false;
    render(store.get());
    return;
  }
  // Companion also waits for its explicit microphone action on first entry.
  const options = () => ({ paused: voiceManuallyPaused, hidden: document.hidden, dialogOpen: !!document.querySelector('dialog[open]') });
  const token = ++automaticVoiceStartVersion;
  automaticVoiceStartPending = shouldAutoStartVoice(store.get(), options());
  if (!automaticVoiceStartPending) { render(store.get()); return; }
  render(store.get());
  queueMicrotask(() => {
    if (token !== automaticVoiceStartVersion) return;
    automaticVoiceStartPending = false;
    if (shouldAutoStartVoice(store.get(), options())) startVoiceSession();
    else render(store.get());
  });
}
function updateInput() {
  $('#send-button').hidden = false;
  $('#send-button').disabled = !voiceInput.value.trim();
}
function disposePanorama() { panoramaGeneration += 1; clearTimeout(photoTimeout); panorama?.(); panorama = null; hotspotButtons = []; hotspotLayer.replaceChildren(); }
function focusScene() { (store.get().view === 'panorama' ? canvas : store.get().view === 'photo' ? $('#photo-scene') : $('.map-viewport')).focus({ preventScroll: true }); }

function updateHotspots(snapshot) {
  if (!panorama) return;
  panoramaTour?.refresh();
  if (!panorama) return;
  const view = snapshot ?? panorama.getView();
  $('.scene-surface').dispatchEvent(new CustomEvent('virtour:panorama-view',{detail:view}));
  const state = store.get();
  for (const { button, point } of hotspotButtons) {
    const projected = projectPanoramaHotspot(point, view, view);
    const focused = document.activeElement === button;
    const pressed = String(point.id === state.activeHotspotId);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    const hidden = !view.ready || !projected.visible;
    if (button.hidden !== hidden) button.hidden = hidden;
    if (button.hidden && focused) canvas.focus({ preventScroll: true });
    if (!button.hidden) button.style.transform = `translate3d(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }
}

function startPanorama(poi) {
  disposePanorama();
  const token = panoramaGeneration;
  const source = poi.panorama?.kind === 'cubemap'
    ? { ...poi.panorama, faces: poi.panorama.faces.map(assetUrl), mobileFaces: poi.panorama.mobileFaces?.map(assetUrl) }
    : assetUrl(poi.panorama);
  hotspotLayer.innerHTML = (panoramaHotspots[poi.id] ?? []).map(point => `<button type="button" class="panorama-hotspot" data-hotspot="${point.id}" aria-label="${point.title}" hidden><span aria-hidden="true">+</span>${point.title}</button>`).join('');
  hotspotButtons = [...hotspotLayer.querySelectorAll('[data-hotspot]')].map(button => ({ button, point: getHotspot(poi.id, button.dataset.hotspot) }));
  panorama = mountPanorama(canvas, source, status => {
    if (token !== panoramaGeneration) return;
    const failed = status === 'error' || status === 'unsupported';
    $('#panorama-status').hidden = status === 'ready';
    $('#panorama-status').dataset.failed = String(failed);
    $('#retry-panorama').hidden = !failed;
    $('.scene-controls').hidden = status !== 'ready';
    canvas.setAttribute('aria-busy', String(status !== 'ready'));
    $('#panorama-status-text').textContent = failed ? '这段风景没加载出来，再试一次？' : '风景正在靠近…';
    if (status === 'ready') guide.whenSceneReady(poi.id);
    else if (failed) {
      guide.whenSceneFailed(poi.id);
      if ($('#panorama-scene').contains(document.activeElement)) $('#retry-panorama').focus({ preventScroll: true });
    }
    updateHotspots();
  });
  panorama.setOnViewChange(updateHotspots);
}

function startPhoto(poi) {
  disposePanorama();
  const token = panoramaGeneration;
  const photo = $('#scene-photo');
  photoStatus = 'loading'; photo.hidden = true;
  $('#photo-status').hidden = false; $('#photo-status').textContent = '风景正在靠近…';
  $('#retry-photo').hidden = true;
  $('#photo-label').textContent = poi.photo.label;
  const credit = $('#photo-credit');
  credit.replaceChildren();
  credit.title = `${poi.photo.capturedAt ?? ''} · ${poi.photo.changes ?? ''}`;
  for (const [text, href] of [[poi.photo.attribution, poi.photo.source], [poi.photo.license, poi.photo.licenseUrl]]) {
    const link = document.createElement('a'); link.textContent = text; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    if (credit.childNodes.length) credit.append(' · '); credit.append(link);
  }
  photo.alt = `${poi.name} · ${poi.photo.label}`;
  const done = success => {
    if (token !== panoramaGeneration || photoStatus !== 'loading') return;
    clearTimeout(photoTimeout); photoStatus = success ? 'ready' : 'error';
    photo.hidden = !success; $('#photo-status').hidden = success;
    $('#retry-photo').hidden = success;
    if (success) guide.whenSceneReady(poi.id);
    else { $('#photo-status').textContent = '这张照片暂时没加载出来'; guide.whenSceneFailed(poi.id); }
  };
  photo.onload = () => done(photo.naturalWidth > 0);
  photo.onerror = () => done(false);
  photoTimeout = setTimeout(() => done(false), 15000);
  photo.src = assetUrl(poi.photo.file);
  if (photo.complete) queueMicrotask(() => done(photo.naturalWidth > 0));
}

function renderVisitInfo(info) {
  const card = $('#visit-card');
  card.hidden = !info;
  if (!info) return;
  $('#visit-title').textContent = getPoi(info.id)?.name ?? '游览信息';
  const facts = [['所在区域', info.region], ['步行距离', '尚未定位'], ['人流 / 排队', '暂无实时数据']];
  $('#visit-facts').replaceChildren(...facts.map(([label, value]) => {
    const item = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    item.append(dt, dd); return item;
  }));
}

function render(state) {
  if (liveCallActive && ['idle','error'].includes(state.callState) && previous.callState && previous.callState !== state.callState) {
    liveCallActive = false;
    if (state.tourMode==='companion') {
      stopLocation(); simulator.setPaused(true); companionNarrator.reset();
      queueMicrotask(() => {
        const current=store.get();
        if (current.tourMode==='companion' && ['idle','error'].includes(current.callState) && !current.companionPaused) store.set({companionPaused:true});
      });
    }
  }
  app.dataset.tourMode = state.tourMode;
  app.dataset.inputMode = state.interactionInput;
  app.dataset.interaction = state.interactionMode ?? 'none';
  app.dataset.view = state.view;
  app.dataset.callActive = String(liveCallActive);
  app.dataset.companionPaused = String(state.companionPaused);
  const immersive = state.tourMode === 'immersive';
  const companion = state.tourMode === 'companion';
  const guideVoiceEnabled = state.interactionInput !== 'text';
  if(companion && state.callState==='connected' && previous.callState!=='connected')simulator.setPaused(false);
  if (state.companionPaused !== previous.companionPaused) simulator.setPaused(state.companionPaused);
  const voiceSelected=companion || state.interactionMode==='realtime';
  voiceInput.hidden = voiceSelected;
  $('#voice-form').hidden = voiceSelected;
  $('.voice-actions').hidden = !voiceSelected;
  app.dataset.guideError = String(Boolean(state.guideError));
  if (state.visitorOrigin !== previous.visitorOrigin) updateVisitorHeading();
  $('#speech-button').hidden = true;
  $('#guide-voice-toggle').hidden = true;
  $('.interaction-choices').hidden = companion || immersive;
  $('#live-call-button').hidden = immersive || companion || voiceSelected;
  $('#text-mode-button').hidden = immersive || companion || !voiceSelected;
  $('#interaction-hint').hidden = companion || !!state.interactionMode;
  $('#text-mode-button').setAttribute('aria-pressed', String(state.interactionMode === 'text'));
  $('#text-mode-button').setAttribute('aria-label', '切换到文字交流');
  $('#guide-voice-toggle').setAttribute('aria-pressed', String(guideVoiceEnabled));
  $('#guide-voice-toggle').setAttribute('aria-label', guideVoiceEnabled ? '关闭数字人声音' : '开启数字人声音');
  $('#guide-voice-toggle').innerHTML = `${icon(guideVoiceEnabled ? 'speaker' : 'muted')}<span>${guideVoiceEnabled ? '有声' : '静音'}</span>`;
  $('#live-call-button').classList.toggle('is-live', liveCallActive);
  $('#live-call-button').setAttribute('aria-pressed', String(voiceSelected));
  $('#live-call-button').setAttribute('aria-label', '开始实时语音交流');
  const call = callPresentation({...state,guideName:document.querySelector('#companion-pet')?.dataset.guideName});
  $('#call-info').hidden = !voiceSelected;
  $('#call-info').dataset.state = call.state;
  if ($('#call-label').textContent !== call.label) $('#call-label').textContent = call.label;
  if ($('#call-hint').textContent !== call.hint) $('#call-hint').textContent = call.hint;
  $('#call-options-button').title = `${call.label} · ${call.hint}`;
  $('#call-duration').textContent = call.duration;
  $('#call-log-status').hidden = true;
  $('#call-retry').hidden = state.nativeCompanionActive || !['idle','error'].includes(state.callState);
  $('#call-retry').setAttribute('aria-label',state.callState==='error'?'重新连接语音':companion?'开始伴游':'开始实时语音交流');
  $('#call-end').hidden = !liveCallActive && !state.nativeCompanionActive;
  $('#call-mute').hidden = !liveCallActive || state.nativeCompanionActive;
  $('#call-mute').disabled = state.callState !== 'connected';
  $('#call-mute').setAttribute('aria-pressed', String(state.callMuted));
  $('#call-mute').setAttribute('aria-label', state.callMuted ? '开启通话麦克风' : '关闭通话麦克风');
  $('#call-mute').innerHTML = `${icon(state.callMuted ? 'mic-muted' : 'mic')}<span>${state.callMuted?'取消静音':'静音'}</span>`;
  $('#call-mute').title = $('#call-mute').getAttribute('aria-label');
  const callCaption = state.callInput === 'speaking' ? state.currentTranscript : state.guideText;
  $('#call-caption').hidden = state.callState !== 'connected' || !callCaption || !['speaking', 'thinking'].includes(state.guideStatus);
  $('#call-caption').textContent = callCaption;
  $('#companion-pause').hidden = !companion;
  $('#companion-pause span').textContent = state.companionPaused ? '继续伴游' : '暂停伴游';
  $('#companion-location-status').hidden = !companion;
  $('.background-note').textContent=state.nativeCompanionAvailable
    ?'原生伴游先缓存语音，再由系统后台播放。设备定位需允许后台定位；锁屏不保持实时收音。关机或强制退出会停止。'
    :'网页切后台或锁屏后可能被系统暂停；返回后可重新连接。可靠锁屏讲解需安装原生应用。';
  $('#call-permission-help').hidden=companion && state.nativeCompanionAvailable;
  $('#companion-location-status').textContent = state.pageBackgrounded ? '后台运行受系统限制，返回后检查定位与语音' : state.locationStatus ?? '开始伴游后获取位置';
  $('#microphone-use-text').textContent = companion ? '返回交互' : '先用文字交流';
  if (state.tourMode !== previous.tourMode) {
    const labels = { interactive:'交互', immersive:'交互', companion:'伴游' };
    $('#mode-button').innerHTML = `${icon(companion?'pin':'conversation')}<span>${labels[state.tourMode]}</span>${icon('down','mode-chevron')}`;
    $('#mode-button').title = `切换模式：${labels[state.tourMode]}`;
    $('#mode-button').setAttribute('aria-label', $('#mode-button').title);
    for (const button of document.querySelectorAll('[data-tour-mode]')) button.setAttribute('aria-pressed', String(button.dataset.tourMode === state.tourMode));
  }
  const before = previous;
  // Commit the snapshot before mounting a scene; status callbacks can synchronously update the store.
  previous = { ...state };
  if (oneShotVoicePending && !liveCallActive && state.messages?.length > oneShotMessageCount && state.messages.at(-1)?.role !== 'user' && state.guideStatus === 'idle') {
    oneShotVoicePending = false;
    queueMicrotask(() => { if (!liveCallActive && voiceSession.active) voiceSession.stop(); });
  } else if (oneShotVoicePending && !state.voiceSession && (state.guideError || state.voiceErrorCode)) oneShotVoicePending = false;
  const poi = getPoi(state.selectedPoiId);
  const inPanorama = state.view === 'panorama';
  const inScene = state.view !== 'map';
  const sceneChanged = before.view !== state.view || before.selectedPoiId !== state.selectedPoiId;
  if (sceneChanged && liveCallActive) queueMicrotask(() => callSession.updateContext());
  const retryRequested = inScene && state.pendingNarration && state.pendingNarration.token !== before.pendingNarration?.token && ['error', 'unsupported'].includes(inPanorama ? panorama?.getView().status : photoStatus);

  if (sceneChanged) {
    if (!inPanorama) disposePanorama();
    $('#map-scene').hidden = inScene;
    $('#photo-scene').hidden = state.view !== 'photo';
    $('#panorama-scene').hidden = !inPanorama;
    $('#back-map').hidden = !inScene;
    $('#wordmark').hidden = inScene;
    $('#place-subtitle').hidden = !inScene;
    $('#place-subtitle').textContent = inScene ? `${poi.name} · ${inPanorama?'拖动环顾':'园区照片'}` : '';
    $('.scene-disclaimer').textContent = poi.panoramaLabel ?? '全景体验素材';
    if (before.view !== undefined && before.view !== state.view) focusScene();
  }
  for (const button of document.querySelectorAll('button[data-poi]')) {
    const selected = (state.mentionedPoiId ?? null) === button.dataset.poi;
    button.classList.toggle('selected', selected);
    button.classList.toggle('recommended', (state.recommendedPoiIds ?? []).includes(button.dataset.poi));
    button.setAttribute('aria-pressed', String(selected));
  }
  disposeMap.refresh?.();
  if (state.view === 'map' && state.recommendedPoiIds?.[0] && state.recommendedPoiIds[0] !== before.recommendedPoiIds?.[0]) disposeMap.focusPoi(state.recommendedPoiIds[0]);
  if (before.facilityInfo !== state.facilityInfo) {
    const info = state.facilityInfo;
    disposeMap.showFacilities(info);
    const category = !info ? 'all' : ['food','toilets'].includes(info.kind) ? info.kind : 'other';
    for (const button of document.querySelectorAll('[data-top-facility-kind]')) button.setAttribute('aria-pressed', String(button.dataset.topFacilityKind === category));
    for (const button of document.querySelectorAll('[data-catalog-query]')) button.setAttribute('aria-pressed', 'false');
    if (info) {
      const located = info.items.filter(item => facilityMapPosition(item));
      if (located.length) disposeMap.focusFacilities(located.map(item => item.id));
    }
  }

  if (before.visitInfo !== state.visitInfo) renderVisitInfo(state.visitInfo);
  const speaking = state.guideStatus === 'speaking';
  const preparing = state.guideStatus === 'preparing';
  const voice = voicePresentation(state, { starting: automaticVoiceStartPending });
  const showVoiceHint = companion || liveCallActive || state.voiceSession;
  const statusLabels = { requesting: '等话筒准备好', listening: '在听呢', thinking: '想一想…', waiting: '等风景就位', preparing: '准备开口', speaking: '慢慢讲给你听' };
  $('#guide-presence').dataset.state = state.guideStatus;
  $('#guide-presence').dataset.voiceState = voice.status;
  $('#guide-state-label').textContent = showVoiceHint ? voice.guideLabel : companion && state.companionPaused ? '伴游已暂停' : state.guideError ? '文字也陪你逛' : statusLabels[state.guideStatus] ?? (state.voiceSession ? '接着聊' : '陪你走走');
  const hint = $('#voice-hint');
  hint.hidden = !showVoiceHint;
  hint.parentElement.hidden = !showVoiceHint;
  hint.dataset.voiceState = voice.status;
  if (hint.textContent !== voice.hint) hint.textContent = voice.hint;
  $('#microphone-help').hidden = !showVoiceHint || voice.status !== 'error';
  const showingMicrophoneError = state.guideError && state.guideText === state.guideError && (state.voiceErrorCode || state.microphoneState === 'denied');
  // Keep guide content, while avoiding a second copy of microphone status text.
  $('#guide-caption').hidden = Boolean(showVoiceHint && (showingMicrophoneError || state.guideStatus === 'requesting'));
  $('#guide-suggestions').hidden = Boolean(showVoiceHint && showingMicrophoneError);
  if (microphoneSheet.open) renderMicrophoneHelp(state);
  if (state.guideText !== before.guideText || state.speechCharIndex !== before.speechCharIndex || speaking !== (before.guideStatus === 'speaking')) {
    const text = state.guideText || '点一下地标，或说“带我看铁塔”。';
    const parts = captionParts(text, speaking ? state.speechCharIndex : null);
    const caption = $('#guide-caption');
    if (parts.current) {
      const mark = document.createElement('mark'); mark.textContent = parts.current;
      caption.replaceChildren(document.createTextNode(parts.before), mark, document.createTextNode(parts.after));
      caption.scrollTop = Math.max(0, mark.offsetTop - 8);
    } else caption.textContent = text;
    if (state.guideText !== before.guideText) $('#guide-announcement').textContent = text;
  }
  $('#guide-playback-icon').hidden = !speaking && !preparing;
  const guideName = document.querySelector('#companion-pet')?.dataset.guideName ?? $('.guide-name strong')?.textContent ?? '数字导游';
  $('#replay-guide').setAttribute('aria-label', speaking || preparing ? (state.voiceSession ? '打断讲解，我来说' : '停止讲解') : `重听${guideName}的话`);
  const voiceReady = state.tourMode === 'interactive' && !state.voiceSession && !state.guideError && !state.voiceErrorCode;
  const speechLabel = voiceReady ? '语音提问' : voice.label;
  const speechIcon = voiceReady ? 'mic' : voice.icon;
  $('#speech-button').setAttribute('aria-pressed', String(voice.pressed));
  $('#speech-button').setAttribute('aria-busy', String(voice.busy));
  $('#speech-button').setAttribute('aria-label', speechLabel);
  $('#speech-button').title = speechLabel;
  $('#speech-button').dataset.voiceState = voice.status;
  $('#speech-button').dataset.listening = String(voice.listening);
  if (speechIcon !== lastSpeechIcon) { $('#speech-button').innerHTML = icon(speechIcon); lastSpeechIcon = speechIcon; }
  voiceInput.placeholder = `问问${guideName}，想看哪里？`;
  if (state.guideError && state.guideError !== before.guideError) voiceStatus(state.guideError);
  if (state.suggestions !== before.suggestions) {
    $('#guide-suggestions').replaceChildren(...(state.suggestions ?? []).map(item => {
      const button = document.createElement('button'); button.type='button'; button.textContent=item.label;
      button.addEventListener('click', () => { void submitText(item.text); }); return button;
    }));
  }
  const cue = state.narrationCue;
  const activePoint = inPanorama ? getHotspot(poi.id, state.activeHotspotId) : null;
  $('#panorama-narration-start').hidden = !(inPanorama && state.cameraTour?.narration === 'sentence' && (state.interactionInput === 'text' || state.tourMode === 'immersive') && !state.cameraNarrationEnabled && state.callState !== 'connected');
  $('#panorama-point-info').hidden = !activePoint;
  if (activePoint) {
    $('#panorama-point-title').textContent = activePoint.title;
    const body = $('#panorama-point-body');
    const sentence = state.cameraSentence;
    const offset = sentence?.hotspotId === activePoint.id ? activePoint.body.indexOf(sentence.text) : -1;
    if (offset >= 0) {
      const mark = document.createElement('mark'); mark.textContent = sentence.text;
      body.replaceChildren(document.createTextNode(activePoint.body.slice(0, offset)), mark,
        document.createTextNode(activePoint.body.slice(offset + sentence.text.length)));
    } else body.textContent = activePoint.body;
  }
  const showCue = speaking && cue?.poiId === state.selectedPoiId && inScene && !state.detailsOpen;
  $('#scene-cue').hidden = !showCue;
  if (showCue) $('#scene-cue').textContent = cue.text;
  if (inPanorama && (sceneChanged || retryRequested)) startPanorama(poi);
  if (inPanorama) updateHotspots();
  if (state.view === 'photo' && (sceneChanged || retryRequested)) startPhoto(poi);
}
const unsubscribe = store.subscribe(render);
render(store.get());
panoramaTour = mountPanoramaTour({ store, getPanorama: () => panorama, speech: panoramaSpeech });
const disposeRoute = mountPlannedRoute({ viewport: $('.map-viewport'), store,
  onClear: () => { disposeMap.cancelFlight(); guide.clearRoute(); disposeMap.refresh(); },
  onFit: route => disposeMap.focusRoute(route),
});
const disposeIntroduction = mountIntroductionView({ viewport: $('.map-viewport'), store, map: disposeMap });
const disposeNearby = mountNearbyView({ viewport: $('.map-viewport'), store, map: disposeMap,
  onSelect: openPoiScene,
});
const disposeReplyMedia=mountReplyMedia({app,store});
// A silent map entry does not create an unsolicited conversational turn.

const catalog = $('#catalog-sheet');
function updateCatalog() {
  const result = catalogResults($('#catalog-search').value, $('#catalog-region').value);
  $('#catalog-results').innerHTML = `${result.html}${$('#catalog-search').value.trim() || $('#catalog-region').value ? '' : touristMapIndexMarkup()}`;
  $('#catalog-count').textContent = `${result.count} 条公开记录 · 不是完整在营名录`;
}
function openCatalog(query = '') {
  cancelInput(); guide.interrupt();
  $('#catalog-search').value = query;
  updateCatalog(); catalog.showModal();
}
$('#open-catalog').addEventListener('click', () => openCatalog());
$('#top-categories').addEventListener('click', event => {
  const category = event.target.closest('button');
  if (!category) return;
  if (category.dataset.catalogQuery) { openCatalog(category.dataset.catalogQuery); return; }
  if (category.dataset.topFacilityKind) showFacilityKind(category.dataset.topFacilityKind);
});
$('#close-catalog').addEventListener('click', () => catalog.close());
$('#catalog-search').addEventListener('input', updateCatalog);
$('#catalog-region').addEventListener('change', updateCatalog);
$('#catalog-sheet').addEventListener('click', event => {
  const target=event.target.closest('[data-catalog-poi],[data-reference-poi]');
  const id=target?.dataset.catalogPoi ?? target?.dataset.referencePoi;
  if (id) { catalog.close(); openPoiScene(id); }
});
$('#photo-details').addEventListener('click', () => { void runGuideAction(() => guide.showDetails()); });
$('#retry-photo').addEventListener('click', () => { void runGuideAction(() => guide.retryScene(store.get().selectedPoiId)); });
for (const event of ['pointerdown','keydown','input']) document.addEventListener(event, () => { lastInteraction = Date.now(); }, {passive:true});
const proactiveTimer = setInterval(() => {
  if (liveCallActive || store.get().tourMode === 'companion' || document.hidden || catalog.open || microphoneSheet.open || document.activeElement === voiceInput || Date.now() - lastInteraction < 60000 || !store.get().messages.some(item=>item.role === 'user')) return;
  guide.proactive('next');
}, 10000);

$('#back-map').addEventListener('click', () => { void runGuideAction(() => guide.browseMap()); });
$('#panorama-back-map').addEventListener('click', () => { void runGuideAction(() => guide.browseMap()); });
$('#panorama-narration-start').addEventListener('click', () => { void panoramaSpeech.unlock(); store.set({ cameraNarrationEnabled: true }); });
$('#close-visit').addEventListener('click', () => { void runGuideAction(() => { guide.interrupt(); store.set({ visitInfo: null }); }); focusScene(); });
hotspotLayer.addEventListener('click', event => {
  const id = event.target.closest('[data-hotspot]')?.dataset.hotspot;
  if (id) void runGuideAction(() => guide.browseHotspot(id));
});
$('#panorama-zoom-in').addEventListener('click', () => panorama?.zoomBy(-8));
$('#panorama-zoom-out').addEventListener('click', () => panorama?.zoomBy(8));
$('#panorama-reset').addEventListener('click', () => panorama?.reset());
// Manual camera input cancels the whole sequence, including a pending dwell timer.
for (const type of ['pointerdown', 'wheel', 'keydown']) $('#panorama-scene').addEventListener(type, event => {
  if (event.target.closest('#panorama-narration-start')) return;
  if (store.get().cameraTour) store.set({ cameraTour: null, cameraSentence: null });
}, { capture: true, passive: true });
$('#close-panorama-point').addEventListener('click', () => store.set({ activeHotspotId: null, cameraTour: null, cameraSentence: null }));
$('#retry-panorama').addEventListener('click', () => {
  void runGuideAction(() => guide.retryScene(store.get().selectedPoiId));
  (['error', 'unsupported'].includes(panorama?.getView().status) ? $('#retry-panorama') : canvas).focus({ preventScroll: true });
});
function activateCompanion() {
  if(nativeCompanion.active){nativeCompanion.pause(!store.get().companionPaused);return;}
  if(store.get().cameraTour && ['speaking','preparing'].includes(store.get().guideStatus)){
    if(liveCallActive)callSession.interrupt();else guide.interrupt();return;
  }
  if (liveCallActive) { callSession.interrupt(); return; }
  if (store.get().tourMode === 'interactive') { if(store.get().interactionMode==='realtime')startLiveCall();else openTextConversation({focus:true});return; }
  if (store.get().tourMode === 'companion') { startLiveCall(); return; }
  if (voiceSession.active) { voiceSession.interruptAndListen(); return; }
  if (store.get().tourMode === 'interactive' && ['speaking', 'preparing'].includes(store.get().guideStatus)) {
    voiceManuallyPaused = false; cancelAutomaticListening(); startVoiceSession({ userInitiated: true }); return;
  }
  if (['speaking', 'preparing'].includes(store.get().guideStatus)) guide.stop(); else guide.resumeNarration();
}
$('#replay-guide').addEventListener('click', activateCompanion);
const disposeCompanion = mountCompanionDemo({ host: $('.voice-dock'), stage: $('.scene-surface'), store, map:disposeMap, onActivate: activateCompanion });
$('#companion-pause').addEventListener('click', () => { toggleCompanion(); $('#call-options').hidden=true; $('#call-options-button').setAttribute('aria-expanded','false'); });
$('#call-options-button').addEventListener('click', () => {
  const open = $('#call-options').hidden;
  $('#call-options').hidden=!open; $('#call-options-button').setAttribute('aria-expanded',String(open));
});
document.addEventListener('pointerdown',event => {
  if (event.target.closest('#call-options,#call-options-button')) return;
  $('#call-options').hidden=true; $('#call-options-button').setAttribute('aria-expanded','false');
});
const disposeModeWorkspace = mountModeWorkspace({ app, store,
   onOpenRecommendation:openPoiScene,
  onDismissRecommendation:id => guide.dismissRecommendation(id),
});

const disposeWorkspaceResize = mountWorkspaceResize({ app, store });
const historyUI=mountConversationHistory({app,store,history:conversations,onContinue:id=>openTextConversation({conversationId:id})});

// Voice is selected by default, but capture still requires an explicit start.
scheduleAutomaticListening();
simulator.setSource('simulated',{notify:false});
simulator.setActive(true,{moving:false});

async function submitText(text) {
  if (store.get().tourMode==='companion') return;
  void panoramaSpeech.unlock();
  if (!text.trim()) return;
  if (store.get().showConversationStarters) store.set({ showConversationStarters:false });
  voiceInput.value = ''; dictatedText = ''; updateInput(); voiceInput.blur();
  store.set({ textEditing:false });
  restoreMapAfterKeyboard();
  await runGuideAction(() => guide.submit(text));
}
voiceInput.addEventListener('focus', () => {
  cancelAutomaticListening(); sceneTransition.cancel();
  cancelEditingRestore();
  if (!store.get().textEditing) editingViewportHeight=window.visualViewport?.height ?? innerHeight;
  disposeMap.freezeLayout();
  if (voiceSession.active) voiceSession.stop();
  store.set({ textEditing:true, cameraTour:null, cameraSentence:null });
});
voiceInput.addEventListener('blur', event => {
  // Keep history controls usable: moving focus inside the text window must not
  // hide the clicked button between pointerdown and click.
  if(event.relatedTarget && ($('#conversation-panel').contains(event.relatedTarget) || $('.interaction-launcher').contains(event.relatedTarget)))return;
  store.set({textEditing:false});restoreMapAfterKeyboard();
});
voiceInput.addEventListener('keydown', event => { if (event.key === 'Escape') voiceInput.blur(); });
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && store.get().textEditing && !document.querySelector('dialog[open]')){
    event.preventDefault();voiceInput.blur();store.set({textEditing:false});restoreMapAfterKeyboard();
  }
});
voiceInput.addEventListener('input', updateInput);
$('#voice-form').addEventListener('submit', event => { event.preventDefault(); void submitText(voiceInput.value); });
$('#conversation-starters').addEventListener('click', event => {
  const text = event.target.closest('[data-starter]')?.dataset.starter;
  if (text) void submitText(text);
});
$('#dismiss-starters').addEventListener('click', () => store.set({showConversationStarters:false, startersDismissed:true}));
function closeTextConversation() {
  guide.interrupt(); voiceInput.blur();
  store.set({ textEditing:false, conversationExpanded:false, interactionMode:'realtime', interactionInput:'voice', cameraNarrationEnabled:false, cameraTour:null });
  restoreMapAfterKeyboard();
  $('#voice-input').blur();
}
function openTextConversation({focus=false,conversationId=null}={}) {
  if (store.get().tourMode==='companion') {
    if(!conversationId)return;
    $('#mode-menu [data-tour-mode="interactive"]').click();
  }
  cancelInput(); guide.interrupt();
  voiceInput.value='';updateInput();
  if(!conversationId || !conversations.resume(conversationId))conversations.start('text');
  $('#call-options').hidden=true;
  store.set({ interactionMode:'text', interactionInput:'text', textEditing:false, conversationExpanded:true, showConversationStarters:false, cameraNarrationEnabled:false });
  if (focus) voiceInput.focus({preventScroll:true});
  else {voiceInput.blur();restoreMapAfterKeyboard();}
}
$('#text-mode-button').addEventListener('click', () => { if(store.get().interactionMode!=='text') openTextConversation(); });
$('#close-conversation').addEventListener('click', closeTextConversation);
$('#conversation-new').addEventListener('click',()=>openTextConversation());
$('#speech-button').addEventListener('click', () => {
  voiceInput.blur();
  const action = voicePresentation(store.get(), { starting: automaticVoiceStartPending }).action;
  cancelAutomaticListening();
  if (action === 'interrupt') {
    voiceManuallyPaused = false;
    if (voiceSession.active) voiceSession.interruptAndListen(); else startVoiceSession({ userInitiated: true });
  } else if (action === 'pause') {
    oneShotVoicePending = false;
    voiceManuallyPaused = true;
    voiceSession.stop({ message: '聆听已暂停，想继续时点击麦克风。' });
  } else {
    voiceManuallyPaused = false;
    oneShotVoicePending = true;
    oneShotMessageCount = store.get().messages?.length ?? 0;
    startVoiceSession({ userInitiated: true });
  }
});

$('#guide-voice-toggle').addEventListener('click', () => {
  const enabled = store.get().interactionInput === 'text';
  if (!enabled) speech.stopSpeaking?.();
  store.set({ interactionInput: enabled ? 'voice' : 'text', ...(!enabled ? { cameraNarrationEnabled: false, cameraTour: null, cameraSentence: null, guideStatus: 'idle', speechCharIndex: null, narrationCue: null } : {}) });
});

const liveCallButton = $('#live-call-button');
$('#call-mute').addEventListener('click', () => callSession.toggleMute());
$('#call-retry').addEventListener('click', startLiveCall);
$('#call-end').addEventListener('click', () => {
  nativeCompanion.stop();
  liveCallActive=false; oneShotVoicePending=false; voiceManuallyPaused=true;
  callSession.stop();
  if (store.get().tourMode==='companion') {
    stopLocation(); simulator.setPaused(true); companionNarrator.reset();
    store.set({companionPaused:true});
  }
});
const callClock = setInterval(() => {
  if (liveCallActive) {
    const call=callPresentation(store.get());
    $('#call-duration').textContent=call.duration;
    $('#call-hint').textContent=call.hint;
  }
}, 1000);
function startLiveCall() {
  void panoramaSpeech.unlock();
  if (!['interactive','companion'].includes(store.get().tourMode)) return;
  if(nativeCompanion.available && store.get().tourMode==='companion'){
    if(nativeCompanion.active)return;
    if(liveCallActive){callSession.stop();liveCallActive=false;}
    voiceSession.stop();guide.interrupt();stopLocation();simulator.setPaused(true);
    nativeCompanion.start();return;
  }
  if (liveCallActive && store.get().callState!=='error') return;
  liveCallActive = true;
  oneShotVoicePending = false;
  voiceInput.blur();
  cancelAutomaticListening();
  voiceManuallyPaused = false;
  voiceSession.stop();
  conversations.start(store.get().tourMode==='companion'?'companion':'voice');
  store.set({ interactionMode:'realtime', interactionInput:'voice', textEditing:false, companionPaused:false, conversationExpanded:false, showConversationStarters:false });
  restoreMapAfterKeyboard();
  if (store.get().tourMode==='companion') {
    simulator.setPaused(true); arrival.reset(); companionNarrator.reset();
    if (simulator.getSource()==='device') startLocation();
    else simulator.refresh();
  }
  callSession.start();
}
liveCallButton.addEventListener('click', startLiveCall);

$('#microphone-help').addEventListener('click', () => {
  cancelAutomaticListening();
  renderMicrophoneHelp(store.get());
  microphoneSheet.showModal();
});
$('#call-permission-help').addEventListener('click', () => { $('#call-options').hidden=true; $('#microphone-help').click(); });
$('#close-microphone').addEventListener('click', () => microphoneSheet.close());
$('#enable-microphone').addEventListener('click', () => {
  microphoneSheet.close();
  cancelAutomaticListening(); voiceManuallyPaused = false;
  startVoiceSession({ userInitiated: true });
});
$('#microphone-use-text').addEventListener('click', () => {
  microphoneSheet.close(); cancelInput(); guide.interrupt();
  if (store.get().tourMode === 'companion') {
    $('#mode-menu [data-tour-mode="interactive"]').click();
    return;
  }
  openTextConversation();
});

document.addEventListener('visibilitychange', () => {
  const refreshLocation=!document.hidden && store.get().tourMode==='companion' && !store.get().companionPaused && locationWatch !== null && simulator.getSource()==='device';
  store.set({pageBackgrounded:document.hidden,...(refreshLocation?{locationUpdatedAt:null}:{})});
  if(!document.hidden)nativeCompanion.sync();
  if (refreshLocation) startLocation();
  // Keep the explicit call alive in the background while the browser permits audio.
  // Audio suspension/device loss is reported by the transport instead of pretending to listen.
  if (liveCallActive) return;
  if (store.get().tourMode === 'companion') return;
  if (document.hidden) {
    cancelAutomaticListening();
    // Keep the recovery instructions while the visitor changes site/system permissions.
    if (voiceSession.active || !store.get().voiceErrorCode) {
      voiceSession.stop({ message: '陪游已暂停，回来后点麦克风继续。' });
      voiceStatus('陪游已暂停，回来后可以继续。');
    }
    if (catalog.open) catalog.close();
  }
});
window.addEventListener('pagehide', event => {
  conversations.flush();
  cancelEditingRestore();
  if (!event.persisted) disposeCompanion();
  if (event.persisted) simulator.setPaused(true); else simulator.dispose();
  stopLocation();
  cancelInput(); guide.interrupt();
    if (!event.persisted) { clearInterval(proactiveTimer); clearInterval(callClock); sceneTransition.dispose(); companionNarrator.dispose(); panoramaTour?.dispose(); panoramaSpeech.dispose(); callSession.dispose(); historyUI.dispose();conversations.dispose();disposeWorkspaceResize(); disposeModeWorkspace(); disposeReplyMedia();disposeNearby(); disposeIntroduction(); disposeRoute(); voiceSession.dispose(); guide.dispose(); speech.dispose?.(); detachVisitorHeading(); disposeMap(); disposePanorama(); disposeViewport(); unsubscribe(); }
});

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  simulator.setPaused(store.get().companionPaused);
  store.set({ pageBackgrounded:false, textEditing:false });
  disposeMap.resumeLayout();
  if (simulator.getSource() === 'device' && store.get().tourMode==='companion' && !store.get().companionPaused) startLocation();
  if (store.get().tourMode === 'companion') scheduleAutomaticListening();
});
