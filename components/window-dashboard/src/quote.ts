// 仪表盘标题旁的每日一言：一言(hitokoto)接口取一句，当天缓存在本机；取不到时按日期从内置语句中选。

import { reactive } from 'vue';
import { dayOf, isObject } from '../../_shared/util.ts';

const API = 'https://v1.hitokoto.cn/?encode=json&c=d&c=i&c=k';   // 一言接口；c 是句子类别：文学、诗词、哲学
const CACHE_KEY = 'foxpanel.quote';   // localStorage 里存当天那一句的键
const TIMEOUT_MS = 5000;           // 接口请求的超时(毫秒)

interface Quote {
  text: string;
  from: string;   // 作者或出处，没有时为空
}

const LOCAL: readonly Quote[] = [
  { text: '人生如逆旅，我亦是行人。', from: '苏轼' },
  { text: '路漫漫其修远兮，吾将上下而求索。', from: '屈原' },
  { text: '长风破浪会有时，直挂云帆济沧海。', from: '李白' },
  { text: '行到水穷处，坐看云起时。', from: '王维' },
  { text: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。', from: '苏轼' },
  { text: '山重水复疑无路，柳暗花明又一村。', from: '陆游' },
  { text: '海内存知己，天涯若比邻。', from: '王勃' },
];

export const quote = reactive<Quote>({ text: '', from: '' });

function set(q: Quote): void {
  quote.text = q.text;
  quote.from = q.from;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// 缓存里当天的那一句；没有、不是当天的或格式不对返回 null
export function fromCache(raw: string | null, today: string): Quote | null {
  try {
    const c: unknown = JSON.parse(raw ?? 'null');
    if (!isObject(c) || c['day'] !== today) return null;
    const text = str(c['text']);
    return text ? { text, from: str(c['from']) } : null;
  } catch {
    return null;
  }
}

// 接口返回里的那一句(出处优先用作者)；格式不对返回 null
export function fromApi(body: unknown): Quote | null {
  if (!isObject(body)) return null;
  const text = str(body['hitokoto']);
  return text ? { text, from: str(body['from_who']) || str(body['from']) } : null;
}

// 读当天缓存，没有就请求接口
export async function loadQuote(): Promise<void> {
  const today = dayOf(new Date());
  let raw: string | null = null;
  try { raw = localStorage.getItem(CACHE_KEY); } catch { /* 读不了就重新取 */ }
  const cached = fromCache(raw, today);
  if (cached) return set(cached);
  set(LOCAL[new Date().getDate() % LOCAL.length] ?? LOCAL[0]!);
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const q = fromApi(await res.json());
    if (!q) return;
    set(q);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...q, day: today })); } catch { /* 存不了就下次再取 */ }
  } catch { /* 离线时用内置语句 */ }
}
