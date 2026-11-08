// 侧栏按钮：粘贴剪贴板。

import { slotPlugin } from '../../_shared/vue.ts';
import Paste from './Paste.vue';

export default slotPlugin('yanuo.button-paste', Paste, ['kb', 'i18n']);
