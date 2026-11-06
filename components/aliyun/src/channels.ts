// 阿里云组件用的总线频道(用量账本)
export const BOOK = 'yanuo.aliyun/usage-book';       // 主进程 → 主窗口：整本账
export const GET = 'yanuo.aliyun/usage-get';         // 主窗口 → 主进程：要一份账本
export const REMOVED = 'core/component-removed';     // 核心 → 各组件：一个组件卸载完了，数据是它的 id
