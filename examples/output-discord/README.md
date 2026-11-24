# Discord

输出组件：发送时把文字发到 Discord 频道。装上后先关着，在主窗口 组件 → Discord 里填 webhook 地址再打开。

- 在 Discord 频道设置 → 整合 → Webhook 里新建一个，复制地址。地址用系统凭据加密保存。
- 「发送内容」：原文（译文）/ 仅原文 / 仅译文(开了翻译组件时才有译文)。
- 只在按发送时发，自动送出和 PIN 不发(没有设 `live`)。

`main.js` 是纯 JS，不用构建，跑在组件进程里(Node)：用 `ctx.output.register` 注册，`fetch` 发请求，出错用 `ctx.log` 写日志。见 [SDK](../../docs/sdk.md)。
