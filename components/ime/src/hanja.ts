// 韩文汉字词库(libhangul 的 hanja.txt，每行 韩文:汉字:释义)：按韩文查汉字。
// 词库有几兆：preload 提前读入(读文件不占主线程)，没读完就查询时当场同步读。

import fs from 'node:fs';

// 词库文本 → 韩文到汉字的表；同一个韩文的汉字按文件里的顺序，不重复
function parse(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [hangul = '', hanja = ''] = line.split(':');
    if (!hangul || !hanja || hanja === hangul) continue;
    const list = map.get(hangul);
    if (list) {
      if (!list.includes(hanja)) list.push(hanja);
    } else {
      map.set(hangul, [hanja]);
    }
  }
  return map;
}

export class HanjaDict {
  private readonly file: string;
  private map: Map<string, string[]> | null = null;
  private loading: Promise<void> | null = null;

  constructor(file: string) {
    this.file = file;
  }

  // 提前读入词库；在读的时候再调返回同一次读取，读不了时抛出(下次调用重读)
  preload(): Promise<void> {
    if (this.map) return Promise.resolve();
    this.loading ??= fs.promises.readFile(this.file, 'utf8')
      .then(text => { this.map ??= parse(text); })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  lookup(hangul: string): readonly string[] {
    this.map ??= parse(fs.readFileSync(this.file, 'utf8'));
    return this.map.get(hangul) ?? [];
  }
}
