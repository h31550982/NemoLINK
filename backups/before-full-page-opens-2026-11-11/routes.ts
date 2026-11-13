import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('layouts/AuthLayout.vue'),
    children: [{ path: '', component: () => import('pages/LoginPage.vue') }],
  },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/HomePage.vue') },
      { path: 'portcalls/:callId', name: 'port-call', component: () => import('pages/HomePage.vue') },
      { path: 'portcalls/:callId/:section/:itemId?', name: 'port-call-section', component: () => import('pages/HomePage.vue') },
      {
        path: 'platform',
        component: () => import('pages/PlatformPage.vue'),
        meta: { requiresPlatform: true },
      },
      {
        path: 'admin',
        component: () => import('pages/AdminPage.vue'),
        meta: { requiresAdmin: true },
        children: [
          { path: '', redirect: '/admin/users' },
          { path: 'users', component: () => import('pages/admin/UsersTab.vue') },
          { path: 'ships', component: () => import('pages/admin/ShipsTab.vue') },
          { path: 'locations', component: () => import('pages/admin/LocationsTab.vue') },
          { path: 'codelists', component: () => import('pages/admin/CodelistsTab.vue') },
          { path: 'hsmap', component: () => import('pages/admin/HsMapTab.vue') },
          { path: 'hazmat', component: () => import('pages/admin/HazmatTab.vue') },
          { path: 'audit', component: () => import('pages/admin/AuditTab.vue') },
          { path: 'sync', component: () => import('pages/admin/SyncTab.vue') },
          { path: 'org', component: () => import('pages/admin/OrgTab.vue') },
        ],
      },
      { path: 'users', redirect: '/admin/users' },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
