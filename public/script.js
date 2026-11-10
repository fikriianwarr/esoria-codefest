document.documentElement.classList.add('enhanced');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const siteHeader = document.querySelector('.site-header');

const closeMenu = () => {
  navLinks?.classList.remove('open');
  navToggle?.classList.remove('active');
  navToggle?.setAttribute('aria-expanded', 'false');
};

if (navToggle && navLinks) {
  navToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = navLinks.classList.toggle('open');
    navToggle.classList.toggle('active', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!navLinks.contains(event.target) && !navToggle.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      navToggle.focus();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) closeMenu();
  });
}

const sectionLinks = [...document.querySelectorAll('[data-section-link]')];
const trackedSections = sectionLinks
  .map((link) => document.getElementById(link.dataset.sectionLink))
  .filter(Boolean);

const setActiveNav = (id) => {
  sectionLinks.forEach((link) => {
    const isActive = link.dataset.sectionLink === id;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
};

const getHeaderOffset = () => (siteHeader?.offsetHeight || 0) + 14;

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;

    const target = hash === '#top' ? document.body : document.querySelector(hash);
    if (!target) return;

    event.preventDefault();
    closeMenu();

    const top = hash === '#top'
      ? 0
      : target.getBoundingClientRect().top + window.scrollY - getHeaderOffset();

    window.scrollTo({
      top: Math.max(0, top),
      behavior: reduceMotion.matches ? 'auto' : 'smooth'
    });

    if (hash === '#top') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setActiveNav('top');
    } else {
      history.replaceState(null, '', hash);
      setActiveNav(hash.slice(1));
    }
  });
});

const syncHeader = () => {
  siteHeader?.classList.toggle('is-scrolled', window.scrollY > 16);
};

const contentSections = trackedSections.filter((section) => section.id !== 'top');
let navSyncQueued = false;

const syncActiveNav = () => {
  const marker = window.scrollY + getHeaderOffset() + (window.innerHeight * 0.24);
  let activeId = 'top';

  contentSections.forEach((section) => {
    if (section.offsetTop <= marker) activeId = section.id;
  });

  setActiveNav(activeId);
  navSyncQueued = false;
};

const queueNavigationSync = () => {
  if (navSyncQueued) return;
  navSyncQueued = true;
  window.requestAnimationFrame(() => {
    syncActiveNav();
    syncHeader();
  });
};

if (siteHeader || sectionLinks.length) {
  window.addEventListener('scroll', queueNavigationSync, { passive: true });
  window.addEventListener('resize', queueNavigationSync, { passive: true });
  window.addEventListener('load', queueNavigationSync, { once: true });
  syncActiveNav();
  syncHeader();
}

document.querySelectorAll(
  '.ticket-detail-body .detail-back, .ticket-detail-body .detail-hero, .ticket-detail-body .detail-section'
).forEach((item) => item.classList.add('reveal'));

const revealItems = [...document.querySelectorAll('.reveal')];
if (!('IntersectionObserver' in window) || reduceMotion.matches) {
  revealItems.forEach((item) => item.classList.add('visible'));
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  revealItems.forEach((item, index) => {
    item.style.transitionDelay = `${Math.min(index % 4, 3) * 45}ms`;
    revealObserver.observe(item);
  });
}

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];

const activateTab = (button, moveFocus = false) => {
  const panelId = button.dataset.tab;
  tabButtons.forEach((item) => {
    const isActive = item === button;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
    item.tabIndex = isActive ? 0 : -1;
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.id === panelId;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
  if (moveFocus) button.focus();
};

tabButtons.forEach((button, index) => {
  const panel = document.getElementById(button.dataset.tab);
  const buttonId = `tab-${button.dataset.tab}`;
  button.id = buttonId;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', button.dataset.tab);
  panel?.setAttribute('role', 'tabpanel');
  panel?.setAttribute('aria-labelledby', buttonId);

  button.addEventListener('click', () => activateTab(button));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabButtons.length - 1;
    activateTab(tabButtons[nextIndex], true);
  });
});

const initialTab = tabButtons.find((button) => button.classList.contains('active')) || tabButtons[0];
if (initialTab) activateTab(initialTab);

const faqToggle = document.querySelector('.faq-toggle');
const faqMore = document.querySelector('#faq-more');

