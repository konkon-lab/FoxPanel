// 下载输入法引擎和词库的脚本(scripts/vendor-rime.ts)里不联网的部分：sha256 的核对、每个地址都记着 sha256、从文件里取许可证。

import test from 'node:test';
import assert from 'node:assert/strict';
import { hanjaLicense, LICENSES, luaLicense, sha256, SOURCES, verify } from '../scripts/vendor-rime.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test('sha256：内容对得上通过；对不上抛出异常，带地址、记下的和下载到的', () => {
  const data = bytes('abc');
  const want = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256(data), want);
  verify('https://example.invalid/a', data, want);
  assert.throws(() => verify('https://example.invalid/a', bytes('abd'), want), (e: unknown) => {
    const text = String(e);
    return text.includes('https://example.invalid/a') && text.includes(want) && text.includes(sha256(bytes('abd')));
  });
});

test('发布包和许可证每个地址都记着 sha256', () => {
  const entries = [...Object.entries(SOURCES), ...Object.entries(LICENSES)];
  assert.ok(entries.length >= 3 + 8);
  for (const [name, [url, hash]] of entries) {
    assert.match(url, /^https:\/\/(github\.com|raw\.githubusercontent\.com)\//, name);
    assert.match(hash, /^[0-9a-f]{64}$/, name);
  }
  // 许可证是 LGPL-3.0 的数据要同时带 GPL 第 3 版全文
  assert.ok('GPL-3.0.txt' in LICENSES);
  // rime.dll 里静态带着的插件和库
  for (const f of ['librime-lua.txt', 'librime-predict.txt', 'glog.txt', 'leveldb.txt', 'marisa-trie.txt', 'yaml-cpp.txt', 'Boost.txt']) assert.ok(f in LICENSES, f);
});

test('hanja.txt 开头的 # 注释取成许可证，不带行首的 # 和一个空格', () => {
  assert.equal(hanjaLicense('# Copyright (c) X\n#\n#  indented\n가:家:\n# later\n'), 'Copyright (c) X\n\n indented\n');
  assert.equal(hanjaLicense('가:家:\n'), '\n');
});

test('lua.h 末尾星号框起来的注释取成 Lua 的许可证；没有时报错', () => {
  const header = [
    '/******************************************************************************',
    '* an earlier block',
    '******************************************************************************/',
    '#define LUA_VERSION "5.4"',
    '/******************************************************************************',
    '* Copyright (C) 1994-2025 Lua.org, PUC-Rio.',
    '*',
    '* Permission is hereby granted',
    '******************************************************************************/',
    '',
    '#endif',
    '',
  ].join('\r\n');
  assert.equal(luaLicense(header), 'Copyright (C) 1994-2025 Lua.org, PUC-Rio.\n\nPermission is hereby granted\n');
  assert.throws(() => luaLicense('#define LUA_VERSION "5.4"\n/* short */\n'), /lua\.h/);
});
