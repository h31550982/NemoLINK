import type { InjectionKey, Ref } from 'vue';

/** Report shells provide a header location for their attachment control. */
export const reportAttachmentTriggerKey: InjectionKey<Ref<HTMLElement | null>> = Symbol('report-attachment-trigger');

/** The requested report space, shared with the report's footer. */
export const reportAttachmentVisibleKey: InjectionKey<Ref<boolean>> = Symbol('report-attachment-visible');

/** Tables preserve their column groups throughout the drawer's movement. */
export const reportAttachmentMovingKey: InjectionKey<Ref<boolean>> = Symbol('report-attachment-moving');
