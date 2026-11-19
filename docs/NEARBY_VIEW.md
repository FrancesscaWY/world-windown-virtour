# 周边景点工具与照片浏览

## 调用

文字、原生语音、实时通话共用 `look_around` 工具。询问“周围有什么”“附近有哪些景点”“距离我最近的项目”时，导游应调用此工具。

- `poi_id`：可选，明确查询某景点周边时使用目录 ID。
- `radius_meters`：可选，50—1500 米，默认 450 米。
- `limit`：可选，1—8 个，默认 6 个。

不指定中心时优先使用页面已有的有效游客定位；没有定位时回退到当前话题／选中景点，并在界面和回答中说明“以该景点为中心”，不代表游客真实位置。无可靠中心时返回不可用；范围内无记录时显示空态，不向外补齐或编造地点。

## 数据与呈现

只使用目录中有已核对地理坐标的景点，用地理坐标估算直线距离，不将手绘地图像素转换成米，不提供步行距离、耗时或实时开放状态。结果按距离排序，直接在地图对应地点显示名称、直线距离和已收录照片；无照片的景点仅显示名称标签，不展示占位图片或借用其他景点图片。不弹出周边列表、弹窗或横向卡片栏。

前端校验成功状态、中心、参数范围和结果 ID 顺序，再从本地目录重建名称、坐标和图片，拒绝上游提供的任意 HTML 或图片地址。新工具结果替换旧周边视图，景点展示／路线／设施等切换会退出周边浏览。

地图通过现有 requestAnimationFrame 镜头平滑取景；各地点的照片和标签以 transform / opacity 错峰浮入，图片解码后淡入，镜头移动时实时跟随地标。密集景点在屏幕空间避让，细线和圆点连接真实地标，不改变地点坐标。支持地图拖动缩放、点击照片／标签查看景点、紧凑屏幕、键盘、Escape、图片加载失败与减少动态效果偏好。地图控制栏的关闭按钮可收起周边标注。周边展开时暂隐浮动数字人，避免遮挡，收起后恢复。

## 验证

```bash
node --test tests/nearby-view.test.mjs tests/ai.test.mjs tests/backend.test.mjs tests/introduction-view.test.mjs tests/routes.test.mjs tests/map.test.mjs tests/realtime-call.test.mjs
node scripts/verify-nearby-view.mjs
npm run check
npm run build
```

浏览器脚本沿用已有验证脚本的 Playwright 寻址方式，可通过 `VIRTOUR_PLAYWRIGHT_PATH` 指定安装路径。脚本覆盖 390×844、360×640、1280×900，截图写入 `agent-tmp/nearby/`。
