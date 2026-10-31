import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_KINDS, defaultConfig, isInnerPath, isVisible, parseManifest, parsePanel, PART_KINDS, SINGLE_KINDS, textOf } from '../src/shared/manifest.ts';

const base = { id: 'yanuo.side-numpad', kind: 'sidepage', name: { 'zh-Hans': '小键盘', en: 'Numpad' }, version: '1.0.0', author: 'yanuo', license: 'MIT', page: 'page.js' };

test('合格的清单：没写 config 时没有设置', () => {
  const r = parseManifest(base);
  assert.ok(r.ok);
  assert.deepEqual(r.manifest.settings, []);
  assert.deepEqual(r.manifest.sections, []);
  assert.equal(r.manifest.page, 'page.js');
});

test('缺字段、id 格式、kind 不对都报错', () => {
  const r = parseManifest({ ...base, id: 'Numpad', kind: 'widget', version: '1', license: '' });
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 4);
});

test('页面类组件缺 page，输出组件缺 main', () => {
  assert.ok(!parseManifest({ ...base, page: undefined }).ok);
  assert.ok(!parseManifest({ ...base, kind: 'output', page: undefined }).ok);
  assert.ok(parseManifest({ ...base, kind: 'output', page: undefined, main: 'main.js' }).ok);
});

test('没有 shell 这个类别；清单里写的 shell 字段不进清单', () => {
  const r = parseManifest({ ...base, kind: 'shell', shell: { width: 1400, height: 490 } });
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0] ?? '', /^kind 要是 panel \/ candidates \/ /);
  assert.ok(!COMPONENT_KINDS.some(kind => String(kind) === 'shell'));
  assert.ok(!SINGLE_KINDS.has('panel'));
  const stray = parseManifest({ ...base, shell: { width: 1400, height: 490 } });
  assert.ok(stray.ok);
  assert.ok(!('shell' in stray.manifest));
});

test('入口和图标路径不能越出组件包', () => {
  for (const p of ['../x.js', 'a/../../x.js', '/x.js', 'C:\\x.js', 'a//b.js']) assert.ok(!isInnerPath(p), p);
  for (const p of ['page.js', 'dist/page.js', 'a\\b.svg']) assert.ok(isInnerPath(p), p);
  assert.ok(!parseManifest({ ...base, page: '../evil.js' }).ok);
});

// 一节设置
const section = (dict: object, description?: string): object => ({ type: 'object', dict, ...(description ? { meta: { description } } : {}) });
const options = (...vs: string[]): object[] => vs.map(v => ({ type: 'const', value: v, meta: { description: v.toUpperCase() } }));

test('config：各类型的默认值、下拉的默认值要在选项里', () => {
  const dict = {
    on: { type: 'boolean', meta: { description: '开关', default: true } },
    voice: { type: 'union', list: options('a', 'b'), meta: { description: '音色', default: 'a' } },
    rate: { type: 'number', meta: { description: '语速', default: 1, min: 0.5, max: 2 } },
    url: { type: 'string', meta: { description: '地址', default: '' } },
    apiKey: { type: 'string', meta: { description: 'API Key', role: 'secret' } },
  };
  const r = parseManifest({ ...base, config: section(dict) });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(defaultConfig(r.manifest.settings), { on: true, voice: 'a', rate: 1, url: '' });
  assert.deepEqual(r.manifest.settings.map(d => d.type), ['toggle', 'select', 'number', 'text', 'secret']);
  assert.ok(!parseManifest({ ...base, config: section({ voice: { ...dict.voice, meta: { description: '音色', default: 'c' } } }) }).ok);
  assert.ok(!parseManifest({ ...base, config: section({ on: { type: 'boolean', meta: { default: true } } }) }).ok);
});

