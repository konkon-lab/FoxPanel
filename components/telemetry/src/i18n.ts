// 本组件的 t(只收本组件文案的键)；文案在 window.ts 里注册。
import { typedT } from '../../_shared/window/i18n.ts';
import own from './locales.ts';

export const messages = [own];
export const t = typedT(own);
