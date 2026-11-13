// 下载 VR 键盘的输入法引擎和词库到 vendor/rime(不纳入 git)：
// librime 官方 Windows 版的 rime.dll、librime 依赖包里的 OpenCC 简繁数据、四叶草拼音方案(含 THUOCL 和搜狗网络流行新词词库)、
// jaroomaji 日语罗马字方案(mozc、JMdict、KANJIDIC2 词库)、easy_en 英文单词方案、rime-prelude 的标点和按键配置，
// libhangul 的韩文汉字词库(hanja.txt)，以及各项目的许可证(含 rime.dll 里静态带着的插件和依赖库的)。
// 发布包和许可证下载后核对 sha256，对不上就报错退出；方案和词库的单个文件按完整的提交号取。
// 用法：node scripts/vendor-rime.ts

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dest = path.join(root, 'vendor', 'rime');
// Windows 自带的 bsdtar，可解 7z 和 zip
const TAR = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

const LIBRIME = '1.17.0';
const LIBRIME_BUILD = '33e7814';
// rime.dll 里静态带着的三个插件的提交(librime 发布包里的 version-info.txt 写着)
const LIBRIME_LUA = 'ec52e48';
const LIBRIME_OCTAGRAM = 'dfcc151';
const LIBRIME_PREDICT = '920bd41';
const CLOVER = '1.1.4';
const PRELUDE = '082425ea0684bca36474415d4a0e8db9b016487e';
const JAROOMAJI = 'ff24623f1edb93e722d4886f1b522a6cbffa7291';
const EASY_EN = '54a4a07289412efc54134092c0d945f895a71ed3';
const LIBHANGUL = '23d2cd9d10d516d523d60c562dbcc7ea08139a09';
const GH = 'https://github.com';
const RAW = 'https://raw.githubusercontent.com';

