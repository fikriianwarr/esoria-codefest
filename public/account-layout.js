/* Small-screen signup steps retain the same form fields and Firebase submit. */
(() => {
  const form = document.querySelector('body[data-auth-page="signup"] #auth-form');
  if (!form) return;
  const panels = [...form.querySelectorAll('[data-account-step]')];
  const tabs = [...form.querySelectorAll('[data-account-tab]')];
  const navigation = form.querySelector('[data-account-steps]');
  const next = form.querySelector('[data-account-next]');
  const back = form.querySelector('[data-account-back]');
  const submit = form.querySelector('#auth-submit');
  const card = form.closest('.auth-card');
  const compact = matchMedia('(max-width:760px), (max-height:760px)');
  let active = 'identity';
  const fields = (panel) => [...panel.querySelectorAll('input')];
  const invalidField = (panel) => fields(panel).find(input => !input.checkValidity());
  const render = (focus = false) => {
    form.dataset.accountCompact = String(compact.matches);
    form.dataset.accountActive = active;
    card.dataset.accountActive = compact.matches ? active : 'all';
    panels.forEach(panel => { panel.hidden = compact.matches && panel.dataset.accountStep !== active; });
    navigation.hidden = !compact.matches;
    next.hidden = !compact.matches || active !== 'identity';
    back.hidden = !compact.matches || active !== 'security';
    submit.hidden = compact.matches && active !== 'security';
    tabs.forEach(tab => {
      const current = tab.dataset.accountTab === active;
      if (current) tab.setAttribute('aria-current', 'step'); else tab.removeAttribute('aria-current');
    });
    if (focus) fields(panels.find(panel => panel.dataset.accountStep === active))[0]?.focus({preventScroll:true});
  };
  const change = (step) => {
    if (step === 'security') {
      const invalid = invalidField(panels[0]);
      if (invalid) { active = 'identity'; render(); invalid.reportValidity(); return; }
    }
    active = step;
    render(true);
  };
  next.addEventListener('click', () => change('security'));
  back.addEventListener('click', () => change('identity'));
  tabs.forEach(tab => tab.addEventListener('click', () => change(tab.dataset.accountTab)));
  // Invalid controls may be on the other step. Reveal them before browser focus.
  form.addEventListener('invalid', event => {
    if (!compact.matches) return;
    const panel = event.target.closest('[data-account-step]');
    if (panel?.hidden) { active = panel.dataset.accountStep; render(); }
  }, true);
  form.addEventListener('keydown', event => {
    if (compact.matches && active === 'identity' && event.key === 'Enter' && !event.isComposing && event.target.matches('input')) {
      event.preventDefault(); change('security');
    }
  });
  form.addEventListener('submit', event => {
    if (compact.matches && active === 'identity') {
      event.preventDefault(); event.stopImmediatePropagation(); change('security');
    }
  }, true);
  compact.addEventListener('change', () => render());
  render();
})();
