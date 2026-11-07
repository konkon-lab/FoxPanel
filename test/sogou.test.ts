import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSogouUserDict, userDictText } from '../components/ime/src/sogou.ts';

// 按 SGPU 格式拼一个用户词库：索引区放每条的偏移，词条 = 次数 + 7 字节 + 拼音长度 + 拼音序号 + 2 字节 + 词长度 + UTF-16 词
function sgpu(entries: { freq: number; py: number[]; word: string }[]): Buffer {
  const idxBegin = 0x50;
  const dictBegin = idxBegin + 4 * entries.length;
  const bodies = entries.map(e => {
    const word = Buffer.from(e.word, 'utf16le');
    const b = Buffer.alloc(2 + 7 + 2 + 2 * e.py.length + 2 + 2 + word.length);
    let p = 0;
    b.writeUInt16LE(e.freq, p);
    p += 9;
    b.writeUInt16LE(2 * e.py.length, p);
    p += 2;
    for (const k of e.py) p = b.writeUInt16LE(k, p);
    p += 2;
    b.writeUInt16LE(word.length, p);
    word.copy(b, p + 2);
    return b;
  });
  const head = Buffer.alloc(dictBegin);
  head.write('SGPU', 0, 'latin1');
  head.writeUInt32LE(idxBegin, 0x38);
  head.writeUInt32LE(entries.length, 0x40);
  head.writeUInt32LE(dictBegin, 0x44);
  let off = 0;
  bodies.forEach((b, i) => {
    head.writeUInt32LE(off, idxBegin + 4 * i);
    off += b.length;
  });
  return Buffer.concat([head, ...bodies]);
}

// 拼音序号：a=0 li=173 yun=375 zuo=412，413 起是字母
test('搜狗词库：同词同音次数相加，只留纯汉字、不超过 8 字、字数和拼音数一致的词', () => {
  const words = parseSogouUserDict(sgpu([
    { freq: 25, py: [0, 173], word: '阿里' },
    { freq: 1, py: [0, 173], word: '阿里' },
    { freq: 41, py: [0, 173, 375], word: '阿里云' },
    { freq: 3, py: [0, 425], word: '阿M' },
    { freq: 2, py: Array<number>(9).fill(0), word: '啊'.repeat(9) },
    { freq: 2, py: [0], word: '阿里' },
  ]));
  assert.deepEqual(words, [
    { word: '阿里', code: 'a li', count: 26 },
    { word: '阿里云', code: 'a li yun', count: 41 },
  ]);
  assert.equal(userDictText([...words, { word: '坐', code: 'zuo', count: 0 }]), '阿里\ta li\t26\n阿里云\ta li yun\t41\n坐\tzuo\t1\n');
});

test('搜狗词库：文件头不是 SGPU 时报错', () => {
  assert.throws(() => parseSogouUserDict(Buffer.alloc(0x100)), /SGPU/);
});
