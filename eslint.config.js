// ESLint 扁平配置：只开能抓真 bug 的规则，风格交给 review，类型交给 tsc。

import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

const correctnessRules = {
  'no-async-promise-executor': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-fallthrough': 'error',
  'no-new-func': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-optional-chaining': 'error',
  'use-isnan': 'error',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  // .vue 模板规则：只开能抓错的 essential 级别
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...correctnessRules,
      'vue/multi-word-component-names': 'off',
      // 相对导入写完整的扩展名(Node 直接跑 .ts 时不会补)
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^\\.{1,2}/.*(?<!\\.(ts|vue|css|json|svg))$', message: '相对导入要写完整的扩展名(.ts / .vue)' }],
      }],
      // promise 必须 await、.catch() 或用 void 标明不关心结果
      // node:test 的 test() 由测试运行器等待，不算浮空
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [{ from: 'package', name: 'test', package: 'node:test' }],
      }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
