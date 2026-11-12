// 关闭询问是否打开；宿主问一次就打开(只接一次，组件重新加载也不重复接)
import { ref } from 'vue';
import { fox } from '@konkon-lab/foxpanel-window';

export const asking = ref(false);

fox.onCloseAsk(() => { asking.value = true; });
