// 只在这次运行加载的组件文件夹(组件管理的 extra)。

export const PANELS_ENV = 'FOXPANEL_PANELS';   // 值是 1 时加载开发用的显示方

// 未打包的程序带 FOXPANEL_PANELS=1 启动时是开发用的显示方那个文件夹；打包后的程序里没有它，不看这个变量
export function devComponents(env: Readonly<Record<string, string | undefined>>, packaged: boolean, display: string): string[] {
  return !packaged && env[PANELS_ENV] === '1' ? [display] : [];
}
