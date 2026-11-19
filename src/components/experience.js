import { pois } from '../data/pois.js';
import { escapeHTML as esc } from './html.js';
import { icon, landmark, avatar, facilityIcon } from './icons.js';
import { mapMarkup } from './map.js';

export function experienceMarkup() {
  return `
<main class="experience" aria-label="VirTour 景区导览">
  <header class="app-header">
    <div class="header-leading"><span class="wordmark" id="wordmark" aria-hidden="true"><img src="./assets/brand-logo.png" width="32" height="32" alt="" /></span><button type="button" id="back-map" class="back-button" aria-label="返回地图" hidden>${icon('back')}</button></div>
    <div class="header-place"><h1 id="place-title" aria-label="世界之窗 · 深圳 · virtour">世界之窗 <span>深圳 · virtour</span></h1><span id="place-subtitle" hidden></span></div>
    <div class="header-actions">
      <button type="button" id="open-catalog" class="icon-button" aria-label="搜索景点" title="搜索景点">${icon('search')}</button>
      <div class="mode-switch"><button type="button" id="mode-button" class="mode-trigger" aria-label="切换游览方式，当前交互模式" title="切换游览方式" aria-haspopup="true" aria-expanded="false" aria-controls="mode-menu">${icon('conversation')}<span>交互</span>${icon('down','mode-chevron')}</button><div id="mode-menu" class="mode-menu" role="group" aria-label="游览方式" hidden>${[['interactive','conversation','交互模式'],['companion','pin','伴游模式']].map(([id,symbol,label]) => `<button type="button" data-tour-mode="${id}" aria-pressed="${id === 'interactive'}">${icon(symbol)}<span>${label}</span>${icon('check','mode-check')}</button>`).join('')}</div></div>
    </div>
  </header>
  <section class="tour-workspace" aria-label="跟着好奇心探索">
    <div id="stage-shell" class="stage-shell">
      <div class="scene-canvas">
        <div class="scene-surface">
         <section id="map-scene" class="map-scene" aria-label="探索地图">${mapMarkup()}</section>
        <span id="trail-source" class="sr-only">模拟定位</span>
        <section id="panorama-scene" class="panorama-scene" aria-label="全景漫游" hidden>
          <canvas id="panorama-canvas" tabindex="0" aria-label="全景漫游，拖动或按方向键环顾，加减键缩放，Home键复位"></canvas>
          <span class="scene-disclaimer">360° 全景</span>
          <div id="panorama-hotspots" class="panorama-hotspots" aria-label="发现画面中的故事"></div>
          <aside id="panorama-point-info" class="panorama-point-info" aria-live="polite" hidden><header><strong id="panorama-point-title"></strong><button type="button" id="close-panorama-point" class="icon-button" aria-label="关闭看点讲解">${icon('close')}</button></header><p id="panorama-point-body"></p></aside>
          <div class="scene-controls" role="group" aria-label="全景控制"><button type="button" class="map-control" id="panorama-zoom-in" aria-label="拉近全景">+</button><button type="button" class="map-control" id="panorama-zoom-out" aria-label="拉远全景">−</button><button type="button" class="map-control" id="panorama-reset" aria-label="复位视角">${icon('compass')}</button></div>
          <button type="button" id="panorama-back-map" class="panorama-back-map" aria-label="退出全景，返回地图">${icon('back')}地图</button>
          <button type="button" id="panorama-narration-start" class="panorama-narration-start" hidden>播放逐句讲解</button>
          <div id="panorama-status" class="panorama-status" role="status"><span class="loading-orbit" aria-hidden="true"></span><p id="panorama-status-text">风景正在靠近…</p><button type="button" id="retry-panorama" class="secondary-button" hidden>再试一次</button></div>
        </section>
        <section id="photo-scene" class="photo-scene" aria-label="园区实拍" hidden tabindex="0">
          <img id="scene-photo" alt=""/><div id="photo-status" class="photo-status" role="status">风景正在靠近…</div>
          <div class="photo-caption"><span id="photo-label"></span><span id="photo-credit" class="photo-credit"></span><button type="button" id="photo-details" class="secondary-button">听听故事</button></div>
          <button type="button" id="retry-photo" class="secondary-button photo-retry" hidden>重新加载照片</button>
        </section>
        <div id="scene-cue" class="scene-cue" aria-hidden="true" hidden></div>
        <aside id="reply-media" class="reply-media" aria-label="本轮回复的相关图片与资料" hidden><button type="button" class="icon-button" aria-label="收起相关资料">${icon('close')}</button><div data-reply-media></div></aside>
        </div>
        <section id="visit-card" class="context-card" aria-labelledby="visit-title" hidden><header><div><span class="eyebrow">游览参考</span><h2 id="visit-title"></h2></div><button type="button" id="close-visit" class="icon-button" aria-label="收起游览信息">${icon('close')}</button></header><dl id="visit-facts"></dl></section>
      </div>
    </div>
    <nav id="top-categories" class="top-categories" aria-label="快速查找园区地点">
      <button type="button" data-top-facility-kind="all" aria-pressed="true">${icon('panorama')}<span>景点</span></button>
      <button type="button" data-top-facility-kind="food" aria-pressed="false">${facilityIcon('food')}<span>餐饮</span></button>
      <button type="button" data-top-facility-kind="toilets" aria-pressed="false">${facilityIcon('toilets')}<span>卫生间</span></button>
      <button type="button" data-top-facility-kind="other" aria-pressed="false">${facilityIcon('service')}<span>其他</span></button>
    </nav>
  </section>
  <div id="workspace-divider" class="workspace-divider" role="separator" tabindex="0" aria-label="上下拖动调整地图与文字交流比例" aria-orientation="horizontal" aria-valuemin="25" aria-valuemax="65" aria-valuenow="40" aria-controls="stage-shell conversation-panel" hidden><span aria-hidden="true"></span></div>
  <footer class="voice-dock" aria-label="和数字导游说说话">
    <div class="guide-rail">
      <div id="guide-presence" class="guide-presence" data-state="idle">
        <button type="button" id="replay-guide" class="guide-portrait" aria-label="重听沐沐的话">${avatar()}<span id="guide-playback-icon" class="guide-playback-icon" aria-hidden="true" hidden>${icon('narrating')}</span></button>
        <div class="guide-copy">
          <div class="guide-name"><strong>沐沐</strong><span id="guide-state-label" class="sr-only">准备聆听</span></div>
          <div class="voice-message"><p id="voice-hint" class="voice-hint" role="status" aria-live="polite">准备麦克风 · 请允许权限</p><button type="button" id="microphone-help" class="microphone-help" aria-controls="microphone-sheet" aria-haspopup="dialog" hidden aria-label="查看麦克风权限帮助">${icon('info')}</button></div>
          <p id="conversation-hint" class="conversation-hint" hidden>打字和我聊聊</p>
          <p id="guide-caption" tabindex="0" aria-live="off">点一下地标，或说“带我看铁塔”。</p>
          <div id="guide-suggestions" class="guide-suggestions"></div>
          <span id="guide-announcement" class="sr-only" role="status"></span>
        </div>
      </div>
      <section id="conversation-panel" class="conversation-panel" aria-labelledby="conversation-mode-label" hidden>
        <header class="conversation-heading"><div><h2 id="conversation-mode-label">新对话</h2></div><div class="conversation-tools"><button type="button" id="conversation-history" class="icon-button" aria-label="查看历史对话" title="历史对话">${icon('history')}</button><button type="button" id="conversation-new" class="icon-button" aria-label="新建对话" title="新建对话">${icon('new-chat')}</button><button type="button" id="close-conversation" class="icon-button" aria-label="收起聊天记录" title="收起聊天记录">${icon('close')}</button></div></header>
        <p id="conversation-progress" class="conversation-progress" role="status" hidden>正在想一想…</p>
        <div id="conversation-empty" class="conversation-empty"><h3>你好，我是沐沐。</h3><p>今天想把哪一站，装进口袋？<br/>聊聊建筑、找个拍照角度，或一起选下一站。</p></div>
        <div id="conversation-log" class="conversation-log" role="log" aria-label="与数字导游的对话" aria-live="polite" aria-relevant="additions text" tabindex="0"></div>
        <ul id="conversation-starters" class="conversation-starters" aria-label="对话示例">
          <li class="conversation-welcome"><span>从哪聊起？</span><button type="button" id="dismiss-starters" aria-label="收起聊天引导">${icon('close')}</button></li>${['介绍一下埃菲尔铁塔','帮我规划游览路线'].map(text => `<li><button type="button" data-starter="${text}">${text}</button></li>`).join('')}
        </ul>
        <div id="conversation-recommendation" class="conversation-prompt"><span id="conversation-prompt-label">需要我带你了解一下埃菲尔铁塔吗？</span><button type="button" id="conversation-prompt" class="recommendation-go" aria-label="前往埃菲尔铁塔并展开解说" title="前往景点并展开解说">${icon('arrow')}</button><button type="button" id="conversation-dismiss" class="recommendation-dismiss" aria-label="取消这条推荐" title="取消这条推荐">${icon('close')}</button></div>
      </section>
    </div>
    <p id="voice-status" class="sr-only" role="status"></p>
  </footer>
  <section class="interaction-launcher" aria-label="和数字导游交流">
    <p id="interaction-hint" class="sr-only">选择语音或文字，和数字导游聊聊</p>
    <div id="guide-picker" aria-label="选择数字导游"></div>
    <div class="communication-surface">
      <section id="call-info" class="call-info" aria-label="实时语音交流">
        <button type="button" id="call-options-button" class="call-options-trigger" aria-label="语音状态与设置" aria-expanded="false" aria-controls="call-options">
          <span class="call-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          <span class="call-copy"><span class="call-meta"><strong id="call-label" role="status" aria-live="polite">实时语音交流</strong><time id="call-duration"></time></span><span id="call-hint">点右侧耳麦，直接开口交流</span></span>
        </button>
        <p id="call-log-status" hidden></p><p id="call-caption" aria-live="off" hidden></p>
      </section>
      <form id="voice-form" class="voice-form" hidden>
        <label class="sr-only" for="voice-input">想去哪里，问问沐沐</label>
        <input id="voice-input" type="text" placeholder="问问沐沐，想看哪里？" maxlength="2000" autocomplete="off" enterkeyhint="send"/>
        <button type="button" id="guide-voice-toggle" class="guide-voice-toggle" aria-label="关闭数字人声音" aria-pressed="true">${icon('speaker')}<span>有声</span></button>
        <button type="button" id="speech-button" class="mic-button" aria-label="说一句" aria-describedby="voice-hint" aria-pressed="false" aria-busy="false" data-voice-state="paused" data-listening="false">${icon('mic')}</button>
        <button type="submit" id="send-button" class="send-button" aria-label="发送消息" disabled>${icon('send')}</button>
      </form>
    </div>
    <div class="voice-actions" role="group" aria-label="语音连接">
      <button id="call-retry" type="button" class="icon-button" aria-label="开始实时语音交流" title="开始实时语音交流">${icon('headset')}</button>
      <button type="button" id="call-end" class="icon-button" aria-label="结束语音交流" title="结束交流" hidden>${icon('stop')}</button>
    </div>
    <div class="interaction-choices" role="group" aria-label="交流方式">
      <button type="button" id="live-call-button" class="live-call-button" aria-label="开始实时语音交流" aria-pressed="true" aria-controls="call-info" hidden>${icon('headset')}<span class="sr-only">语音</span></button>
      <button type="button" id="text-mode-button" class="text-mode-button" aria-label="切换到文字交流" aria-pressed="false" aria-controls="voice-form">${icon('keyboard')}<span class="sr-only">文字</span></button>
    </div>
    <div id="call-options" class="call-options" role="group" aria-label="交流设置" hidden>
      <p id="companion-location-status" role="status"></p>
      <button type="button" id="call-mute" aria-label="关闭交流麦克风" aria-pressed="false">${icon('mic')}<span>静音</span></button>
      <button type="button" id="companion-pause">${icon('pause')}<span>暂停伴游</span></button>
      <button type="button" id="call-permission-help">${icon('info')}<span>麦克风帮助</span></button>
      <button type="button" id="call-history">${icon('history')}<span>历史对话</span></button>
      <p class="background-note">网页切后台或锁屏后可能被系统暂停；返回后可重新连接。不保证后台持续定位或收音。</p>
    </div>
  </section>
</main>
<dialog id="microphone-sheet" class="sheet microphone-sheet" aria-labelledby="microphone-title" aria-describedby="microphone-explanation">
  <header><h2 id="microphone-title">开启语音交流</h2><button type="button" id="close-microphone" class="icon-button" aria-label="关闭麦克风帮助">${icon('close')}</button></header>
  <p id="microphone-explanation">允许麦克风后，就可以直接和数字导游说话。</p>
  <dl id="microphone-checks" class="microphone-checks"></dl>
  <ol id="microphone-steps" class="microphone-steps"></ol>
  <label for="microphone-address" class="microphone-address-label">当前页面地址</label>
  <input id="microphone-address" class="microphone-address" type="text" readonly aria-label="当前页面地址，可复制到 Chrome 或 Edge 打开"/>
  <div class="microphone-actions"><button type="button" id="enable-microphone" class="primary-button">开启麦克风并聆听</button><button type="button" id="microphone-use-text" class="secondary-button">先用文字交流</button></div>
</dialog>
<dialog id="history-sheet" class="sheet history-sheet" aria-labelledby="history-title"><header><h2 id="history-title">历史对话</h2><button type="button" id="history-close" class="icon-button" aria-label="关闭历史对话">${icon('close')}</button></header><p id="history-storage-status" role="status" hidden></p><div id="history-list" class="history-list"></div><details class="history-privacy"><summary>关于记录保存</summary><p class="history-note">仅保存在当前浏览器：最近 80 段，每段最多 500 条。清理浏览器数据会移除记录。</p></details></dialog>
<dialog id="catalog-sheet" class="sheet catalog-sheet" aria-labelledby="catalog-title"><header><div><h2 id="catalog-title">下一站，世界的哪一角？</h2><p>找建筑，也找一点新鲜感。</p></div><button type="button" id="close-catalog" class="icon-button" aria-label="关闭景点目录">${icon('close')}</button></header><div class="catalog-search-fields"><label class="catalog-search-field">${icon('search')}<span class="sr-only">搜索景点</span><input type="search" id="catalog-search" placeholder="搜索景点、别名或区域" autocomplete="off"/></label><label class="sr-only" for="catalog-region">区域</label><select id="catalog-region"><option value="">所有区域</option>${[...new Set(pois.map(p=>p.region))].map(region=>`<option>${region}</option>`).join('')}</select></div><div class="catalog-discover" aria-label="灵感推荐"><span>不妨从这里开始</span>${[['eiffel','铁塔全景'],['pyramid','金字塔'],['taj','泰姬陵'],['sydney','悉尼歌剧院']].map(([id,name])=>`<button type="button" data-catalog-poi="${id}">${name}${icon('arrow')}</button>`).join('')}</div><p id="catalog-count" class="catalog-count" role="status"></p><div id="catalog-results" class="catalog-results"></div></dialog>
`;
}

