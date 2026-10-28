// 检查提交信息：
// 第 1 行「feat/fix/ui：标题」，标题不超过 TITLE_MAX 个字；第 2 行空行；之后每行以 - 开头。

import fs from 'node:fs';

const TITLE_MAX = 20;
const file = process.argv[2];
if (!file) process.exit(0);

const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n').filter(l => !l.startsWith('#'));
while (lines.length && lines[lines.length - 1]?.trim() === '') lines.pop();

const errors: string[] = [];
const head = /^(feat|fix|ui)：(.+)$/.exec(lines[0] ?? '');
if (!head) errors.push('第 1 行要写成「feat/fix/ui：简短标题」(全角冒号)');
else if ([...(head[2] ?? '').trim()].length > TITLE_MAX) errors.push(`标题超过 ${TITLE_MAX} 个字，细节放到下面的 - 描述里`);
if (lines.length > 1 && lines[1]?.trim() !== '') errors.push('第 2 行要空行(标题和描述之间)');
for (const l of lines.slice(2)) {
  if (l.trim() !== '' && !l.startsWith('-')) errors.push(`描述行要以 - 开头：${l}`);
}

if (errors.length) {
  for (const e of errors) console.error(`commit-msg: ${e}`);
  process.exit(1);
}
