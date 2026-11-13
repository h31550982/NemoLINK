<template>
  <main style="padding:32px">
    <h1>Port call documents</h1><p>Uploaded files and reports remain visible behind the dialog.</p>
    <button @click="show('item')">Remove file</button>
    <button @click="show('port-call')">Remove port call</button>
    <button id="finish" @click="loading = false; open = false">Finish request</button>
    <button id="required" @click="disable = !disable">Toggle required reason</button>
    <output>{{ confirmations }}</output>
    <RemovalDialog v-model="open" :kind="kind" :loading="loading" :disable="disable"
      :title="kind === 'port-call' ? 'Are you sure you want to remove this port call?' : 'Are you sure you want to remove this file'"
      @confirm="confirm">
      If you decide to remove this {{ kind === 'port-call' ? 'port call' : 'file' }}, it will be permanently removed.
    </RemovalDialog>
  </main>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import RemovalDialog from '../src/components/RemovalDialog.vue';
const open = ref(false);
const kind = ref<'item' | 'port-call'>('item');
const loading = ref(false);
const disable = ref(false);
const confirmations = ref(0);
function show(value: 'item' | 'port-call') { kind.value = value; open.value = true; }
function confirm() { confirmations.value++; loading.value = true; }
</script>
