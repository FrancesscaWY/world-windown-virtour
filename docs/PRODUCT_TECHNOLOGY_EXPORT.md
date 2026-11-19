# 产品与技术文档维护说明

- 正文源文件：`docs/PRODUCT_TECHNOLOGY.md`。
- 成品：`docs/VirTour-产品与技术文档.docx`、同名 `.pdf` 与独立预览 `.html`。
- 图片：`docs/assets/product-technology/`，从当前浏览器界面截取，未生成模型回答或模拟游客使用证据。
- 编制日期：2026-11-18。内容规模由代码直接统计；成熟度为参考九级框架的 TRL 4 项目自评，不是认证。

## 重新导出

依赖项目已有的 `fflate`、`sharp`，以及可用的 Playwright／Chromium，不增加 npm 依赖或调用模型。

```bash
node scripts/export-product-technology.mjs
```

如需重新截取界面，先确保本地开发服务可用，再加 `--capture`。该选项仅切换界面与全景，不发送文字、录音、实时通话或 TTS 请求。

可用环境变量：

- `VIRTOUR_PLAYWRIGHT_PATH`：Playwright 模块入口。
- `CHROME_PATH`：Chromium 可执行文件。
- `DEMO_URL`：截图使用的页面地址前缀，以 `/` 结尾；默认本机 5174。

PDF 固定 A4 三页，检查页数、字体嵌入、截图加载、横向溢出及正文与页脚的间距；排版检查截图和 JSON 位于 `agent-tmp/product-technology/`。Word 由同一正文生成，含可编辑段落、对比表、超链接及三张内嵌截图，进行了 ZIP／XML 包结构与内容检查；当前环境无 Office／LibreOffice，未执行 Word 实际渲染验收，不保证不同字体或 Office 版本的分页完全一致。固定分页交付以 PDF 为准。

文中自动化测试与真实服务验证引自已有记录，不把本次文档导出当成实时语音、真机或实地能力的再次验收。所有网页来源保留 URL 和访问日期。
