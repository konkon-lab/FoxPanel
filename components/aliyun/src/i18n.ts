// 本组件的 t；文案在 window.ts 里注册。
import { typedT } from '../../_shared/window/i18n.ts';
import own from './locales.ts';

export const messages = [own];
export const t = typedT(own);
