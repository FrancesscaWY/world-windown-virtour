# 后端可用性核对（2026-11-16）

## 本次故障

文字聊天实际抵达 `/api/guide`，但配置的 `deepseek-v4-flash-vision-exp` 在现有网关中没有可用通道。上游返回 HTTP 503，错误码 `model_not_found`，本项目转为安全的 HTTP 502。网关 `/models` 可访问且密钥有效，所以不是手机网络、站点 Origin 或 API 进程未启动的问题。

经用户指定，运行环境的 `CHAT_MODEL` 已改为 `gpt-6.1-terra`，保留现有网关和密钥。配置仍仅保存在被忽略的 `.env`，未复制或公开凭据。

## 已完成的真实验证

- 指定模型直接完成短对话。
- 本机和公网 `/api/guide` 均返回 HTTP 200；“介绍一下埃菲尔铁塔”实际执行 `get_attraction_guidance`、`introduce_view` 并返回自然中文。
- 手机视口浏览器通过真实公网聊天接口获得回答，无页面脚本错误。
- 公网 TTS 返回多段 PCM 音频和结束事件，没有错误事件。
- 公网实时 WebSocket 连接到配置的 Qwen 模型，收到 `ready` 后主动结束。近期真实交流日志也包含音频输出与完成事件；握手验证本身不代表完整麦克风往返测试。
- 全双工、45 秒音频积压、打断、静音、重连、语音／文字互切及麦克风释放另用隔离协议夹具回归，测试不会伪装为真实供应商回复。

## 后续诊断边界

`/api/health` 只表示 HTTP 服务存活；`/api/status` 的 `providerStatus: configuration-only` 表示配置存在，不能代替供应商实时请求成功。查看 `logs/chats/**/summary.json` 的 `outcome`、`httpStatus`、`error` 与 `model` 定位实际失败。

模型调用现在识别有界 JSON 响应中的 `model_not_found`，仅在服务端给出“没有可用通道”的诊断，不记录上游原始错误正文。游客看到简洁的重试提示，不再看到模型配置或虚假的“本地指令”能力说明。

TTS 遗留跨域断言已与工作区现有“无 Origin 限制”的明确设计对齐，未修改 API 安全策略。公网身份认证与访问限制仍应由外层代理提供。
