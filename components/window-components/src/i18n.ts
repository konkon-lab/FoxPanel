// 本组件的 t(共用文案 + 本组件的文案)；文案在 page.ts 里注册。
import { typedT } from '../../_shared/window/i18n.ts';
import shared from '../../_shared/window/locales.ts';
import own from './locales.ts';

export const messages = [shared, own];
export const t = typedT(shared, own);
