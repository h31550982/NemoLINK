<template>
  <!-- The in-place ship editor (spec 0085): the ship dialog of the Ships page,
       opened over whatever page asked for it -->
  <ShipsTab
    v-if="shipEditorState.shipId && auth.isAdmin.value"
    :key="shipEditorState.shipId"
    dialog-only
    :ship-id="shipEditorState.shipId"
    @closed="closeShipEditor"
  />
</template>

<script setup lang="ts">
import { useAuth } from '../auth/auth';
import { closeShipEditor, shipEditorState } from '../lib/ship-editor';
import ShipsTab from '../pages/admin/ShipsTab.vue';

const auth = useAuth();
</script>
