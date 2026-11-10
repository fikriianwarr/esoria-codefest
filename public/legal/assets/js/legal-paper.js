document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.site-header .nav');
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  const progress = document.querySelector('.progress');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const setMenu = (open, restoreFocus = false) => {
    if (!navToggle || !navLinks) return;
    navLinks.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');
    document.body.classList.toggle('menu-open', open);
    if (open) navLinks.querySelector('a')?.focus({ preventScroll: true });
    if (!open && restoreFocus) navToggle.focus({ preventScroll: true });
  };

  navToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
  });

  navLinks?.querySelectorAll('a').forEach((link) => {
    if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', () => setMenu(false));
  });

  document.addEventListener('click', (event) => {
    if (nav && !nav.contains(event.target)) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
      setMenu(false, true);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1240) setMenu(false);
  }, { passive: true });

  let scrollQueued = false;
  const backToTop = document.createElement('button');
  backToTop.className = 'back-to-top';
  backToTop.type = 'button';
  backToTop.setAttribute('aria-label', 'Kembali ke bagian atas halaman');
  backToTop.textContent = '↑';
  document.body.append(backToTop);

  const updateScrollUi = () => {
    const root = document.documentElement;
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    const ratio = maximum ? Math.min(1, Math.max(0, root.scrollTop / maximum)) : 0;
    if (progress) progress.style.width = `${(ratio * 100).toFixed(2)}%`;
    backToTop.classList.toggle('is-visible', root.scrollTop > 620);
    scrollQueued = false;
  };

  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(updateScrollUi);
  }, { passive: true });

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });

  const article = document.querySelector('.article');
  const directSections = article
    ? [...article.children].filter((element) => element.tagName === 'SECTION')
    : [];

  if (article && directSections.length) {
    const grid = document.createElement('div');
    const index = document.createElement('details');
    const summary = document.createElement('summary');
    const indexNav = document.createElement('nav');
    const content = document.createElement('div');
    const desktopIndex = window.matchMedia('(min-width: 981px)');

    grid.className = 'document-grid';
    index.className = 'document-index';
    index.open = desktopIndex.matches;
    summary.textContent = 'Isi dokumen';
    indexNav.setAttribute('aria-label', 'Daftar isi dokumen');
    content.className = 'document-content';

    directSections.forEach((section, position) => {
      const heading = section.querySelector('h2');
      if (!heading) return;
      if (!section.id) section.id = `bagian-${position + 1}`;
      const link = document.createElement('a');
      const indexNumber = document.createElement('i');
      const label = document.createElement('span');
      indexNumber.textContent = String(position + 1).padStart(2, '0');
      label.textContent = heading.textContent.replace(/^\s*\d+[.)]?\s*/, '');
      link.href = `#${section.id}`;
      link.append(indexNumber, label);
      indexNav.append(link);
      content.append(section);
    });

    index.append(summary, indexNav);
    grid.append(index, content);
    article.append(grid);

    const words = content.textContent.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 190));
    const meta = article.querySelector('.document-meta');
    if (meta) {
      const reading = document.createElement('span');
      reading.className = 'pill reading-pill';
      reading.textContent = `${directSections.length} bagian · ${minutes} menit baca`;
      meta.append(reading);
    }

    desktopIndex.addEventListener('change', (event) => {
      index.open = event.matches;
    });

    indexNav.addEventListener('click', (event) => {
      if (event.target.closest('a') && !desktopIndex.matches) index.open = false;
    });

    if ('IntersectionObserver' in window) {
      const links = [...indexNav.querySelectorAll('a')];
      const activeObserver = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0];
        if (!visible) return;
        links.forEach((link) => link.classList.toggle('is-active', link.hash === `#${visible.target.id}`));
      }, { rootMargin: '-18% 0px -68% 0px', threshold: 0 });
      directSections.forEach((section) => activeObserver.observe(section));
    }
  }

  const revealItems = [...document.querySelectorAll(
    '.hero-card, .quick, .card, .document-note, .document-content > section, .table-wrap'
  )];
  revealItems.forEach((item, index) => {
    item.classList.add('reveal-item');
    item.style.transitionDelay = `${Math.min(index % 4, 3) * 65}ms`;
  });

  if (!('IntersectionObserver' in window) || reducedMotion.matches) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealItems.forEach((item) => revealObserver.observe(item));
  }

  updateScrollUi();
});
