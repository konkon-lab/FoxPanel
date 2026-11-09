// 从 Windows SDK 头文件生成 components/steamvr/src/d3d-vtables.ts：用到的 COM 接口方法在虚表里的顺序。
// 用法：node scripts/gen-d3d.ts [SDK Include 版本目录]

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const kits = 'C:/Program Files (x86)/Windows Kits/10/Include';
// 不指定时用装着的最新版本
const sdk = process.argv[2] ?? path.join(kits, fs.readdirSync(kits).filter(d => /^10\./.test(d)).sort().at(-1) ?? '');
// 接口名和声明它的头文件
const INTERFACES: [string, string][] = [
  ['ID3D11Device1', 'um/d3d11_1.h'],
  ['ID3D11DeviceContext', 'um/d3d11.h'],
  ['IDXGIFactory4', 'shared/dxgi1_4.h'],
];

const out = ['// 由 scripts/gen-d3d.ts 从 Windows SDK 头文件生成，请勿手动修改。', ''];
for (const [name, file] of INTERFACES) {
  const text = fs.readFileSync(path.join(sdk, file), 'utf8');
  const body = new RegExp(`typedef struct ${name}Vtbl\\s*\\{([\\s\\S]*?)\\}\\s*${name}Vtbl;`).exec(text)?.[1];
  if (!body) throw new Error(`${file} 中未找到 ${name}Vtbl`);
  const methods = [...body.matchAll(/\(\s*STDMETHODCALLTYPE\s*\*(\w+)\s*\)/g)].map(m => m[1]);
  out.push(`export const ${name}_METHODS = [`);
  for (let i = 0; i < methods.length; i += 4) out.push(`  ${methods.slice(i, i + 4).map(m => `'${m}'`).join(', ')},`);
  out.push('] as const;', '');
}
fs.writeFileSync(path.join(root, 'components/steamvr/src/d3d-vtables.ts'), out.join('\n'));
console.log(`已从 ${sdk} 生成 components/steamvr/src/d3d-vtables.ts`);
