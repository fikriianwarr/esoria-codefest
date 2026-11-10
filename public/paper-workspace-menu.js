/* Accessible responsive paper menu. Visual-only enhancement; role guards
   continue to own every link's hidden state. No Auth or backend shortcuts. */
(() => {
  'use strict';
  const header = document.querySelector('.cf-header');
  if (!header || header.querySelector('[data-paper-menu-button]')) return;
  const navigations = [...header.querySelectorAll('nav.cf-nav:not([data-context-nav="pending"])')];
  if (!navigations.length) return;
  const isCompact = window.matchMedia('(max-width: 720px)');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'cf-paper-menu-toggle';
  toggle.dataset.paperMenuButton = '';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Buka menu navigasi');
  toggle.hidden = true;
  const symbol = document.createElement('span');
  symbol.className = 'cf-paper-menu-lines';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const label = document.createElement('span');
  label.className = 'cf-paper-menu-label';
  label.textContent = 'Menu';
  toggle.append(symbol, label);
  header.append(toggle);
  let current = null;

  const close = ({ restoreFocus = false } = {}) => {
    const wasOpen = current?.classList.contains('is-paper-menu-open');
    navigations.forEach((nav) => nav.classList.remove('is-paper-menu-open'));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Buka menu navigasi');
    if (restoreFocus && wasOpen) toggle.focus();
  };

  const resolveNavigation = () => {
    if (document.body.dataset.workspace === 'results' &&
        document.documentElement.classList.contains('esoria-context-pending')) {
      return navigations.find((nav) => nav.dataset.contextNav === 'public')
        || navigations.find((nav) => !nav.hidden)
        || navigations[0]
        || null;
    }
    if (['jury','operations'].includes(document.body.dataset.workspace) &&
        !document.body.classList.contains('auth-ready')) return null;
    return navigations.find((nav) => !nav.hidden) || navigations[0] || null;
  };
  const sync = () => {
    const next = resolveNavigation();
    if (next !== current) close();
    current = next;
    toggle.hidden = !isCompact.matches || !current;
    if (current) {
      if (!current.id) current.id = `cf-paper-menu-${current.dataset.contextNav || document.body.dataset.workspace || 'main'}`;
      current.dataset.paperMenuEnhanced = '';
      toggle.setAttribute('aria-controls', current.id);
    } else {
      toggle.removeAttribute('aria-controls');
    }
    if (!isCompact.matches) close();
  };

  toggle.addEventListener('click', () => {
    sync();
    if (!current || !isCompact.matches) return;
    const opening = !current.classList.contains('is-paper-menu-open');
    close();
    if (opening) current.classList.add('is-paper-menu-open');
    toggle.setAttribute('aria-expanded', String(opening));
    toggle.setAttribute('aria-label', opening ? 'Tutup menu navigasi' : 'Buka menu navigasi');
  });
  document.addEventListener('pointerdown', (event) => {
    if (!header.contains(event.target)) close();
    else if (current && !current.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      close({restoreFocus:true});
    }
  });
  navigations.forEach((nav) => {
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
      // The existing [data-logout] controller owns logout confirmation.
    });
  });
  const observer = new MutationObserver(sync);
  navigations.forEach((nav) => observer.observe(nav, {attributes:true,attributeFilter:['hidden']}));
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  if (document.body.dataset.workspace === 'results') {
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  }
  if (typeof isCompact.addEventListener === 'function') isCompact.addEventListener('change',sync);
  else isCompact.addListener(sync);
  document.body.classList.add('cf-paper-menu-ready');
  sync();
})();
