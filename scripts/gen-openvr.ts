// 从 vendor/openvr/openvr_capi.h 生成 components/steamvr/src/fntables.ts：各接口函数表(FnTable)里的方法名顺序和接口版本。
// 函数表即按声明顺序排列的函数指针，第 i 个方法位于偏移 i × 8 字节处。
// 用法：node scripts/gen-openvr.ts

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const header = fs.readFileSync(path.join(root, 'vendor/openvr/openvr_capi.h'), 'utf8');
const INTERFACES = ['IVRSystem', 'IVROverlay', 'IVRInput', 'IVRApplications', 'IVRRenderModels'];

const out: string[] = [
  '// 由 scripts/gen-openvr.ts 从 openvr_capi.h 生成，请勿手动修改。',
  '',
];
for (const name of INTERFACES) {
  const version = new RegExp(`static const char \\* ${name}_Version = "(\\w+)";`).exec(header)?.[1];
  const body = new RegExp(`struct VR_${name}_FnTable\\s*\\{([\\s\\S]*?)\\};`).exec(header)?.[1];
  if (!version || !body) throw new Error(`头文件中未找到 ${name}`);
  const methods = [...body.matchAll(/\(OPENVR_FNTABLE_CALLTYPE \*(\w+)\)/g)].map(m => m[1]);
  out.push(`export const ${name}_VERSION = '${version}';`);
  out.push(`export const ${name}_METHODS = [`);
  for (let i = 0; i < methods.length; i += 4) out.push(`  ${methods.slice(i, i + 4).map(m => `'${m}'`).join(', ')},`);
  out.push('] as const;', '');
}
fs.writeFileSync(path.join(root, 'components/steamvr/src/fntables.ts'), out.join('\n'));
console.log('已生成 components/steamvr/src/fntables.ts');
