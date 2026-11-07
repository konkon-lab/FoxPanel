// 搜狗拼音的用户词库(sgim_gd_usr.bin，文件头 SGPU)：读出词、拼音和使用次数，转成 rime 用户词库的导入文本。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAGIC = 0x55504753;   // "SGPU"
// 文件头的长度，和头里几个 32 位数的位置：索引区起点、词条数、词条区起点
const HEADER_SIZE = 0x50;
const INDEX_BEGIN_AT = 0x38;
const COUNT_AT = 0x40;
const DICT_BEGIN_AT = 0x44;
// 超过这么多字的词不导入
const MAX_CHARS = 8;
// 拼音序号表的前 413 项(之后是字母和数字，纯汉字词用不到)
const SYLLABLES = (
  'a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha ' +
  'chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui ' +
  'cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er ' +
  'fa fan fang fei fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun ' +
  'guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin ' +
  'jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai ' +
  'lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lve lun luo lv ma mai man mang ' +
  'mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie ' +
  'nin ning niu nong nou nu nuan nve nun nuo nv o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu ' +
  'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ' +
  'ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang ' +
  'shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan ' +
  'tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan ' +
  'yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe ' +
  'zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo'
).split(' ');

export interface UserWord {
  word: string;
  code: string;    // 空格分隔的拼音
  count: number;   // 使用次数
}

// 本机搜狗用户目录下最近修改的用户词库；未安装时返回 null
export function findSogouUserDict(): string | null {
  const root = path.join(os.homedir(), 'AppData', 'LocalLow', 'SogouPY.users');
  let best: { file: string; time: number } | null = null;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const file = path.join(root, d, 'sgim_gd_usr.bin');
    try {
      const time = fs.statSync(file).mtimeMs;
      if (!best || time > best.time) best = { file, time };
    } catch {
      // 该目录没有用户词库
    }
  }
  return best?.file ?? null;
}

// 解析用户词库：仅保留纯汉字、不超过 8 个字且每个字都有拼音的词；同词同音的次数相加。
// 索引区每项 4 字节，是词条在词条区里的偏移；词条 = 次数(2 字节) + 7 字节 + 拼音字节数(2) + 拼音序号(每个 2) + 2 字节 + 词的字节数(2) + UTF-16 的词
export function parseSogouUserDict(b: Buffer): UserWord[] {
  if (b.length < HEADER_SIZE || b.readUInt32LE(0) !== MAGIC) throw new Error('不是搜狗用户词库(SGPU)文件');
  const idxBegin = b.readUInt32LE(INDEX_BEGIN_AT);
  const count = b.readUInt32LE(COUNT_AT);
  const dictBegin = b.readUInt32LE(DICT_BEGIN_AT);
  const words = new Map<string, UserWord>();
  for (let i = 0; i < count; i++) {
    let p = b.readUInt32LE(idxBegin + 4 * i) + dictBegin;
    const freq = b.readUInt16LE(p);
    p += 9;
    const n = b.readUInt16LE(p) / 2;
    p += 2;
    const code: string[] = [];
    for (let j = 0; j < n; j++, p += 2) code.push(SYLLABLES[b.readUInt16LE(p)] ?? '');
    p += 2;
    const size = b.readUInt16LE(p);
    p += 2;
    const word = b.toString('utf16le', p, p + size);
    const chars = [...word];
    if (!/^\p{Script=Han}+$/u.test(word) || chars.length > MAX_CHARS || chars.length !== code.length || code.includes('')) continue;
    const key = `${word}\t${code.join(' ')}`;
    const prev = words.get(key);
    if (prev) prev.count += freq;
    else words.set(key, { word, code: code.join(' '), count: freq });
  }
  return [...words.values()];
}

// rime 用户词库导入文本：词 \t 编码 \t 次数
export function userDictText(words: readonly UserWord[]): string {
  return words.map(w => `${w.word}\t${w.code}\t${Math.max(1, w.count)}\n`).join('');
}

// 把搜狗用户词库 src 转成导入文本，写成 dir 里的临时文件交给 importDict(用完删掉)；返回 importDict 给的条数
export async function importSogouDict(src: string, dir: string, importDict: (file: string) => Promise<number>): Promise<number> {
  const file = path.join(dir, 'sogou_import.txt');
  try {
    fs.writeFileSync(file, userDictText(parseSogouUserDict(fs.readFileSync(src))));
    return await importDict(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
