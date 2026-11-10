/* Accessible paper-style select. The native select remains the only source of
 * submitted values. Never allow a custom option to bypass native disabled
 * constraints, even if options are updated after first render. */
let nextListId = 0;
export function enhancePaperSelects(root = document) {
  for (const select of root.querySelectorAll('select[name="package"],select[name="wave"],select#jury-status,select[name="bank_pengirim"]')) {
    if (select.dataset.paperEnhanced) continue;
    select.dataset.paperEnhanced = 'true';
    const wrapper = document.createElement('div');
    const isBankSelect = select.matches('select[name="bank_pengirim"]');
    wrapper.className = `cf-paper-dropdown${isBankSelect ? ' cf-payment-bank-dropdown' : ''}`;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cf-paper-dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div');
    list.className = 'cf-paper-dropdown-menu';
    if (isBankSelect) list.classList.add('cf-payment-bank-menu');
    list.setAttribute('role', 'listbox');
    const label = select.closest('label')?.querySelector('span')?.textContent?.trim() || 'Pilihan';
    list.setAttribute('aria-label', label);
    list.hidden = true;
    list.id = `paper-list-${++nextListId}`;
    trigger.setAttribute('aria-controls', list.id);
    const valueText = document.createElement('span');
    if (isBankSelect) {
      const bankGlyph = document.createElement('span');
      bankGlyph.className = 'cf-payment-bank-glyph';
      bankGlyph.setAttribute('aria-hidden', 'true');
      bankGlyph.textContent = '▦';
      trigger.append(bankGlyph);
    }
    const icon = document.createElement('span');
    icon.className = 'cf-paper-dropdown-chevron';
    icon.setAttribute('aria-hidden', 'true');
    // Draw a consistent chevron instead of a font glyph that may render as a large 'V'.
    icon.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 9 7 7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    trigger.append(valueText, icon);
    let items = [];
    const isUnavailable = option => Boolean(option.disabled || option.parentElement?.disabled);
    const sync = () => {
      const selected = select.selectedOptions[0];
      valueText.textContent = selected?.textContent || 'Pilih';
      trigger.disabled = select.disabled;
      trigger.setAttribute('aria-label', `${label}: ${valueText.textContent}`);
      items.forEach(item => {
        item.element.setAttribute('aria-selected', String(item.option.selected));
        item.element.setAttribute('aria-disabled', String(isUnavailable(item.option)));
      });
      if (select.disabled) close();
    };
    const close = (focus = false) => {
      list.hidden = true;
      wrapper.classList.remove('opens-up');
      trigger.setAttribute('aria-expanded', 'false');
      wrapper.classList.remove('is-open');
      if (focus && !trigger.disabled) trigger.focus();
    };
    const choose = item => {
      if (select.disabled || isUnavailable(item.option) || !item.option.isConnected) return;
      if (select.value !== item.option.value) {
        select.value = item.option.value;
        select.dispatchEvent(new Event('input', {bubbles:true}));
        select.dispatchEvent(new Event('change', {bubbles:true}));
      }
      sync();
      close(true);
    };
    const focusAvailable = (index, direction = 1) => {
      let pos = index;
      while (pos >= 0 && pos < items.length) {
        if (!isUnavailable(items[pos].option)) {
          items[pos].element.focus();
          return;
        }
        pos += direction;
      }
    };
    const rebuild = () => {
      items = [];
      list.replaceChildren();
      let lastGroup = null;
      for (const option of [...select.options]) {
        const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (isBankSelect && group !== lastGroup && group) {
          const heading = document.createElement('div');
          heading.className = 'cf-payment-bank-group';
          heading.setAttribute('role', 'presentation');
          heading.textContent = group.label;
          list.append(heading);
        }
        lastGroup = group;
        const element = document.createElement('div');
        element.className = 'cf-paper-dropdown-option';
        if (isBankSelect) {
          element.classList.add('cf-payment-bank-option');
          element.dataset.bankCategory = group ? 'grouped' : 'placeholder';
        }
        element.setAttribute('role', 'option');
        element.tabIndex = -1;
        element.textContent = option.textContent;
        element.setAttribute('aria-disabled', String(isUnavailable(option)));
        const item = {element, option};
        items.push(item);
        element.addEventListener('click', () => choose(item));
        element.addEventListener('keydown', event => {
          if (event.key === 'Escape') {event.preventDefault(); close(true); return;}
          if (event.key === 'Tab') {close(); return;}
          if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); choose(item); return;}
          const pos = items.indexOf(item);
          if (event.key === 'ArrowDown') {event.preventDefault();focusAvailable(pos + 1, 1);}
          else if (event.key === 'ArrowUp') {event.preventDefault();focusAvailable(pos - 1, -1);}
          else if (event.key === 'Home') {event.preventDefault();focusAvailable(0, 1);}
          else if (event.key === 'End') {event.preventDefault();focusAvailable(items.length - 1, -1);}
        });
        list.append(element);
      }
      sync();
    };
    const open = () => {
      if (select.disabled) return;
      for (const other of document.querySelectorAll('.cf-paper-dropdown.is-open')) {
        if (other !== wrapper) other.querySelector('.cf-paper-dropdown-trigger')?.click();
      }
      if (isBankSelect) {
        const bounds = wrapper.getBoundingClientRect();
        const bottomRoom = window.innerHeight - bounds.bottom;
        wrapper.classList.toggle('opens-up', bottomRoom < 260 && bounds.top > bottomRoom);
        const availableRoom = wrapper.classList.contains('opens-up') ? bounds.top : bottomRoom;
        list.style.maxHeight = `${Math.max(120, Math.min(360, availableRoom - 15))}px`;
      }
      // Native options can change after initialization (including disabled).
      rebuild();
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      wrapper.classList.add('is-open');
      const index = Math.max(0, items.findIndex(item => item.option.selected && !isUnavailable(item.option)));
      focusAvailable(index, 1);
    };
    trigger.addEventListener('click', () => list.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {event.preventDefault();if (list.hidden) open();}
      if (event.key === 'Escape') {event.preventDefault();close();}
    });
    document.addEventListener('pointerdown', event => {if (!wrapper.contains(event.target)) close();});
    select.addEventListener('change', sync);
    select.addEventListener('esoria:paper-select-sync', sync);
    if (isBankSelect) select.addEventListener('invalid', () => {
      trigger.setAttribute('aria-invalid', 'true');
      trigger.focus();
    });
    if (isBankSelect) select.addEventListener('change', () => trigger.removeAttribute('aria-invalid')); 
    select.parentElement.insertBefore(wrapper, select);
    wrapper.append(select, trigger, list);
    select.classList.add('cf-paper-dropdown-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    rebuild();
    // The busy() helper toggles native disabled, and scripts may add options.
    // Keep the paper control in sync rather than leaving an active-looking button.
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => { if (!list.hidden) rebuild(); else sync(); }).observe(select, {
        attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true
      });
    }
  }
}
