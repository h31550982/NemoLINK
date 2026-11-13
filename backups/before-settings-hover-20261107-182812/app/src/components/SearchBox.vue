<template>
  <q-input
    :model-value="modelValue"
    dense
    outlined
    clearable
    :autofocus="autofocus"
    :placeholder="placeholder"
    class="search-box"
    :class="{ 'search-box--large': large }"
    :aria-label="placeholder"
    @update:model-value="emit('update:modelValue', String($event ?? ''))"
  >
    <template #prepend>
      <img :src="large ? searchInkUrl : searchUrl" alt="" width="24" height="24" class="search-box__icon" />
    </template>
  </q-input>
</template>

<script setup lang="ts">
/**
 * House-standard free-text filter (spec 0019), drawn as the style guide's
 * search field (p. 8): 36px, #F3F4F8 fill, 1px #D5D6DD outline, radius 6.
 * On a table page it takes focus on landing. Parent owns the filtering
 * (client- or server-side); this is only the input.
 * `large`: the front page's search (Figma 341:5742) — 44px, Blue/350 fill,
 * no outline, radius 10, 16px Medium text in Text/300.
 */
import searchUrl from '../assets/figma/search.svg';
import searchInkUrl from '../assets/figma/search-ink.svg';

withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; autofocus?: boolean; large?: boolean }>(),
  { placeholder: 'Search', autofocus: true, large: false },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
</script>

<style scoped>
.search-box {
  width: 100%;
  max-width: 260px;
  /* It may sit inside an uppercase title row — its text stays as typed */
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.search-box :deep(.q-field__control),
.search-box :deep(.q-field__marginal) {
  height: 36px;
  min-height: 36px;
}
.search-box :deep(.q-field__control) {
  border-radius: 6px;
  background: var(--nl-g-base);
  padding: 0 10px 0 5px;
}
.search-box :deep(.q-field__prepend) {
  padding-right: 4px;
}
.search-box__icon {
  display: block;
}
.search-box :deep(.q-field__control::before) {
  border: 1px solid var(--nl-g-line-white);
}
.search-box :deep(.q-field__native) {
  font-size: 14px;
  color: var(--nl-g-ink);
}
.search-box :deep(.q-field__native::placeholder) {
  color: var(--nl-g-secondary);
  opacity: 1;
}
.search-box--large {
  max-width: none;
}
.search-box--large :deep(.q-field__control),
.search-box--large :deep(.q-field__marginal) {
  height: 44px;
  min-height: 44px;
}
.search-box--large :deep(.q-field__control) {
  border-radius: 10px;
  background: var(--blue-350);
  padding: 0 10px 0 6px;
}
.search-box--large :deep(.q-field__prepend) {
  width: 34px;
  justify-content: center;
  padding-right: 0;
  margin-right: 4px;
}
.search-box--large :deep(.q-field__control::before),
.search-box--large :deep(.q-field__control:hover::before) {
  border: none;
}
.search-box--large :deep(.q-field__native) {
  font-size: 16px;
  font-weight: 500;
}
.search-box--large :deep(.q-field__native::placeholder) {
  color: var(--nl-g-ink);
}
/* On a phone search takes the whole width — it wraps to its own line and
   deserves all of it (docs/07 law 6, user rule 2026-08-24) */
@media (max-width: 700px) {
  .search-box {
    max-width: none;
  }
}
/* Phones: 16px is for SemiBold headings only (user 2026-11-06) */
@media (max-width: 599px) {
  .search-box--large :deep(.q-field__native) {
    font-size: 14px;
    letter-spacing: 0.14px;
  }
}
</style>
