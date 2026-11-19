# 全景详细讲解与镜头带看

## 讲解工具

- `get_attraction_guidance({ poi_id })`：保留旧工具名，定位为简单讲解，两三句话。配合 `introduce_view` 展示地图图片，不自动进入全景。
- `get_detailed_attraction_guidance({ poi_id, show_panorama? })`：详细讲解，返回固定点 ID、标题与分段讲稿；默认进入全景，`show_panorama: false` 仅查询资料。目前仅支持铁塔。
- `move_camera({ poi_id, hotspot_ids, sync_mode?, dwell_seconds? })`：按顺序讲解 1—4 个不重复的预设点。默认 `sync_mode: "sentence"`，以实际音频句首播放进度同步镜头和字幕。`sync_mode: "timed"` 保留只看不听的定时浏览，每点默认停留 8 秒，可设为 3—20 秒。只接受预设 ID，不接受任意角度、HTML 或模型编写的讲稿。

示例：

```json
{"poi_id":"eiffel","hotspot_ids":["tower-feet","tower-arch","tower-spire","garden-shade"],"sync_mode":"sentence"}
```

## 前端行为

固定点在 `src/data/panorama-hotspots.js` 维护，由后端与前端共享。角度为弧度，FOV 为度。铁塔点位依据本地六面实景图标注，分别为塔脚、拱形钢架、向上收拢的塔身、塔旁绿荫。

后端结果经 `toolEffect` 再次校验，文字、录音语音与实时通话走同一状态链路。镜头命令等全景加载就绪后执行，按最短水平旋转方向平滑转动，尊重减少动态效果设置。转向每点时高亮标记并展示固定讲稿，点击标记可触发该点讲解。后续请求带上可信的当前热点，帮助模型处理“继续”。

手动拖动、缩放、键盘操作、关闭看点、返回地图、发起新问题、打断或挂断通话均停止自动带看；切换场景与销毁页面清理动画和计时器。工具成功只表示指令生成，不是浏览器加载回执。

## 逐句同步

`src/guide/panorama-narration.js` 将可信点位讲稿拼成连续文本，保留各句的 UTF-16 起始位置及看点 ID。服务端阿里云 TTS 按句合成，返回 `charIndex`；前端用已排队 PCM 的 AudioContext 起播时刻（扣除输出延迟）触发句首回调，而不是在网络收到字幕或音频时切换，也不按字数估算。

`mountPanoramaTour` 在全景就绪后播放固定讲稿。每句开始时更新字幕、高亮全景卡片中的当前句；进入新点的首句时平滑转镜头。同一点的后续句只更新高亮，避免重复转动。所有音频播放结束后退出自动带看。合成失败会停下，不回退到定时假同步。

录音语音和通话仍由原生模型理解问题、调用工具；同步带看交给独立的固定文本 TTS 播放器，不再同时播放模型的总结音频，防止双重人声。通话保留麦克风采集和插话检测。静音/沉浸模式下先显示“播放逐句讲解”，用户点击才出声；手动操作和通话插话都会取消讲稿、句首回调和镜头动画。这里是逐句同步，不宣称逐字口型或强制对齐任意模型自由回答。

## 验证

单元测试：`node --test tests/panorama-guidance.test.mjs tests/panorama.test.mjs tests/attraction-guidance.test.mjs`。

浏览器验收：`node scripts/verify-panorama-guidance.mjs`；可用 `VIRTOUR_PLAYWRIGHT_PATH` 指定 Playwright 的绝对入口文件路径。脚本使用本地模拟模型响应与按句静音 PCM 验证真实工具、音频时钟、全景、字幕及交互链路，不调用外部模型。所有音频提前一次返回，用来确认句子与镜头不会因网络提前返回而抢跑。截图放在 `agent-tmp/panorama-guidance/`。
