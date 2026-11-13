// 打进 dist/ 的 npm 包的许可证收集(scripts/licenses.ts)：从 metafile 找包、读包的许可证、拼成文本。

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPackageDirs, licensesText, packageDirOf, readPackage, type BundleMeta } from '../scripts/licenses.ts';

// 临时文件夹里写一个包：package.json 和几个文件
function writePackage(t: TestContext, pkg: Record<string, unknown>, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-licenses-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('输入文件所属的包文件夹：普通包、带作用域的包、嵌套的 node_modules 取最里面一层；不在 node_modules 里的不算', () => {
  assert.equal(packageDirOf('node_modules/naive-ui/es/index.mjs'), 'node_modules/naive-ui');
  assert.equal(packageDirOf('node_modules/@juggle/resize-observer/lib/exports.js'), 'node_modules/@juggle/resize-observer');
  assert.equal(packageDirOf('node_modules/a/node_modules/@s/b/x.js'), 'node_modules/a/node_modules/@s/b');
  assert.equal(packageDirOf(['node_modules', 'cordis', 'lib', 'index.mjs'].join(path.sep)), 'node_modules/cordis');
  assert.equal(packageDirOf('components/osc/src/main.ts'), null);
  assert.equal(packageDirOf('node_modules/@scope'), null);
});

test('产物里带着代码的包：只算占了字节的输入，去重、排序', () => {
  const metas: BundleMeta[] = [
    {
      outputs: {
        'dist/a.js': {
          inputs: {
            'node_modules/vooks/es/index.mjs': { bytesInOutput: 10 },
            'node_modules/vooks/es/other.mjs': { bytesInOutput: 3 },
            'node_modules/unused/index.js': { bytesInOutput: 0 },
            'src/main/main.ts': { bytesInOutput: 99 },
          },
        },
      },
    },
    { outputs: { 'dist/b.js': { inputs: { 'node_modules/@emotion/hash/dist/hash.esm.js': { bytesInOutput: 1 }, 'node_modules/vooks/es/index.mjs': { bytesInOutput: 10 } } } } },
  ];
  assert.deepEqual(bundledPackageDirs(metas), ['node_modules/@emotion/hash', 'node_modules/vooks']);
  assert.deepEqual(bundledPackageDirs([]), []);
});

test('读一个包：名字、版本、许可证名、作者、来源，最外层的许可证文件按文件名排', t => {
  const dir = writePackage(t, {
    name: '@x/lib', version: '1.2.3', license: 'Apache-2.0', author: { name: 'Someone', email: 'a@b.c' }, repository: { type: 'git', url: 'git+https://example.invalid/x.git' },
  }, { NOTICE: 'notice text', 'LICENSE.md': 'license text', 'LICENSE-MIT.txt': 'mit text', 'docs/LICENSE': 'inner', 'licenses.js': 'code', 'README.md': 'readme' });
  assert.deepEqual(readPackage(dir), {
    name: '@x/lib', version: '1.2.3', license: 'Apache-2.0', author: 'Someone', source: 'git+https://example.invalid/x.git',
    texts: [{ file: 'LICENSE-MIT.txt', text: 'mit text' }, { file: 'LICENSE.md', text: 'license text' }, { file: 'NOTICE', text: 'notice text' }],
  });
});

test('读一个包：字段是字符串或没写；没有许可证文件时 texts 为空', t => {
  const dir = writePackage(t, { name: 'bare', version: '0.1.0', license: 'MIT', author: 'Me <me@example.invalid>', homepage: 'https://example.invalid/bare' }, { 'index.js': '' });
  assert.deepEqual(readPackage(dir), { name: 'bare', version: '0.1.0', license: 'MIT', author: 'Me <me@example.invalid>', source: 'https://example.invalid/bare', texts: [] });
  const none = writePackage(t, { name: 'none', version: '1.0.0' }, {});
  assert.deepEqual(readPackage(none), { name: 'none', version: '1.0.0', license: '', author: '', source: '', texts: [] });
});

test('拼成文本：按包名排，每个包带名字和版本、许可证名、全文；没有许可证文件的写明', () => {
  const text = licensesText([
    { name: 'zeta', version: '2.0.0', license: 'MIT', author: 'Z', source: 'https://example.invalid/zeta', texts: [{ file: 'LICENSE', text: 'ZETA LICENSE TEXT\r\nline 2\r\n\r\n' }] },
    { name: 'alpha', version: '1.0.0', license: '', author: '', source: '', texts: [] },
    { name: 'Beta', version: '1.0.0', license: 'ISC', author: '', source: '', texts: [{ file: 'LICENSE', text: 'BETA ONE' }, { file: 'NOTICE', text: 'BETA TWO' }] },
  ]);
  const at = (s: string): number => text.indexOf(s);
  assert.ok(at('Beta 1.0.0') > 0 && at('Beta 1.0.0') < at('alpha 1.0.0') && at('alpha 1.0.0') < at('zeta 2.0.0'));
  assert.ok(text.includes('zeta 2.0.0\n许可证：MIT\n作者：Z\n来源：https://example.invalid/zeta\n'));
  assert.ok(text.includes('ZETA LICENSE TEXT\nline 2\n'));
  assert.ok(!text.includes('\r'));
  assert.ok(text.includes('BETA ONE\n\nBETA TWO'));
  assert.ok(text.includes('alpha 1.0.0\n许可证：没有写\n'));
  assert.ok(!text.includes('alpha 1.0.0\n许可证：没有写\n作者'));
  assert.match(text.slice(at('alpha 1.0.0'), at('zeta 2.0.0')), /没有许可证文件/);
  assert.ok(text.endsWith('line 2\n'));
});
