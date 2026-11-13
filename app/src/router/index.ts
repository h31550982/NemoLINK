import { defineRouter } from '#q-app/wrappers';
import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';
import { useAuth } from '../auth/auth';
import routes from './routes';

export default defineRouter(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory;

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  });

  // Session guard (docs/specs/0013). UX only — the API enforces authz on
  // every route via AuthzGuard regardless of what the SPA renders.
  Router.beforeEach(async (to) => {
    const auth = useAuth();
    if (!auth.loaded.value) await auth.fetchMe();

    if (to.path === '/login') {
      return auth.user.value ? { path: '/' } : true;
    }
    if (!auth.user.value) {
      // Carry the OIDC redirect flag (?login=pending|failed) to the login
      // page so its toast still fires (spec 0012 contract).
      const flag = to.query['login'];
      return {
        path: '/login',
        query: typeof flag === 'string' ? { login: flag } : {},
      };
    }
    if (to.meta['requiresPlatform'] && !auth.user.value.platformAdmin) {
      return { path: '/' };
    }
    // An unswitched platform admin has no org context (spec 0030): the API
    // 403s every org-scoped route, so land them on Select customer instead.
    if (
      auth.user.value.platformAdmin &&
      !auth.user.value.acting &&
      to.path !== '/platform'
    ) {
      return { path: '/platform' };
    }
    if (to.meta['requiresAdmin'] && auth.user.value.role !== 'admin') {
      return { path: '/' };
    }
    return true;
  });

  return Router;
});
