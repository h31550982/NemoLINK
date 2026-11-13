import { createApp } from 'vue';
import { Quasar } from 'quasar';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import 'quasar/src/css/index.sass';
import '../src/css/app.scss';

import Harness from './RemovalDialogHarness.vue';

createApp(Harness).use(Quasar, {}).mount('#app');