test('config：多节、同名键报错、按条件显示、数字列表', () => {
  const config = {
    type: 'intersect',
    list: [
      section({
        mode: { type: 'union', list: options('auto', 'fixed'), meta: { description: '方式', default: 'auto' } },
        port: { type: 'number', meta: { description: '端口', default: 9001, visible: { mode: 'fixed' } } },
      }),
      section({ ports: { type: 'array', inner: { type: 'number', meta: { min: 1, max: 65535 } }, meta: { description: '目标端口', default: [9002] } } }, '高级设置'),
    ],
  };
  const r = parseManifest({ ...base, config });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.manifest.sections, [{ keys: ['mode', 'port'] }, { title: '高级设置', keys: ['ports'] }]);
  const [, port, ports] = r.manifest.settings;
  assert.ok(port && ports);
  assert.ok(!isVisible(port, { mode: 'auto' }));
  assert.ok(isVisible(port, { mode: 'fixed' }));
  assert.deepEqual(ports, { key: 'ports', label: '目标端口', type: 'tags', item: 'number', default: [9002], min: 1, max: 65535 });
  const dup = { type: 'intersect', list: [section({ a: { type: 'boolean', meta: { description: 'a', default: true } } }), section({ a: { type: 'boolean', meta: { description: 'a', default: true } } })] };
  assert.ok(!parseManifest({ ...base, config: dup }).ok);
  assert.ok(!parseManifest({ ...base, config: section({ p: { type: 'number', meta: { description: 'p', default: 1, visible: { none: 1 } } } }) }).ok);
});

test('文案按界面语言取，缺的回退', () => {
  assert.equal(textOf({ 'zh-Hans': '小键盘', en: 'Numpad' }, 'en'), 'Numpad');
  assert.equal(textOf({ 'zh-Hans': '小键盘', en: 'Numpad' }, 'ja'), '小键盘');
  assert.equal(textOf('Numpad', 'ko'), 'Numpad');
});

test('config：下拉可自填、选项取自表格、表格、音频设备、共用 secret', () => {
  const dict = {
    voice: { type: 'union', list: options('a'), meta: { description: '音色', default: 'my-own', custom: true, optionsFrom: { setting: 'voices', value: 'id', label: 'name' } } },
    voices: { type: 'array', inner: { type: 'object', dict: { name: { type: 'string', meta: { description: '名字' } }, id: { type: 'string', meta: { description: 'ID' } } } }, meta: { description: '自定义', default: [{ name: 'x', id: 'y' }] } },
    out: { type: 'string', meta: { description: '播放到', role: 'audioOutput' } },
    mic: { type: 'string', meta: { description: '麦克风', role: 'audioInput' } },
    apiKey: { type: 'string', meta: { description: 'Key', role: 'secret', share: 'aliyun-bailian' } },
  };
  const r = parseManifest({ ...base, kind: 'output', page: undefined, main: 'main.js', config: section(dict) });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(defaultConfig(r.manifest.settings), { voice: 'my-own', voices: [{ name: 'x', id: 'y' }], out: '', mic: '' });
  const bad = (field: object): void => assert.ok(!parseManifest({ ...base, config: section({ ...dict, f: field }) }).ok, JSON.stringify(field));
  bad({ ...dict.voice, meta: { description: '音色', default: 'my-own' } });
  bad({ ...dict.voice, meta: { description: '音色', default: 'a', optionsFrom: { setting: 'x' } } });
  bad({ type: 'array', inner: { type: 'object', dict: {} }, meta: { description: 't' } });
  bad({ ...dict.voices, meta: { description: 't', default: [{ name: 1 }] } });
  bad({ type: 'string', meta: { description: 'k', role: 'secret', share: 'Bad Name' } });
});

test('config：optionsFrom 的 sub(选项旁的小字取自表格的哪一列)可以不写，写了要是标识符', () => {
  const rows = { type: 'array', inner: { type: 'object', dict: { name: { type: 'string', meta: { description: '名字' } }, id: { type: 'string', meta: { description: 'ID' } }, model: { type: 'string', meta: { description: '模型' } } } }, meta: { description: '自定义' } };
  const parse = (optionsFrom: object): ReturnType<typeof parseManifest> => parseManifest({
    ...base,
    config: section({ voice: { type: 'union', list: options('a'), meta: { description: '音色', default: 'a', optionsFrom } }, rows }),
  });
  const from = (r: ReturnType<typeof parseManifest>): unknown => {
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    const voice = r.manifest.settings[0];
    return voice?.type === 'select' ? voice.optionsFrom : undefined;
  };
  assert.deepEqual(from(parse({ setting: 'rows', value: 'id', label: 'name' })), { setting: 'rows', value: 'id', label: 'name' });
  assert.deepEqual(from(parse({ setting: 'rows', value: 'id', label: 'name', sub: 'model' })), { setting: 'rows', value: 'id', label: 'name', sub: 'model' });
  for (const sub of [1, '', 'two words', null]) {
    const r = parse({ setting: 'rows', value: 'id', label: 'name', sub });
    assert.ok(!r.ok, JSON.stringify(sub));
    assert.deepEqual(r.errors, ['config.dict.voice.meta.optionsFrom 要是 { setting, value, label, sub? }']);
  }
  // 指向的设置要是表格
  assert.ok(!parse({ setting: 'voice', value: 'id', label: 'name' }).ok);
});

