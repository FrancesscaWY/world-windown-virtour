# 景点讲解画面：introduce_view

## 调用约定

文字导游、单次原生语音和实时通话共用后端工具白名单：

```json
{"name":"introduce_view","arguments":{"poi_id":"eiffel"}}
```

唯一参数 `poi_id` 是 `search_attractions` 返回的景点 ID。成功结果包含 `status`、`poi_id`、`name` 和 `photo_count`。未知 ID 返回 `not_found`，没有已核对地图坐标的景点返回 `unavailable`；不猜测坐标。

系统提示要求在明确景点的讲解、故事或带看回答之前调用；票务、交通、路线规划、多个景点比较和无关闲聊不自动切换。用户要求不切换时不调用。工具成功仅代表展示指令生成，不代表浏览器已完成加载，也不表示游客已到现场。

## 展示方式

- 前端仅响应成功且经过目录 ID 校验的工具结果，不接受模型提供的 HTML、图片地址或坐标。
- `toolEffect` 设置 `introductionView`，关闭旧全景/照片场景并回到地图。
- 伴游模式的本地到达讲解及景点讲解也使用同一份可信展示效果，无需等待模型调用。
- 地图用约 900ms 的缓出动画将景点移动至可用展示区域，避让底部对话栏和右侧控制栏。
- 地标周围先定位，再展开最多三张纸质照片卡片；照片从地标处向外移动、放大并轻微旋转，每张错开 140ms，虚线连接照片与地标。
- 点击收起、按 Escape 或主动操作地图会收起展示并取消未完成的镜头移动；显式进入全景、返回地图、查设施或规划路线不会遗留旧图片。
- 同一语音工具结果不会因为最终回答再次携带 traces 而重新播放。被取消轮次的迟到工具不会触发展示。
- 响应尺寸变化；`prefers-reduced-motion` 下镜头与照片直接就位。图片失败显示说明而不阻塞讲解。

## 图片配置

`src/data/introduction-views.js` 管理可信本地素材。铁塔示例使用现有全景的三个正方形面：塔脚钢架、塔旁绿荫、周边花园；并非三张完整铁塔远景。其他景点沿用现有实拍，无图时只聚焦。新增照片请保留真实来源、授权和描述。

## 验证

```bash
node --test --test-isolation=none tests/introduction-view.test.mjs tests/map.test.mjs
node scripts/verify-introduction-view.mjs
```

浏览器脚本沿用项目现有 Playwright 外部安装路径约定，也可设置 `VIRTOUR_PLAYWRIGHT_PATH`。脚本通过隔离的测试模型验证真实后端工具链，不调用付费供应商；手机、紧凑屏幕和桌面截图保存在 `agent-tmp/introduction/`。