// 三个发布包：[地址, sha256]
export const SOURCES: Readonly<Record<'librime' | 'deps' | 'clover', readonly [string, string]>> = {
  librime: [`${GH}/rime/librime/releases/download/${LIBRIME}/rime-${LIBRIME_BUILD}-Windows-msvc-x64.7z`, '7478c7caa4ff6b37de86daba1f7ce4a994a4f5ba24872a820fb2b3a9b01fed15'],
  deps: [`${GH}/rime/librime/releases/download/${LIBRIME}/rime-deps-${LIBRIME_BUILD}-Windows-msvc-x64.7z`, '9ef5608d8a54ff52bbad7a9b4128de42b232f8e3dd1f5fd3bff42a0b1bacd7e8'],
  clover: [`${GH}/fkxxyz/rime-cloverpinyin/releases/download/${CLOVER}/clover.schema-${CLOVER}.zip`, '327d6a6f9a67772440199ce4961ddae0aba40078285122d327584ff116fd478b'],
};
// 直接下载的单个文件：[仓库, 版本, 仓库里的路径, 保存到 vendor/rime 下的路径]
const FILES: readonly (readonly [string, string, string, string])[] = [
  ...['default.yaml', 'key_bindings.yaml', 'punctuation.yaml', 'symbols.yaml'].map(f => ['rime/rime-prelude', PRELUDE, f, `data/${f}`] as const),
  ...['schema', 'dict', 'user.dict', 'kana_kigou.dict', 'mozc.dict', 'mozcemoji.dict', 'jmdict.dict', 'kanjidic2.dict']
    .map(f => ['lazyfoxchan/rime-jaroomaji', JAROOMAJI, `jaroomaji.${f}.yaml`, `data/jaroomaji.${f}.yaml`] as const),
  ...['easy_en.schema.yaml', 'easy_en.dict.yaml'].map(f => ['BlindingDark/rime-easy-en', EASY_EN, f, `data/${f}`] as const),
  ['libhangul/libhangul', LIBHANGUL, 'data/hanja/hanja.txt', 'hanja.txt'],
];
// 许可证：保存到 vendor/rime/licenses 下的文件名 → [地址, sha256]
export const LICENSES: Readonly<Record<string, readonly [string, string]>> = {
  'librime.txt': [`${RAW}/rime/librime/${LIBRIME}/LICENSE`, 'f67d27a6d2d586fcfed4b4c886a83747095396a39b6641e18e855086be2ec400'],
  'rime-cloverpinyin.txt': [`${RAW}/fkxxyz/rime-cloverpinyin/${CLOVER}/LICENSE`, 'e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118'],
  'rime-prelude.txt': [`${RAW}/rime/rime-prelude/${PRELUDE}/LICENSE`, 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768'],
  'OpenCC.txt': [`${RAW}/BYVoid/OpenCC/ver.1.1.9/LICENSE`, 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308'],
  'THUOCL.txt': [`${RAW}/thunlp/THUOCL/master/LICENSE`, 'db4b8cca414db4cf487b933d07a0514f77caf44f9f3d392f2bc9d7ba0d511c58'],
  'rime-jaroomaji.txt': [`${RAW}/lazyfoxchan/rime-jaroomaji/${JAROOMAJI}/LICENSE`, '1ad7585641ef7b7f3468b2b954c281061b7c35a470efe63d07b9b35627bda662'],
  'mozc.txt': [`${RAW}/google/mozc/master/LICENSE`, '44cdd923b91ea9199293abecc2762c70c87dbf1e581c027a94c416368d1a648c'],
  'rime-easy-en.txt': [`${RAW}/BlindingDark/rime-easy-en/${EASY_EN}/LICENSE`, 'e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118'],
  // rime.dll 里静态带着的插件和依赖库(依赖库的版本是 librime 依赖包里的)
  'librime-lua.txt': [`${RAW}/hchunhui/librime-lua/${LIBRIME_LUA}/LICENSE`, 'c6bd4f58b13ae9d45c5e53adddeea5049114a25862797c6c6f64920431eea249'],
  // librime-octagram 的许可证文件是 GPL 第 3 版全文；LGPL-3.0 的几份数据引用的 GPL 也是这一份
  'GPL-3.0.txt': [`${RAW}/lotem/librime-octagram/${LIBRIME_OCTAGRAM}/LICENSE`, '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'],
  'librime-predict.txt': [`${RAW}/rime/librime-predict/${LIBRIME_PREDICT}/LICENSE`, '9b1bbdf15a381884b47dfd9422e68f6382170b2841c476afc076f2d448c7a59f'],
  'glog.txt': [`${RAW}/google/glog/v0.7.1/COPYING`, '136d48dea7a681413691f3db3098f6cf5ffaa3119d96d97bb83b8cff3ce38c4a'],
  'leveldb.txt': [`${RAW}/google/leveldb/1.23/LICENSE`, 'ccc19f1da0798ed666609b65a5b44dd8b3abe6fc08b9c0592eb76e82e174db19'],
  'marisa-trie.txt': [`${RAW}/s-yata/marisa-trie/v0.3.1/COPYING.md`, 'edf58dab34c3dc239ba4ba2d5d3d844d8c5b442aa4dd1149fac81b2d8c6cb8d1'],
  'yaml-cpp.txt': [`${RAW}/jbeder/yaml-cpp/0.8.0/LICENSE`, 'aa6fcc27be034e41e21dd832f9175bfe694a48491d9e14ff0fa278e19ad14f1b'],
  'Boost.txt': [`${RAW}/boostorg/boost/boost-1.84.0/LICENSE_1_0.txt`, 'c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566'],
};
// Lua 的许可证写在 lua.h 末尾的注释里：[地址, sha256]
const LUA_HEADER = [`${RAW}/lua/lua/v5.4.8/lua.h`, '3b77329f9deed929a5cbe7a7d5fc81ebbb63fd869a49e0a9302fe9240caf1930'] as const;
// darts-clone 的许可证在 librime 依赖包里的位置
const DARTS_LICENSE = ['include', 'COPYING.darts-clone'];
// JMdict / KANJIDIC2 是 CC BY-SA 4.0，许可证全文在线提供
const JMDICT_NOTICE = [
  'JMdict 和 KANJIDIC2 词库(jaroomaji.jmdict / jaroomaji.kanjidic2)来自 Electronic Dictionary Research and Development Group，',
  '按 Creative Commons Attribution-ShareAlike 4.0 许可分发：https://www.edrdg.org/edrdg/licence.html',
  'https://creativecommons.org/licenses/by-sa/4.0/legalcode',
  '',
].join('\n');

// 内容的 sha256(十六进制)
export function sha256(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// 下载到的内容和记下的 sha256 对不上时抛出异常
export function verify(url: string, data: Uint8Array, want: string): void {
  const got = sha256(data);
  if (got !== want) throw new Error(`sha256 对不上：${url}\n  记下的 ${want}\n  下载到 ${got}`);
}

// 下载一个文件；给了 sha256 就核对，对不上不写文件
async function download(url: string, file: string, want?: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (want !== undefined) verify(url, data, want);
  fs.writeFileSync(file, data);
}

function extract(archive: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  execFileSync(TAR, ['-xf', archive, '-C', to]);
}

// hanja.txt 开头那段 # 注释就是它的 BSD 许可证
export function hanjaLicense(text: string): string {
  const lines = text.split('\n');
  const header = lines.slice(0, Math.max(0, lines.findIndex(l => !l.startsWith('#'))));
  return `${header.map(l => l.replace(/^# ?/, '')).join('\n')}\n`;
}

// lua.h 末尾那段用整行星号框起来的注释是 Lua 的许可证；找不到时抛出异常
export function luaLicense(header: string): string {
  const lines = header.split(/\r?\n/);
  const end = lines.findLastIndex(l => /^\*{20,}\/$/.test(l));
  const start = lines.findLastIndex((l, i) => i < end && /^\/\*{20,}$/.test(l));
  if (start < 0 || end < 0) throw new Error('lua.h 里没有许可证那段注释');
  return `${lines.slice(start + 1, end).map(l => l.replace(/^\* ?/, '')).join('\n')}\n`;
}

// 全部内容在临时目录的 out/ 里备齐，都成功了才换掉 vendor/rime；中途失败时 vendor/rime 保持原样
async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-rime-'));
  const out = path.join(tmp, 'out');
  const data = path.join(out, 'data');
  const licenses = path.join(out, 'licenses');
  try {
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(licenses);

    for (const [name, [url, hash]] of Object.entries(SOURCES)) {
      const file = path.join(tmp, path.basename(url));
      await download(url, file, hash);
      extract(file, path.join(tmp, name));
    }
    fs.copyFileSync(path.join(tmp, 'librime', 'dist', 'lib', 'rime.dll'), path.join(out, 'rime.dll'));
    fs.cpSync(path.join(tmp, 'deps', 'share', 'opencc'), path.join(data, 'opencc'), { recursive: true });
    fs.cpSync(path.join(tmp, 'clover'), data, { recursive: true });

    for (const [repo, ref, from, to] of FILES) await download(`${RAW}/${repo}/${ref}/${from}`, path.join(out, to));
    for (const [f, [url, hash]] of Object.entries(LICENSES)) await download(url, path.join(licenses, f), hash);
    fs.copyFileSync(path.join(tmp, 'deps', ...DARTS_LICENSE), path.join(licenses, 'darts-clone.txt'));
    const luaHeader = path.join(tmp, 'lua.h');
    await download(LUA_HEADER[0], luaHeader, LUA_HEADER[1]);
    fs.writeFileSync(path.join(licenses, 'Lua.txt'), luaLicense(fs.readFileSync(luaHeader, 'utf8')));
    fs.writeFileSync(path.join(licenses, 'JMdict-KANJIDIC2.txt'), JMDICT_NOTICE);
    fs.writeFileSync(path.join(licenses, 'libhangul-hanja.txt'), hanjaLicense(fs.readFileSync(path.join(out, 'hanja.txt'), 'utf8')));

    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(out, dest, { recursive: true });
    console.log(`已下载到 ${dest}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) await main();