test('config：报错写明位置，一个设置项只报第一处', () => {
  const errorsOf = (dict: object): string[] => {
    const r = parseManifest({ ...base, config: section(dict) });
    return r.ok ? [] : r.errors;
  };
  assert.deepEqual(errorsOf({ '1a': { type: 'boolean' } }), ['config.dict.1a 的键要是字母开头的标识符']);
  assert.deepEqual(errorsOf({ a: { type: 'color', meta: { description: 'a' } } }), ['config.dict.a.type 要是 boolean / number / string / union / array']);
  assert.deepEqual(errorsOf({ a: { type: 'number', meta: { description: 'a', default: 1, max: '9' } } }), ['config.dict.a.meta.max 要是数字']);
  assert.deepEqual(errorsOf({ a: { type: 'string', meta: { description: 'a', role: 'password' } } }), ['config.dict.a.meta.role 要是 secret / audioOutput / audioInput / directory']);
  assert.deepEqual(errorsOf({ a: { type: 'string', meta: { description: 'a', role: 'directory' } } }), ['config.dict.a.meta.default 要是字符串']);
  assert.deepEqual(errorsOf({ a: { type: 'union', list: [{ type: 'const', value: 1 }], meta: { description: 'a', default: 'x' } } }), ['config.dict.a.list 每项要是 { type: "const", value: 字符串 }']);
  assert.deepEqual(errorsOf({ a: { type: 'array', meta: { description: 'a' } } }), ['config.dict.a.inner 缺少']);
  assert.deepEqual(errorsOf({ a: { type: 'array', inner: { type: 'number', meta: { min: 'x' } }, meta: { description: 'a' } } }), ['config.dict.a.inner.meta.min 要是数字']);
  assert.deepEqual(errorsOf({ a: { type: 'array', inner: { type: 'string' }, meta: { description: 'a', default: [1] } } }), ['config.dict.a.meta.default 每项要是 string']);
  // 说明和显示条件格式不对时接着查后面的
  assert.deepEqual(
    errorsOf({ a: { type: 'boolean', meta: { description: 'a', hint: 1, visible: { a: [] } } } }),
    ['config.dict.a.meta.hint 格式不对', 'config.dict.a.meta.visible 要是 { 设置键: 值或值的数组 }', 'config.dict.a.meta.default 要是布尔值'],
  );
});

test('清单：几处不合格时按字段顺序全部报出', () => {
  const r = parseManifest({ id: 'a.b', kind: 'sidepage', name: 'n', version: '1.0.0', author: 'a', license: 'MIT', page: '../p.js', provides: 'x', usage: { currency: 'cny' }, process: 'own', dashboard: [] });
  assert.ok(!r.ok);
  assert.deepEqual(r.errors, [
    'provides 要是服务名数组(小写字母、数字和 -)',
    'usage 要是 { currency: 三个大写字母, units: { 用量名: 文案 } }',
    'process 要和 main 入口一起用',
    'page 要是组件包内的相对路径',
    'dashboard 要是 { title, keys: [config 里的键], area?: left / right, order?, toggle?, link?, grow? }',
  ]);
});

test('config：分段按钮(union role radio)和滑块(number role slider，要有 min / max)', () => {
  const dict = {
    theme: { type: 'union', list: options('light', 'dark'), meta: { description: '主题', default: 'light', role: 'radio' } },
    zoom: { type: 'number', meta: { description: '缩放', default: 1, min: 0.5, max: 1.5, step: 0.05, role: 'slider' } },
  };
  const r = parseManifest({ ...base, config: section(dict) });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  const [theme, zoom] = r.manifest.settings;
  assert.ok(theme?.type === 'select' && theme.radio === true);
  assert.ok(zoom?.type === 'number' && zoom.slider === true);
  const bad = (field: object): void => assert.ok(!parseManifest({ ...base, config: section({ f: field }) }).ok, JSON.stringify(field));
  bad({ type: 'number', meta: { description: 'z', default: 1, role: 'slider' } });
  bad({ type: 'number', meta: { description: 'z', default: 1, role: 'knob' } });
  bad({ ...dict.theme, meta: { ...dict.theme.meta, role: 'tabs' } });
});

