export const TOUR_MODES = Object.freeze(['interactive', 'companion']);

/** A page address may choose an existing mode, never inject a control selector. */
export function tourModeFromSearch(search = '') {
  const value = new URLSearchParams(search).get('mode');
  return TOUR_MODES.includes(value) ? value : 'interactive';
}

/** The mode-selection page may opt into one fresh-entry presentation only. */
export function isModeSelectionEntry(search = '') {
  return new URLSearchParams(search).get('entry') === 'modes';
}

/** Horizontal intent only: scrolling and small taps must never leave the page. */
export function isWelcomeSwipe(start, end) {
  if (!start || !end) return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  const elapsed = end.time - start.time;
  return Number.isFinite(dx) && Number.isFinite(dy) && elapsed >= 0 && elapsed < 1400 && dx <= -65 && Math.abs(dx) > Math.abs(dy) * 1.6;
}

export function mountWelcomeSwipe(element, navigate, { direction = 'left' } = {}) {
  let start = null, dragging = false, suppressClick = false;
  const sign = direction === 'right' ? -1 : 1;
  const feedback = dx => {
    element.style?.setProperty('--swipe-offset', `${Math.max(-48, Math.min(48, dx * .4))}px`);
  };
  const reset = () => {
    start = null; dragging = false;
    element.classList?.remove('is-swiping');
    element.style?.removeProperty('--swipe-offset');
  };
  const down = event => {
    const control = event.target.closest?.('a, button, input, select, textarea');
    if (event.isPrimary === false || event.button !== 0 || (control && !control.hasAttribute?.('data-swipe-link'))) return;
    suppressClick = false;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  };
  const move = event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!dragging && Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
    if (!dragging && dx * sign < -10 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      dragging = true; suppressClick = true;
      element.classList?.add('is-swiping');
      element.setPointerCapture?.(event.pointerId);
    }
    if (dragging) { event.preventDefault?.(); feedback(dx); }
  };
  const up = event => {
    if (!start || event.pointerId !== start.id) return;
    const origin = start;
    const accepted = isWelcomeSwipe({ ...origin, x:origin.x * sign }, { x:event.clientX * sign, y:event.clientY, time:event.timeStamp });
    suppressClick = dragging || accepted;
    reset();
    if (accepted) navigate();
  };
  const cancel = () => { reset(); };
  const lostCapture = event => { if (event.target === element) reset(); };
  const click = event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const preventDrag = event => { if (start) event.preventDefault(); };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('lostpointercapture', lostCapture);
  element.addEventListener('click', click, true);
  element.addEventListener('dragstart', preventDrag);
  return () => {
    reset();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', lostCapture);
    element.removeEventListener('click', click, true);
    element.removeEventListener('dragstart', preventDrag);
  };
}
