/* Paper month picker. Native month input remains the form's sole source of truth.
 * Keyboard, click-away, and Escape supported; no network access or locale API calls.
 * Without JavaScript the original <input type="month"> stays functional. */
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const nowInWib = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta', year:'numeric', month:'2-digit'}).formatToParts(new Date()).map(part => [part.type,part.value]));
  return {year:Number(parts.year), month:Number(parts.month)-1};
};
const validMonth = value => /^(\d{4})-(0[1-9]|1[0-2])$/.test(value || '');
const formatValue = value => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value || '');
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : 'Pilih periode';
};
export function enhancePaperMonthInputs(root = document) {
  for (const input of root.querySelectorAll('input[type="month"][name="periodId"]')) {
    if (input.dataset.paperMonthEnhanced) continue;
    input.dataset.paperMonthEnhanced = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'cf-paper-month';
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'cf-paper-month-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Pilih periode kompetisi');
    const valueText = document.createElement('span');
    const chevron = document.createElement('span'); chevron.textContent = '▦'; chevron.setAttribute('aria-hidden','true');
    trigger.append(valueText, chevron);
    const popup = document.createElement('section');
    popup.className = 'cf-paper-month-panel'; popup.hidden = true;
    popup.setAttribute('role','dialog'); popup.setAttribute('aria-label','Pilih bulan dan tahun');
    const header = document.createElement('div'); header.className = 'cf-paper-month-header';
    const prev = document.createElement('button'), next = document.createElement('button');
    prev.type = next.type = 'button'; prev.textContent = '←'; next.textContent = '→';
    prev.setAttribute('aria-label','Tahun sebelumnya'); next.setAttribute('aria-label','Tahun berikutnya');
    const yearTitle = document.createElement('strong'); yearTitle.setAttribute('aria-live','polite');
    header.append(prev,yearTitle,next);
    const monthsGrid = document.createElement('div'); monthsGrid.className = 'cf-paper-month-grid';
    const footer = document.createElement('div'); footer.className='cf-paper-month-footer';
    const current = document.createElement('button'); current.type = 'button'; current.textContent='Bulan ini';
    const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.textContent='Tutup';
    footer.append(current,closeBtn); popup.append(header,monthsGrid,footer);
    input.parentElement.insertBefore(wrapper,input); wrapper.append(input,trigger,popup);
    input.classList.add('cf-paper-month-native'); input.setAttribute('aria-hidden','true'); input.tabIndex = -1;
    let year = nowInWib().year;
    const withinLimits = value => (!validMonth(input.min) || value >= input.min) && (!validMonth(input.max) || value <= input.max);
    const sync = () => {valueText.textContent = formatValue(input.value);trigger.disabled = input.disabled;if (input.disabled) close();};
    const close = (focus = false) => {popup.hidden = true;trigger.setAttribute('aria-expanded','false');wrapper.classList.remove('is-open');if (focus) trigger.focus();};
    const select = month => {
      const value = `${year}-${String(month + 1).padStart(2,'0')}`;
      if (input.disabled || !withinLimits(value)) return;
      input.value = value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      close(true);
    };
    const render = () => {
      yearTitle.textContent = String(year);
      prev.disabled = year <= 1900 || (validMonth(input.min) && year <= Number(input.min.slice(0,4)));
      next.disabled = year >= 2100 || (validMonth(input.max) && year >= Number(input.max.slice(0,4)));
      const now = nowInWib();
      current.disabled = !withinLimits(`${now.year}-${String(now.month + 1).padStart(2,'0')}`);
      monthsGrid.replaceChildren();
      MONTHS.forEach((label, i) => {
        const button = document.createElement('button'); button.type='button';
        button.textContent = label.slice(0,3);
        button.setAttribute('aria-label',`${label} ${year}`);
        const candidate = `${year}-${String(i+1).padStart(2,'0')}`;
        button.disabled = !withinLimits(candidate);
        button.setAttribute('aria-pressed',String(input.value===candidate));
        button.addEventListener('click',()=>select(i));monthsGrid.append(button);
      });
    };
    const open = () => {
      document.querySelectorAll('.cf-paper-month.is-open').forEach(other => {
        if (other !== wrapper) other.querySelector('.cf-paper-month-trigger')?.click();
      });
      if (input.disabled) return;
      const savedYear = Number((input.value || '').slice(0,4));
      year = savedYear >= 1900 && savedYear <= 2100 ? savedYear : nowInWib().year;
      sync();render();popup.hidden=false;wrapper.classList.add('is-open');trigger.setAttribute('aria-expanded','true');
      // Keep the paper panel inside the viewport even for controls in the
      // rightmost column or close to the bottom of a small screen.
      const bounds = wrapper.getBoundingClientRect();
      const width = popup.getBoundingClientRect().width;
      popup.style.left = `${Math.max(12 - bounds.left, Math.min(0, window.innerWidth - 12 - bounds.left - width))}px`;
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const flipAbove = below < 230 && above > below && above >= 160;
      popup.style.top = flipAbove ? 'auto' : '';
      popup.style.bottom = flipAbove ? 'calc(100% + 7px)' : '';
      popup.style.maxHeight = `${Math.max(120, Math.min(365, (flipAbove ? above : below) - 8))}px`;
      const selected = monthsGrid.querySelector('[aria-pressed="true"]');
      (selected || monthsGrid.querySelector('button:not([disabled])') || closeBtn)?.focus();
    };
    trigger.addEventListener('click',()=>popup.hidden ? open() : close());
    trigger.addEventListener('keydown',event=>{if (['ArrowDown','Enter',' '].includes(event.key)) {event.preventDefault();open();}});
    prev.addEventListener('click',()=>{if (prev.disabled) return;year=Math.max(1900,year-1);render();prev.focus();});
    next.addEventListener('click',()=>{if (next.disabled) return;year=Math.min(2100,year+1);render();next.focus();});
    current.addEventListener('click',()=>{const now=nowInWib();year=now.year;select(now.month);});
    closeBtn.addEventListener('click',()=>close(true));
    popup.addEventListener('keydown',event=>{
      if (event.key==='Escape') {event.preventDefault();close(true);}
      if (event.key==='Tab') { // Contain keyboard focus while the dialog is open.
        const focusables = [...popup.querySelectorAll('button:not([disabled])')];
        const index = focusables.indexOf(document.activeElement);
        if (!event.shiftKey && index===focusables.length-1) {event.preventDefault();focusables[0].focus();}
        if (event.shiftKey && index===0) {event.preventDefault();focusables.at(-1).focus();}
      }
    });
    document.addEventListener('pointerdown',event=>{if (!wrapper.contains(event.target)) close();});
    input.addEventListener('input',sync);input.addEventListener('change',sync);
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(sync).observe(input, {attributes:true, attributeFilter:['disabled','min','max']});
    }
    window.addEventListener('load',sync,{once:true});sync();
  }
}
