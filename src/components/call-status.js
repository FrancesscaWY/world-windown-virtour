export function callPresentation(state, now = Date.now()) {
  const elapsed = state.callStartedAt ? Math.max(0, Math.floor((now - state.callStartedAt) / 1000)) : 0;
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const name=state.guideName || '数字导游';
  const companion=state.tourMode==='companion';
  if(companion && state.nativeCompanionActive){
    const preparing=state.nativeCompanionState==='preparing',paused=state.nativeCompanionState==='paused';
    return {label:preparing?'正在准备锁屏讲解':paused?'伴游已暂停':state.guideStatus==='speaking'?`${name}正在讲解`:'沿途伴游',
      hint:preparing?'先缓存语音，再交由系统播放':state.visitorOriginSource==='模拟定位'?'连续解说 · 原生后台音频':'设备定位 · 原生后台解说',
      duration,state:preparing?'connecting':paused?'idle':state.guideStatus==='speaking'?'speaking':'listening'};
  }
  const location = state.pageBackgrounded ? '后台受系统限制' : !state.locationUpdatedAt ? state.locationStatus || '等待定位'
    : state.visitorOriginSource!=='模拟定位' && now-state.locationUpdatedAt>30000 ? '定位更新已暂停'
    : (state.locationAccuracy ?? 0)>80 ? '定位精度较低'
    : state.visitorOriginSource==='模拟定位' ? '模拟定位' : '持续定位中';
  const hint = companion ? `${location} · 随时开口` : '直接说话 · 随时打断';
  if (state.callState === 'idle') return {label:companion ? state.companionPaused?'伴游已暂停':'沿途伴游' : '实时语音交流',hint:companion?`${state.visitorOriginSource==='模拟定位'?'模拟定位':'设备定位'} · 沿途讲解`:'点耳麦，直接开口交流',duration:'',state:'idle'};
  if (state.callState === 'error') return { label: '实时交流已断开', hint: state.guideError, duration: '', state: 'error' };
  if (state.callState === 'connecting') return { label:'正在连接…', hint:'请允许麦克风，连接后直接说话', duration:'', state:'connecting' };
  if (state.callMuted) return { label: '麦克风已静音', hint: '你仍能听到沐沐的声音', duration, state: 'muted' };
  if (state.callInput === 'speaking') return { label: '我在听', hint: '慢慢说，不用按住按钮', duration, state: 'listening' };
  if (state.guideStatus === 'speaking') return { label:`${name}正在说`, hint, duration, state:'speaking' };
  if (state.guideStatus === 'thinking') return { label:`${name}在想`, hint:companion?hint:'麦克风保持开启，可以继续说', duration, state:'thinking' };
  return { label:`${name}在听`, hint, duration, state:'listening' };
}