test('翻译类别：要有 main', () => {
  assert.ok(!parseManifest({ ...base, kind: 'translator', page: undefined }).ok);
  assert.ok(parseManifest({ ...base, kind: 'translator', page: undefined, main: 'main.js' }).ok);
});

test('仪表盘卡片：keys 要是 config 里的键；area 默认 left，order 默认 0', () => {
  const cfg = { type: 'object', dict: { target: { type: 'string', meta: { description: '目标', default: 'ja' } } } };
  const ok = parseManifest({ ...base, config: cfg, dashboard: { title: '翻译', keys: ['target'], toggle: '朗读前翻译' } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.manifest.dashboard, { title: '翻译', keys: ['target'], area: 'left', order: 0, link: false, grow: false, toggle: '朗读前翻译' });
  assert.ok(!parseManifest({ ...base, config: cfg, dashboard: { title: '翻译', keys: ['nope'] } }).ok);
  assert.ok(!parseManifest({ ...base, config: cfg, dashboard: { title: '翻译', keys: ['target'], area: 'top' } }).ok);
});

test('存储库、问题反馈、设置项说明', () => {
  const config = section({ a: { type: 'boolean', meta: { description: 'a', hint: '说明', default: true } } });
  const r = parseManifest({ ...base, repository: 'https://example.com/r', bugs: 'http://example.com/b', config });
  assert.ok(r.ok);
  assert.equal(r.manifest.repository, 'https://example.com/r');
  assert.equal(r.manifest.settings[0]?.description, '说明');
  const bad = parseManifest({ ...base, repository: 'file:///c:/x', bugs: 'nope' });
  assert.ok(!bad.ok);
  assert.equal(bad.errors.length, 2);
});

test('服务组件：要声明 provides，别的类别不能声明；requires 是服务名数组；window 入口给 window 以外的类别', () => {
  const svc = { id: 'yanuo.cloud', kind: 'service', name: 'c', version: '1.0.0', author: 'y', license: 'MIT' };
  assert.ok(!parseManifest(svc).ok);
  const ok = parseManifest({ ...svc, provides: ['cloud', 'cloud'] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.manifest.provides, ['cloud']);
  assert.ok(!parseManifest({ ...base, provides: ['x'] }).ok);
  assert.ok(!parseManifest({ ...base, requires: ['Bad Name'] }).ok);
  // 主窗口入口：window 组件写在 page，其他类别都能写 window
  const both = parseManifest({ ...svc, provides: ['cloud'], page: 'page.js', window: 'window.js' });
  assert.ok(both.ok && both.manifest.page === 'page.js' && both.manifest.window === 'window.js');
  const out = parseManifest({ ...base, window: 'window.js' });
  assert.ok(out.ok && out.manifest.window === 'window.js');
  assert.ok(!parseManifest({ id: 'yanuo.window-x', kind: 'window', name: 'x', version: '1.0.0', author: 'y', license: 'MIT', page: 'page.js', window: 'w.js' }).ok);
  assert.ok(!parseManifest({ ...svc, provides: ['cloud'], window: '../x.js' }).ok);
  // 独立进程：要和 main 一起用，只能写 own
  const own = parseManifest({ ...svc, provides: ['cloud'], main: 'main.js', process: 'own' });
  assert.ok(own.ok && own.manifest.process === 'own');
  assert.ok(!parseManifest({ ...svc, provides: ['cloud'], process: 'own' }).ok);
  assert.ok(!parseManifest({ ...svc, provides: ['cloud'], main: 'main.js', process: 'shared' }).ok);
  const r = parseManifest({ ...base, requires: ['cloud'] });
  assert.ok(r.ok);
  assert.deepEqual(r.manifest.requires, ['cloud']);
});

test('uses：会用的远程服务名数组，哪个类别都能写；重复的只留一个，空数组等于没写；和 requires 各记各的', () => {
  const r = parseManifest({ ...base, uses: ['keyboard', 'panels', 'keyboard'] });
  assert.ok(r.ok);
  assert.deepEqual([r.manifest.uses, r.manifest.requires], [['keyboard', 'panels'], undefined]);
  const both = parseManifest({ ...base, kind: 'input', page: undefined, main: 'main.js', requires: ['usage'], uses: ['keyboard', 'usage'] });
  assert.ok(both.ok);
  assert.deepEqual([both.manifest.requires, both.manifest.uses], [['usage'], ['keyboard', 'usage']]);
  const none = parseManifest({ ...base, uses: [] });
  assert.ok(none.ok && !('uses' in none.manifest));
  assert.ok(!('uses' in (parseManifest(base) as { manifest: object }).manifest));
  for (const bad of ['keyboard', ['Bad Name'], [5], { keyboard: true }, [''], null]) {
    const x = parseManifest({ ...base, uses: bad });
    assert.deepEqual(x.ok ? [] : x.errors, ['uses 要是服务名数组(小写字母、数字和 -)'], JSON.stringify(bad));
  }
});

test('主窗口页面组件：要有 page 入口', () => {
  const win = { id: 'yanuo.window-x', kind: 'window', name: 'x', version: '1.0.0', author: 'y', license: 'MIT' };
  assert.ok(!parseManifest(win).ok);
  assert.ok(parseManifest({ ...win, page: 'page.js' }).ok);
});

// ---- panel 字段 ----

const panelBase = { id: 'me.clock', kind: 'panel', name: { 'zh-Hans': '时钟', en: 'Clock' }, version: '1.0.0', author: 'me', license: 'MIT' };
const panelMin = { page: 'panel.js', width: 480, height: 200 };

// 只换 panel 字段的清单的错误(合格时为空)
function panelErrors(panel: unknown, more: Record<string, unknown> = {}): string[] {
  const r = parseManifest({ ...panelBase, panel, ...more });
  return r.ok ? [] : r.errors;
}

test('panel：三项必填，其余用默认值；panel 组件的入口只写在 panel.page', () => {
  const r = parseManifest({ ...panelBase, panel: panelMin });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.manifest.panel, {
    page: 'panel.js', width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
    anchor: 'world', spawn: 'front', glance: false, keep: false, sound: false, slots: [],
  });
  assert.equal(r.manifest.page, undefined);
  assert.deepEqual(panelErrors(undefined), ['panel 组件要有 panel 字段']);
  assert.deepEqual(panelErrors(panelMin, { page: 'page.js' }), ['panel 组件的入口写在 panel.page，不写 page']);
  assert.deepEqual(panelErrors(undefined, { page: 'page.js' }), ['panel 组件的入口写在 panel.page，不写 page', 'panel 组件要有 panel 字段']);
  for (const bad of [null, 5, 'panel.js', [panelMin]]) assert.deepEqual(panelErrors(bad), ['panel 要是对象'], JSON.stringify(bad));
});

test('panel：写全的清单原样读出来，不认识的键不带出来；插槽名重复的只留一个；附着在手上时 glance 默认开', () => {
  const full = {
    page: 'dist/panel.js', width: 1400, height: 490, scale: 2, fps: 60, meters: 0.8, minMeters: 0.4, maxMeters: 1.6,
    anchor: 'head', spawn: 'low', glance: true, keep: true, sound: true,
    slots: ['candidates', 'textfield', 'layout', 'sidepage', 'sidebutton', 'layout'],
  };
  const r = parseManifest({ ...panelBase, panel: { ...full, unknown: 1, open: true, listed: 'no' } });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.manifest.panel, { ...full, slots: ['candidates', 'textfield', 'layout', 'sidepage', 'sidebutton'] });
  const glance = (panel: Record<string, unknown>): boolean | undefined => {
    const m = parseManifest({ ...panelBase, panel: { ...panelMin, ...panel } });
    return m.ok ? m.manifest.panel?.glance : undefined;
  };
  assert.deepEqual([glance({ anchor: 'left' }), glance({ anchor: 'right' }), glance({ anchor: 'head' }), glance({}), glance({ anchor: 'left', glance: false })], [true, true, false, false, false]);
});

