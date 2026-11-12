// Discord 输出：发送时把文字 POST 到 webhook。纯 JS，不用构建；跑在组件进程里(Node)。

export default {
  name: 'yanuo.output-discord',
  apply(ctx, config) {
    const url = String(config.webhook ?? '');
    const pick = ({ text, spoken }) => {
      if (config.content === 'text') return text;
      if (config.content === 'spoken') return spoken;
      return spoken && spoken !== text ? `${text}（${spoken}）` : text;
    };
    ctx.output.register({
      async send(p) {
        const content = pick(p).trim();
        if (!content) return;
        if (!url) return ctx.log('没有填 webhook 地址');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.slice(0, 2000), username: config.username || undefined }),
        });
        if (!res.ok) ctx.log(`发送失败：${res.status} ${(await res.text()).slice(0, 200)}`);
      },
    });
  },
};
