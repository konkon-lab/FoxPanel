// 测试用的 @konkon-lab/foxpanel-window(window-a-*.test.ts 导入它，下面的模块钩子让组件的代码也用它)：响应式的假 store，fox.compSet 只把改动记下来，t 原样返回键。
import { registerHooks } from 'node:module';
import { reactive, ref } from 'vue';
import { textOf } from '../src/shared/manifest.ts';
import { defineMessages } from '../src/shared/messages.ts';
import type { ComponentGroup, ComponentPatch, ComponentResult, ComponentRow, Locale } from '../src/shared/types.ts';

export { defineMessages, textOf };

export const locale = ref<Locale>('zh-Hans');
export const t = (key: string): string => key;

export const store = reactive({
  comps: { rows: [] as ComponentRow[] },
  settings: { components: { groups: [] as ComponentGroup[], folded: [] as string[], names: {} as Record<string, string> } },
});

// fox.compSet 收到的改动，和它下一次的答复
export const patches: ComponentPatch[] = [];
export const reply: { next: ComponentResult } = { next: { ok: true } };
export const fox = {
  compSet(patch: ComponentPatch): Promise<ComponentResult> {
    patches.push(patch);
    return Promise.resolve(reply.next);
  },
};

// 之后加载的模块里的 @konkon-lab/foxpanel-window 都解析到这个文件：测试文件静态导入它，组件的代码用 import() 加载
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@konkon-lab/foxpanel-window') return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