test('panel：别的类别也能声明面板，照常要自己的入口；没写 panel 的没有这个字段', () => {
  const side = parseManifest({ ...base, panel: panelMin });
  assert.ok(side.ok);
  assert.deepEqual([side.manifest.page, side.manifest.panel?.page], ['page.js', 'panel.js']);
  const service = parseManifest({ ...base, kind: 'service', provides: ['notes'], page: undefined, main: 'main.js', panel: { ...panelMin, slots: ['wrist'] } });
  assert.ok(service.ok);
  assert.deepEqual(service.manifest.panel?.slots, ['wrist']);
  // 别的类别缺自己的入口照样报错；panel 字段不合格也报
  assert.ok(!parseManifest({ ...base, page: undefined, panel: panelMin }).ok);
  assert.ok(!parseManifest({ ...base, panel: { ...panelMin, width: 10 } }).ok);
  const plain = parseManifest(base);
  assert.ok(plain.ok && !('panel' in plain.manifest));
});

test('panel：入口要是包内的相对路径；宽高要是 64–4096 的整数；纹理(宽 × 高 × scale²)不能超过 4194304 像素', () => {
  for (const page of [undefined, '', '../panel.js', '/panel.js', 'C:\\panel.js', 5]) {
    assert.deepEqual(panelErrors({ ...panelMin, page }), ['panel.page 要是组件包内的相对路径'], String(page));
  }
  const size = 'panel.width 和 panel.height 要是 64–4096 的整数';
  for (const [width, height] of [[63, 200], [480, 63], [4097, 200], [480, 4097], [480.5, 200], ['480', 200], [undefined, 200], [480, null], [0, 0], [-480, 200]]) {
    assert.deepEqual(panelErrors({ ...panelMin, width, height }), [size], `${String(width)}×${String(height)}`);
  }
  for (const [width, height] of [[64, 64], [4096, 1024], [1024, 4096], [2048, 2048]]) assert.deepEqual(panelErrors({ ...panelMin, width, height }), [], `${String(width)}×${String(height)}`);
  const texture = 'panel 的纹理(宽 × 高 × scale²)不能超过 4194304 像素';
  assert.deepEqual(panelErrors({ ...panelMin, width: 4096, height: 1025 }), [texture]);
  assert.deepEqual(panelErrors({ ...panelMin, width: 2048, height: 2048, scale: 1.5 }), [texture]);
  assert.deepEqual(panelErrors({ ...panelMin, width: 1024, height: 1024, scale: 2 }), []);
  assert.deepEqual(panelErrors({ ...panelMin, width: 1025, height: 1024, scale: 2 }), [texture]);
  // 键盘的尺寸开 2 倍在上限里
  assert.deepEqual(panelErrors({ ...panelMin, width: 1400, height: 490, scale: 2 }), []);
});

