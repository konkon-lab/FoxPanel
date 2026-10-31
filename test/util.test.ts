import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_KINDS, isComponentId, isComponentKind } from '../src/shared/manifest.ts';
import { LOCALES } from '../src/shared/types.ts';
import { errorText, isLocale, isObject, matchLocale } from '../src/shared/util.ts';

test('收窄：对象不含数组和 null；界面语言、组件类别、组件 id 只认名单里的', () => {
  assert.ok(isObject({}));
  assert.ok(!isObject([]));
  assert.ok(!isObject(null));
  assert.ok(LOCALES.every(isLocale));
  assert.ok(!isLocale('system'));
  assert.ok(!isLocale(1));
  assert.ok(COMPONENT_KINDS.every(isComponentKind));
  assert.ok(!isComponentKind('nope'));
  assert.ok(isComponentId('yanuo.window-logs'));
  assert.ok(!isComponentId('yanuo'));
  assert.ok(!isComponentId('Yanuo.x'));
  assert.ok(!isComponentId(null));
});

test('错误转文字：Error 取 message，别的转字符串', () => {
  assert.equal(errorText(new Error('读不了')), '读不了');
  assert.equal(errorText('x'), 'x');
  assert.equal(errorText(undefined), 'undefined');
});

test('系统语言 → 界面语言：繁体地区用繁体，其他中文用简体，不支持的用英语', () => {
  assert.equal(matchLocale('zh-CN'), 'zh-Hans');
  assert.equal(matchLocale('zh'), 'zh-Hans');
  assert.equal(matchLocale('zh-TW'), 'zh-Hant');
  assert.equal(matchLocale('zh-Hant-HK'), 'zh-Hant');
  assert.equal(matchLocale('ja-JP'), 'ja');
  assert.equal(matchLocale('ko'), 'ko');
  assert.equal(matchLocale('en-US'), 'en');
  assert.equal(matchLocale('fr'), 'en');
});
