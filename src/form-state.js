// Capture FormData before calling this: disabled controls are omitted from it.
// Restore the original disabled state, including unavailable business actions.
export function lockForm(form) {
  const controls = [...form.querySelectorAll('button, input, select, textarea')];
  const previous = controls.map(control => control.disabled);
  const busy = form.getAttribute('aria-busy');
  form.setAttribute('aria-busy', 'true');
  controls.forEach(control => { control.disabled = true; });
  return () => {
    controls.forEach((control, index) => { control.disabled = previous[index]; });
    if (busy === null) form.removeAttribute('aria-busy');
    else form.setAttribute('aria-busy', busy);
  };
}