if (faqToggle && faqMore) {
  faqMore.hidden = true;
  faqToggle.addEventListener('click', () => {
    const isOpen = faqMore.classList.toggle('open');
    faqMore.hidden = !isOpen;
    faqMore.setAttribute('aria-hidden', String(!isOpen));
    faqToggle.setAttribute('aria-expanded', String(isOpen));
    faqToggle.textContent = isOpen ? 'Tampilkan Lebih Sedikit' : 'Tampilkan FAQ Lainnya';
  });
}

const ticketCarousel = document.querySelector('.ticket-carousel');
const ticketToolbar = document.querySelector('.ticket-toolbar');
const ticketPrev = document.querySelector('.slide-btn[data-slide="left"]');
const ticketNext = document.querySelector('.slide-btn[data-slide="right"]');

if (ticketCarousel) {
  const getStep = () => {
    const firstCard = ticketCarousel.querySelector('.ticket-card');
    if (!firstCard) return 360;
    const styles = getComputedStyle(ticketCarousel);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
    return firstCard.getBoundingClientRect().width + gap;
  };

  const updateControls = () => {
    const maxScroll = Math.max(0, ticketCarousel.scrollWidth - ticketCarousel.clientWidth - 2);
    const hasOverflow = maxScroll > 4;
    const showControls = hasOverflow && !window.matchMedia('(min-width: 981px)').matches;

    ticketCarousel.classList.toggle('has-overflow', hasOverflow);
    ticketCarousel.classList.toggle('no-overflow', !hasOverflow);
    ticketToolbar?.classList.toggle('is-visible', showControls);
    ticketToolbar?.setAttribute('aria-hidden', String(!showControls));

    if (ticketPrev) {
      ticketPrev.disabled = !hasOverflow || ticketCarousel.scrollLeft <= 2;
      ticketPrev.tabIndex = showControls ? 0 : -1;
    }
    if (ticketNext) {
      ticketNext.disabled = !hasOverflow || ticketCarousel.scrollLeft >= maxScroll;
      ticketNext.tabIndex = showControls ? 0 : -1;
    }
  };

  ticketPrev?.addEventListener('click', () => {
    ticketCarousel.scrollBy({ left: -getStep(), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });

  ticketNext?.addEventListener('click', () => {
    ticketCarousel.scrollBy({ left: getStep(), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });

  let dragging = false;
  let startX = 0;
  let startScroll = 0;

  ticketCarousel.addEventListener('pointerdown', (event) => {
    // Touch scrolling remains native: pointer capture interferes with swipe momentum on Android.
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target.closest('a, button')) return;
    if (!ticketCarousel.classList.contains('has-overflow')) return;
    dragging = true;
    startX = event.clientX;
    startScroll = ticketCarousel.scrollLeft;
    ticketCarousel.classList.add('is-dragging');
    ticketCarousel.setPointerCapture(event.pointerId);
  });

  ticketCarousel.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerType !== 'mouse') return;
    ticketCarousel.scrollLeft = startScroll - (event.clientX - startX);
  });

  const stopDragging = (event) => {
    dragging = false;
    ticketCarousel.classList.remove('is-dragging');
    if (event.pointerId !== undefined && ticketCarousel.hasPointerCapture(event.pointerId)) {
      ticketCarousel.releasePointerCapture(event.pointerId);
    }
  };

  ticketCarousel.addEventListener('pointerup', stopDragging);
  ticketCarousel.addEventListener('pointercancel', stopDragging);
  ticketCarousel.addEventListener('scroll', updateControls, { passive: true });
  window.addEventListener('resize', updateControls);
  if ('ResizeObserver' in window) {
    const ticketResizeObserver = new ResizeObserver(updateControls);
    ticketResizeObserver.observe(ticketCarousel);
  }
  updateControls();
}

const heroBoard = document.querySelector('.hero-board');
if (heroBoard && !reduceMotion.matches && window.matchMedia('(pointer: fine)').matches) {
  let heroFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  heroBoard.addEventListener('pointermove', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (heroFrame) return;
    heroFrame = requestAnimationFrame(() => {
      heroFrame = 0;
      const rect = heroBoard.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((pointerX - rect.left) / rect.width - 0.5) * 3;
      const y = ((pointerY - rect.top) / rect.height - 0.5) * 3;
      heroBoard.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  }, { passive: true });
  heroBoard.addEventListener('pointerleave', () => {
    cancelAnimationFrame(heroFrame);
    heroFrame = 0;
    heroBoard.style.transform = '';
  });
}