// Only reviewed, local content is interpolated; visitor input is rendered using textContent.
export function detailMarkup(poi, hotspot, sections, assetUrl) {
  const photo = poi.photo;
  const file = photo?.file ?? (typeof poi.panorama === 'string' ? poi.panorama : null);
  const label = photo?.label ?? poi.panoramaLabel;
  const picture = file ? `<figure><img src="${esc(assetUrl(file))}" alt="${esc(poi.name)} · ${esc(label)}"/><figcaption>${esc(label)}</figcaption></figure>` : '';
  const content = hotspot ? `<section data-story-section="0"><h3>${esc(hotspot.title)}</h3><p>${esc(hotspot.body)}</p></section>` : sections.map((part,index) => `<section data-story-section="${index}"><h3>${esc(part.title)}</h3><p>${esc(part.text)}</p></section>`).join('');
  const note = hotspot?.note ? `<p class="content-note">${esc(hotspot.note)}</p>` : poi.panorama ? '' : '<p class="content-note">此景点尚无可用的 360° 全景。'+(photo ? '园区实拍摄于较早时间，不代表今天的运营状态。' : '园区实拍尚待补充。')+'</p>';
  const credit = photo ? `<p class="content-note"><a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer">${esc(photo.attribution)}</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(photo.license)}</a><br/>${esc(photo.changes)}<br/>拍摄记录：${esc(photo.capturedAt)}</p>` : '';
  return `${picture}${content}${note}${credit}<p class="content-note"><a href="${esc(poi.source)}" target="_blank" rel="noopener noreferrer">${esc(poi.sourceKind)}</a></p>`;
}
