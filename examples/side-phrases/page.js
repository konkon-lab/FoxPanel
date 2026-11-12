// 常用语侧栏页：一页按钮，点一下插入(或直接发送)一句常用语。纯 JS，不用构建。

export default {
  name: 'yanuo.side-phrases',
  inject: ['kb'],
  apply(ctx, config) {
    const phrases = (config.phrases ?? []).map(p => p.text).filter(Boolean);
    ctx.effect(() => ctx.slot.mount(el => {
      const box = document.createElement('div');
      box.className = 'card';
      box.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;overflow-y:auto';
      for (const text of phrases) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        b.textContent = text;
        b.title = text;
        b.style.cssText = 'flex:0 0 auto;min-height:40px;padding:0 12px;text-align:left;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        // 这一列能滚动：按住拖动是滚，所以按钮在 click 时才插入(拖动之后宿主不发 click)
        b.addEventListener('click', () => {
          ctx.kb.act({ kind: 'text', text });
          if (config.send) ctx.kb.act({ kind: 'send' });
        });
        box.append(b);
      }
      el.append(box);
    }));
  },
};
