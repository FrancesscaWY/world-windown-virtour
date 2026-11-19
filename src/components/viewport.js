/** Keep the whole application inside the visible viewport, including an on-screen keyboard. */
export function mountViewport(root, scope = globalThis) {
  const visual = scope.visualViewport;
  let frame = null;
  let disposed = false;
  let layoutHeight = scope.innerHeight || 720;
  const update = () => {
    frame = null;
    if (disposed) return;
    const zooming = visual?.scale && Math.abs(visual.scale - 1) > .05;
    const height = zooming ? scope.innerHeight || layoutHeight : visual?.height || scope.innerHeight || 720;
    const top = zooming ? 0 : visual?.offsetTop || 0;
    const input = scope.document?.activeElement;
    const editing = input && ['INPUT','TEXTAREA'].includes(input.tagName);
    if (!editing) layoutHeight = scope.innerHeight || height;
    root.dataset.keyboard = String(Boolean(editing && !zooming && layoutHeight - height > 120));
    root.style.setProperty('--viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--viewport-top', `${Math.round(top)}px`);
    root.dataset.compact = String(height < 500);
    root.dataset.constrained = String(height < 320);
  };
  const schedule = () => {
    if (disposed || frame !== null) return;
    if (scope.requestAnimationFrame) frame = scope.requestAnimationFrame(update);
    else update();
  };
  const targets = [[scope, 'resize'], [scope, 'orientationchange'], [scope, 'pageshow'], [scope, 'focusin'], [scope, 'focusout']];
  if (visual) targets.push([visual, 'resize'], [visual, 'scroll']);
  for (const [target, event] of targets) target.addEventListener(event, schedule);
  update();
  return () => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) scope.cancelAnimationFrame?.(frame);
    for (const [target, event] of targets) target.removeEventListener(event, schedule);
    root.style.removeProperty('--viewport-height'); root.style.removeProperty('--viewport-top');
    delete root.dataset.compact;
    delete root.dataset.constrained;
    delete root.dataset.keyboard;
  };
}
