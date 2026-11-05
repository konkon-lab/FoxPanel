// 普通 TypeScript(ESLint 使用)无法读取 .vue 文件，此处声明为组件；vue-tsc 会用组件的真实类型
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
