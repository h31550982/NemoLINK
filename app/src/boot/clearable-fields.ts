/**
 * Every editable field has an × on its right that empties it, shown while
 * the pointer is over the field or the field has the focus (user
 * 2026-11-13). Quasar's own clear button, switched on for every q-input and
 * q-select; read-only and disabled fields never show it (Quasar's rule).
 * The hover itself is in css/app.scss ("Clearable fields").
 *
 * Quasar empties a field to null. A text field bound to a string gets ''
 * instead, so code that reads the value as text (trim, length) keeps working.
 * A page that must not offer the × passes :clearable="false".
 */
import { getCurrentInstance, type Component, type SetupContext } from 'vue';
import { QInput, QSelect } from 'quasar';

type Setup = (props: Record<string, unknown>, ctx: SetupContext) => unknown;
type Patchable = Component & { props: Record<string, unknown>; setup: Setup };

function clearableByDefault(component: Component): void {
  const c = component as Patchable;
  c.props.clearable = { type: Boolean, default: true };
  const setup = c.setup;
  c.setup = function (props: Record<string, unknown>, ctx: SetupContext) {
    const vm = getCurrentInstance();
    if (vm) {
      const emit = vm.emit;
      // Quasar reads the instance's emit inside setup, so this is the one it uses
      vm.emit = (event: string, ...args: unknown[]) =>
        emit(event, ...(event === 'update:modelValue' && args[0] === null && typeof props.modelValue === 'string' ? [''] : args));
    }
    return setup(props, ctx);
  };
}

export default () => {
  clearableByDefault(QInput);
  clearableByDefault(QSelect);
};