test('panel：scale 只能是 1、1.5、2；fps 要是 1–60 的整数；anchor、spawn 只认名单里的；开关要是 true / false', () => {
  for (const scale of [1, 1.5, 2]) assert.deepEqual(panelErrors({ ...panelMin, scale }), []);
  for (const scale of [0.5, 1.25, 3, '2', null, true]) assert.deepEqual(panelErrors({ ...panelMin, scale }), ['panel.scale 只能是 1、1.5、2'], String(scale));
  for (const fps of [1, 30, 60]) assert.deepEqual(panelErrors({ ...panelMin, fps }), []);
  for (const fps of [0, 61, 29.97, '30', null]) assert.deepEqual(panelErrors({ ...panelMin, fps }), ['panel.fps 要是 1–60 的整数'], String(fps));
  for (const anchor of ['world', 'head', 'left', 'right']) assert.deepEqual(panelErrors({ ...panelMin, anchor }), []);
  for (const anchor of ['hand', 'World', '', 0, null]) assert.deepEqual(panelErrors({ ...panelMin, anchor }), ['panel.anchor 只能是 world / head / left / right'], String(anchor));
  for (const spawn of ['front', 'low', 'side']) assert.deepEqual(panelErrors({ ...panelMin, spawn }), []);
  for (const spawn of ['back', 'Front', 1, null]) assert.deepEqual(panelErrors({ ...panelMin, spawn }), ['panel.spawn 只能是 front / low / side'], String(spawn));
  for (const key of ['glance', 'keep', 'sound']) {
    assert.deepEqual(panelErrors({ ...panelMin, [key]: true }), []);
    assert.deepEqual(panelErrors({ ...panelMin, [key]: false }), []);
    for (const v of ['true', 1, null, 'yes']) assert.deepEqual(panelErrors({ ...panelMin, [key]: v }), [`panel.${key} 要是 true / false`], `${key} ${String(v)}`);
  }
});

