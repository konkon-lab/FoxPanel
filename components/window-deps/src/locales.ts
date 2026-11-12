// 本组件的界面文案。
import { defineMessages } from '@konkon-lab/foxpanel-window';

export default defineMessages({
  'deps.title': '依赖图',
  'deps.aria': '组件依赖图',
  'deps.tipComponent': '组件：{name}',
  'deps.tipProvides': '提供服务：{name}',
  'deps.tipService': '服务：{from} → {to}',
  'deps.tipCall': '调用：{from} → {to}',
}, {
  'zh-Hant': {
    'deps.title': '相依性圖',
    'deps.aria': '元件相依性圖',
    'deps.tipComponent': '元件：{name}',
    'deps.tipProvides': '提供服務：{name}',
    'deps.tipService': '服務：{from} → {to}',
    'deps.tipCall': '呼叫：{from} → {to}',
  },
  ja: {
    'deps.title': '依存グラフ',
    'deps.aria': 'コンポーネントの依存グラフ',
    'deps.tipComponent': 'コンポーネント：{name}',
    'deps.tipProvides': '提供サービス：{name}',
    'deps.tipService': 'サービス：{from} → {to}',
    'deps.tipCall': '呼び出し：{from} → {to}',
  },
  en: {
    'deps.title': 'Dependency graph',
    'deps.aria': 'Component dependency graph',
    'deps.tipComponent': 'Component: {name}',
    'deps.tipProvides': 'Provides: {name}',
    'deps.tipService': 'Service: {from} → {to}',
    'deps.tipCall': 'Call: {from} → {to}',
  },
  ko: {
    'deps.title': '의존성 그래프',
    'deps.aria': '컴포넌트 의존성 그래프',
    'deps.tipComponent': '컴포넌트: {name}',
    'deps.tipProvides': '제공 서비스: {name}',
    'deps.tipService': '서비스: {from} → {to}',
    'deps.tipCall': '호출: {from} → {to}',
  },
});
