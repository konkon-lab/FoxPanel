// 新版本的发布说明(更新源给的 HTML)收成一条条文字：小标题、列表项、段落，只留文字，标签和属性都不要。
// 主窗口照这些条目自己画，不把更新源给的 HTML 放进页面。另有发布日期和发布页地址的收窄。

import type { UpdateNote } from './types.ts';

const NOTES_MAX = 60;         // 最多留这么多条
const NOTE_CHARS_MAX = 500;   // 一条最多这么多个字，多的截掉
const NOTES_INPUT_MAX = 100_000;   // 发布说明超过这么多个字符的部分不看

// 认得的块：小标题、列表项、段落
const BLOCK = /<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
// 安装包的校验值(64 位十六进制)：发版时附在发布说明末尾的那一行不显示
const DIGEST = /\b[0-9a-f]{64}\b/i;

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'', nbsp: ' ' };

// 字符实体换回字符；不认识的原样留着
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// 一段 HTML 里的文字：去掉标签，实体换回字符，连续的空白并成一个空格
const plain = (html: string): string => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS_MAX);

// 一个版本的发布说明：更新源给的是字符串，或者几个版本各一份 { note } 的数组(取第一份，最新的那个版本)
function textOf(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const first: unknown = Array.isArray(raw) ? raw[0] : null;
  const note: unknown = typeof first === 'object' && first !== null && 'note' in first ? first.note : null;
  return typeof note === 'string' ? note : '';
}

// 发布说明 → 条目。没有认得的块时按行当成段落；没有内容时是空数组
export function notesOf(raw: unknown): UpdateNote[] {
  const html = textOf(raw).slice(0, NOTES_INPUT_MAX);
  const notes: UpdateNote[] = [];
  for (const m of html.matchAll(BLOCK)) {
    const tag = (m[1] ?? '').toLowerCase();
    const text = plain(m[2] ?? '');
    if (!text || DIGEST.test(text)) continue;
    notes.push({ kind: tag === 'li' ? 'item' : tag === 'p' ? 'text' : 'heading', text });
  }
  if (notes.length === 0) {
    for (const line of html.split(/\r?\n/)) {
      const text = plain(line);
      if (text && !DIGEST.test(text)) notes.push({ kind: 'text', text });
    }
  }
  return notes.slice(0, NOTES_MAX);
}

// 发布时间(ISO 字符串) → 本地的 YYYY-MM-DD；不是合法的时间时为 null
export function releaseDay(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 更新源的配置(app-update.yml 的内容)是 GitHub 时，version 这一版的发布页；别的更新源、名字或版本号里有不该有的字符时为 null
export function releasePage(config: string, version: string): string | null {
  const field = (name: string): string => new RegExp(`^${name}:\\s*['"]?([^'"\\s#]+)['"]?\\s*$`, 'm').exec(config)?.[1] ?? '';
  const owner = field('owner');
  const repo = field('repo');
  const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (field('provider') !== 'github' || !NAME.test(owner) || !NAME.test(repo) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;
  return `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
}
