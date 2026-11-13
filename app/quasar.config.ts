import { defineConfig } from '#q-app/wrappers';

export default defineConfig(() => ({
  boot: ['clearable-fields'],

  css: ['app.scss'],

  // Inter comes bundled via @fontsource (spec 0031) — no roboto extra.
  // Icons are Material Symbols (outlined); App.vue maps plain names to them.
  extras: ['material-symbols-outlined'],

  build: {
    target: {
      browser: ['es2022', 'firefox115', 'chrome115', 'safari15'],
      node: 'node22',
    },
    typescript: {
      strict: true,
      vueShim: false,
    },
    vueRouterMode: 'history',
  },

  devServer: {
    port: 9000,
    open: false,
    // Local dev: the NestJS server runs on :3000 (npm run dev in server/)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  framework: {
    config: {},
    // Quasar's own icons (select arrows, clear, calendar paging…) too
    iconSet: 'material-symbols-outlined',
    plugins: ['Notify'],
  },

  animations: [],
}));
