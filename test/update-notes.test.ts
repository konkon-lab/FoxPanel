// 新版本的发布说明收成条目(src/shared/update-notes.ts)：只留小标题、列表项、段落的文字；发布日期和发布页地址的收窄。

import test from 'node:test';
import assert from 'node:assert/strict';
import { notesOf, releaseDay, releasePage } from '../src/shared/update-notes.ts';

// 更新源给的发布说明的样子：段落、小标题、列表，末尾一行安装包的校验值
const FEED = [
  '<p>第二个测试版，以下是上一版之后的改动。</p>',
  '<h2>新增</h2>',
  '<ul>',
  '<li>面板跟随游玩空间，可在 组件 → SteamVR 关闭</li>',
  '</ul>',
  '<h2>调整</h2>',
  '<ul>',
  '<li>「播放到」更名为「播放设备」</li>',
  '<li>图标 &amp; 文案</li>',
  '</ul>',
  '<p>安装包 SHA256：<code>35d78b7dc2d69daafee5c2dac611f2b689aef5c805d8d25c453694bf92f7a48e</code></p>',
].join('\n');

test('发布说明：小标题、列表项、段落各成一条，照原来的次序；安装包校验值那一行不要', () => {
  assert.deepEqual(notesOf(FEED), [
    { kind: 'text', text: '第二个测试版，以下是上一版之后的改动。' },
    { kind: 'heading', text: '新增' },
    { kind: 'item', text: '面板跟随游玩空间，可在 组件 → SteamVR 关闭' },
    { kind: 'heading', text: '调整' },
    { kind: 'item', text: '「播放到」更名为「播放设备」' },
    { kind: 'item', text: '图标 & 文案' },
  ]);
});

test('发布说明：只留文字，里面的标签、属性、脚本都不进条目；实体换回字符，空白并成一个空格', () => {
  const notes = notesOf('<h3 class="x" onclick="alert(1)">标题 <em>强调</em></h3>\n<p>一行<br>两行 <a href="javascript:alert(1)">链接</a>\n  &lt;script&gt;alert(1)&lt;/script&gt; &#x4e2d;&#25991; &nbsp;&quot;引号&quot; &unknown;</p><LI>大写的标签</LI>');
  assert.deepEqual(notes, [
    { kind: 'heading', text: '标题 强调' },
    { kind: 'text', text: '一行 两行 链接 <script>alert(1)</script> 中文 "引号" &unknown;' },
    { kind: 'item', text: '大写的标签' },
  ]);
  for (const n of notes) assert.deepEqual(Object.keys(n), ['kind', 'text']);
  // 认不得的块(脚本、图片、表格)整个不要
  assert.deepEqual(notesOf('<script>alert(1)</script><img src=x onerror=alert(1)><p>正文</p><table><tr><td>格</td></tr></table>'), [{ kind: 'text', text: '正文' }]);
});

test('发布说明：没有认得的块时按行当成段落；空的、不是字符串的没有条目', () => {
  assert.deepEqual(notesOf('第一行\n\n  第二行  \r\n校验值 35d78b7dc2d69daafee5c2dac611f2b689aef5c805d8d25c453694bf92f7a48e'), [{ kind: 'text', text: '第一行' }, { kind: 'text', text: '第二行' }]);
  for (const raw of ['', '   ', null, undefined, 42, {}, [], [{}], [{ note: 7 }], '<p></p><ul><li> </li></ul>']) assert.deepEqual(notesOf(raw), [], JSON.stringify(raw));
});

test('发布说明：几个版本各一份时取第一份', () => {
  assert.deepEqual(notesOf([{ version: '1.2.0', note: '<p>新的</p>' }, { version: '1.1.0', note: '<p>旧的</p>' }]), [{ kind: 'text', text: '新的' }]);
});

test('发布说明：条数和每条的长度有上限', () => {
  const many = notesOf(Array.from({ length: 200 }, (_, i) => `<li>第 ${i} 条</li>`).join(''));
  assert.equal(many.length, 60);
  assert.equal(many[59]?.text, '第 59 条');
  const [long] = notesOf(`<p>${'长'.repeat(2000)}</p>`);
  assert.equal(long?.text.length, 500);
  // 超长的发布说明只看前面一段
  assert.ok(notesOf(`${'<p>段</p>'.repeat(10)}${' '.repeat(200_000)}<p>尾</p>`).every(n => n.text === '段'));
});

test('发布日期：ISO 时间换成本地的年月日；不是合法时间的没有', () => {
  assert.equal(releaseDay(new Date(2026, 10, 24, 12, 30).toISOString()), '2026-11-24');
  assert.equal(releaseDay(new Date(2027, 0, 5, 9).toISOString()), '2027-01-05');
  for (const raw of ['', 'soon', null, undefined, 20261124, {}]) assert.equal(releaseDay(raw), null, JSON.stringify(raw));
});

test('发布页：更新源是 GitHub 时是这一版的发布页；别的更新源、名字或版本号不对时没有', () => {
  const github = 'owner: konkon-lab\nrepo: FoxPanel\nprovider: github\nupdaterCacheDirName: foxpanel-updater\n';
  assert.equal(releasePage(github, '0.1.0-beta.3'), 'https://github.com/konkon-lab/FoxPanel/releases/tag/v0.1.0-beta.3');
  assert.equal(releasePage(github.replace(/\n/g, '\r\n'), '1.2.0'), 'https://github.com/konkon-lab/FoxPanel/releases/tag/v1.2.0');
  assert.equal(releasePage('owner: "a.b"\nrepo: \'c_d\'\nprovider: github\n', '1.2.0'), 'https://github.com/a.b/c_d/releases/tag/v1.2.0');
  assert.equal(releasePage('provider: generic\nurl: https://example.com/updates\n', '1.2.0'), null);
  assert.equal(releasePage('owner: konkon-lab\nprovider: github\n', '1.2.0'), null);
  assert.equal(releasePage('owner: a/../b\nrepo: FoxPanel\nprovider: github\n', '1.2.0'), null);
  assert.equal(releasePage('owner: -x\nrepo: FoxPanel\nprovider: github\n', '1.2.0'), null);
  for (const version of ['', '1.2', 'v1.2.0', '1.2.0/../x', '1.2.0?x=1', '1.2.0 beta']) assert.equal(releasePage(github, version), null, version);
  assert.equal(releasePage('', '1.2.0'), null);
});
