(() => {
  const root = document.documentElement;
  const rank = href => {
    const path = new URL(href, location.href).pathname;
    return path.endsWith('/tour.html') ? 2 : path.endsWith('/modes.html') ? 1 : 0;
  };
  const direction = (from, to) => {
    root.style.setProperty('--arrival-slide', rank(to) < rank(from) ? '-100%' : '100%');
  };
  // These listeners run in the head, before pagereveal or any application work.
  addEventListener('pageswap', event => {
    if (event.activation) direction(location.href, event.activation.entry.url);
  });
  addEventListener('pagereveal', event => {
    const activation = window.navigation?.activation;
    if (activation?.from) direction(activation.from.url, location.href);
  });
  try {
    const entry = JSON.parse(sessionStorage.getItem('arrival-transition') || 'null');
    sessionStorage.removeItem('arrival-transition');
    if (entry && entry.to === location.href && Date.now() - entry.time < 5000) {
      direction(entry.from, entry.to);
      root.classList.add('arrival-incoming');
      addEventListener('pageshow', () => setTimeout(() => root.classList.remove('arrival-incoming'), 400), { once:true });
    }
  } catch { /* Storage may be disabled; links must still work. */ }
  addEventListener('pageshow', event => {
    if (event.persisted) root.classList.remove('arrival-incoming');
  });
})();
