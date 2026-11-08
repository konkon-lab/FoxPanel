// 输入框：文字、输入串、光标和选区；清空、复制、听写、发送。

import { slotPlugin } from '../../_shared/vue.ts';
import TextField from './TextField.vue';

export default slotPlugin('yanuo.textfield', TextField, ['kb', 'i18n']);
