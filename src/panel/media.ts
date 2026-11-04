// 媒体页面(隐藏窗口)：输出、输入源、翻译组件的页面代码跑在这里，用来播放音频、打开麦克风；没有插槽。
// 组件的上下文里有 id、config、storage、bus、log、relay。要加载的组件或它们的设置变了时宿主让整页重载。

import { Context } from 'cordis';
import { fox, loadPlugin, watchWaiting } from './services.ts';

const plan = await fox.plan();
if (plan.kind !== 'media') throw new Error('这一页不是媒体页面');
const root = new Context();
// 服务的页面部分排在用它们的组件前面；一个组件加载失败(已记进运行日志)不影响后面的
for (const c of [...plan.services, ...plan.components]) await loadPlugin(root, c).catch(() => undefined);
watchWaiting(root);
