// 工作线程里的 koffi：组件装在数据文件夹里找不到程序的 node_modules，用主线程传来的地址(程序自带的那份)加载
import { workerData } from 'node:worker_threads';
import type koffiType from 'koffi';

const mod = await import((workerData as { koffi: string }).koffi) as { default: typeof koffiType };
export default mod.default;