test('panel：宽度要 minMeters ≤ meters ≤ maxMeters，都在 0.05–3 米；没写范围时用 0.1–2，默认宽度在这之外时范围放到默认宽度', () => {
  const range = 'panel.minMeters ≤ panel.meters ≤ panel.maxMeters，都在 0.05–3 米';
  const meters = (panel: Record<string, unknown>): number[] | string[] => {
    const r = parseManifest({ ...panelBase, panel: { ...panelMin, ...panel } });
    return r.ok && r.manifest.panel ? [r.manifest.panel.minMeters, r.manifest.panel.meters, r.manifest.panel.maxMeters] : r.ok ? [] : r.errors;
  };
  assert.deepEqual(meters({}), [0.1, 0.5, 2]);
  assert.deepEqual(meters({ meters: 0.8, minMeters: 0.4, maxMeters: 1.6 }), [0.4, 0.8, 1.6]);
  assert.deepEqual(meters({ meters: 0.05, minMeters: 0.05, maxMeters: 3 }), [0.05, 0.05, 3]);
  assert.deepEqual(meters({ meters: 1, minMeters: 1, maxMeters: 1 }), [1, 1, 1]);
  // 没写范围：默认宽度比 0.1 小或比 2 大时范围跟到它
  assert.deepEqual(meters({ meters: 0.08 }), [0.08, 0.08, 2]);
  assert.deepEqual(meters({ meters: 2.5 }), [0.1, 2.5, 2.5]);
  assert.deepEqual(meters({ minMeters: 0.3 }), [0.3, 0.5, 2]);
  // 写了的值不合格一律报错，不替它换成合格的值
  for (const bad of [
    { meters: 0.04 }, { meters: 3.01 }, { meters: '0.5' }, { meters: null }, { minMeters: 0.01 }, { maxMeters: 4 },
    { meters: 0.3, minMeters: 0.4 }, { meters: 1.7, maxMeters: 1.6 }, { minMeters: 1, maxMeters: 0.2 }, { meters: 0.08, minMeters: 0.1 }, { meters: 2.5, maxMeters: 2 },
    { minMeters: 0.6 }, { maxMeters: 0.4 }, { meters: Number.NaN },
  ]) assert.deepEqual(meters(bad), [range], JSON.stringify(bad));
});

test('panel：slots 要是插槽名数组(小写字母、数字和 -)；几处不合格时每处报一条', () => {
  const slots = 'panel.slots 要是插槽名数组(小写字母、数字和 -)';
  for (const ok of [[], ['wrist'], ['side-page', 'slot2']]) assert.deepEqual(panelErrors({ ...panelMin, slots: ok }), []);
  for (const bad of ['layout', [5], ['Layout'], ['side page'], [''], { layout: true }, null]) assert.deepEqual(panelErrors({ ...panelMin, slots: bad }), [slots], JSON.stringify(bad));
  assert.deepEqual(panelErrors({ page: '../x.js', width: 10, height: 200, scale: 3, fps: 0, meters: 9, anchor: 'hand', spawn: 'up', keep: 'yes', slots: 'a' }), [
    'panel.page 要是组件包内的相对路径',
    'panel.width 和 panel.height 要是 64–4096 的整数',
    'panel.scale 只能是 1、1.5、2',
    'panel.fps 要是 1–60 的整数',
    'panel.minMeters ≤ panel.meters ≤ panel.maxMeters，都在 0.05–3 米',
    'panel.anchor 只能是 world / head / left / right',
    'panel.spawn 只能是 front / low / side',
    'panel.keep 要是 true / false',
    'panel.slots 要是插槽名数组(小写字母、数字和 -)',
  ]);
});

test('parsePanel：只校验 panel 字段；别的类别没写时没有面板也不报错', () => {
  const errors: string[] = [];
  assert.equal(parsePanel(undefined, 'sidepage', errors), undefined);
  assert.equal(parsePanel(undefined, undefined, errors), undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(parsePanel(panelMin, 'service', errors)?.page, 'panel.js');
  assert.equal(parsePanel(undefined, 'panel', errors), undefined);
  assert.equal(parsePanel({ ...panelMin, width: 1 }, 'panel', errors), undefined);
  assert.deepEqual(errors, ['panel 组件要有 panel 字段', 'panel.width 和 panel.height 要是 64–4096 的整数']);
});

test('类别：panel 是类别之一，可以开多个；五个部件类别挂进面板的插槽', () => {
  assert.ok(COMPONENT_KINDS.includes('panel'));
  assert.ok(!SINGLE_KINDS.has('panel'));
  assert.deepEqual([...PART_KINDS].sort(), ['candidates', 'layout', 'sidebutton', 'sidepage', 'textfield']);
});
