/* Accessible progressive paper calendar for date fields.
 * The original HTML date input remains the only serialized form value.
 * No Firebase, API or persisted data schema is changed here. */
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const WEEKDAYS = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
let nextId = 0;
const iso = (y, m, d) => `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const parseDate = (value) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value || '')) return null;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d ? {y,m,d} : null;
};
const todayLocal = () => { const d = new Date(); return {y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()}; };
const pretty = value => {const d=parseDate(value);return d ? `${d.d} ${MONTHS[d.m-1]} ${d.y}` : 'Pilih tanggal';};
const dayName = (y,m,d) => `${d} ${MONTHS[m-1]} ${y}`;
const limits = input => ({min:parseDate(input.min),max:parseDate(input.max)});
const allowed = (input, value) => {
  const parsed = parseDate(value);
  if (!parsed) return false;
  const {min,max} = limits(input);
  return !(min && value < input.min) && !(max && value > input.max);
};
const icon = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('width','20'); svg.setAttribute('height','20');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('aria-hidden','true');
  for (const d of ['M4 5h16v16H4z','M8 3v4','M16 3v4','M4 10h16']) {
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);
  }
  return svg;
};
export function enhancePaperDates(root = document) {
  for (const input of root.querySelectorAll('input[type="date"][name="tanggal_transfer"],input[type="date"][name="birth_date"],input[type="date"]#admin-edit-birth')) {
    if (input.dataset.paperDateEnhanced) continue;
    input.dataset.paperDateEnhanced='true';
    const ownerDialog = input.closest('dialog');
    const popupParent = ownerDialog || document.body;
    const wrap=document.createElement('div');wrap.className='ec-date-control';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='ec-date-trigger';
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-label',`${input.closest('label')?.querySelector('span')?.textContent?.trim() || 'Tanggal'}: pilih tanggal`);
    const text=document.createElement('span');text.className='ec-date-value';
    const glyph=document.createElement('span');glyph.className='ec-date-icon';glyph.append(icon());
    trigger.append(text,glyph);
    const pop=document.createElement('div');pop.id=`ec-date-dialog-${++nextId}`;
    pop.className='ec-date-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Pilih tanggal');
    pop.hidden=true;trigger.setAttribute('aria-controls',pop.id);
    const head=document.createElement('div');head.className='ec-date-head';
    const prev=document.createElement('button');prev.type='button';prev.className='ec-date-month-arrow';prev.textContent='‹';prev.setAttribute('aria-label','Bulan sebelumnya');
    const next=document.createElement('button');next.type='button';next.className='ec-date-month-arrow';next.textContent='›';next.setAttribute('aria-label','Bulan berikutnya');
    const month=document.createElement('select');month.className='ec-date-month';month.setAttribute('aria-label','Bulan');
    MONTHS.forEach((label,i)=>{const opt=document.createElement('option');opt.value=String(i+1);opt.textContent=label;month.append(opt);});
    const year=document.createElement('select');year.className='ec-date-year';year.setAttribute('aria-label','Tahun');
    head.append(prev,month,year,next);
    const week=document.createElement('div');week.className='ec-date-week';
    WEEKDAYS.forEach(name=>{const cell=document.createElement('span');cell.textContent=name;week.append(cell);});
    const grid=document.createElement('div');grid.className='ec-date-days';
    const foot=document.createElement('div');foot.className='ec-date-foot';
    const clear=document.createElement('button');clear.type='button';clear.textContent='Hapus';clear.className='ec-date-soft';
    const today=document.createElement('button');today.type='button';today.textContent='Hari ini';today.className='ec-date-today';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Tutup';dismiss.className='ec-date-soft';
    foot.append(clear,today,dismiss);pop.append(head,week,grid,foot);
    input.before(wrap);wrap.append(input,trigger);popupParent.append(pop);
    input.classList.add('ec-date-native');input.tabIndex=-1;input.setAttribute('aria-hidden','true');
    let current=parseDate(input.value) || todayLocal();
    let viewYear=current.y,viewMonth=current.m;
    const sync=()=>{text.textContent=pretty(input.value);text.classList.toggle('is-empty',!parseDate(input.value));trigger.disabled=input.disabled || input.readOnly;trigger.setAttribute('aria-invalid',String(!input.validity.valid && input.value !== ''));if(trigger.disabled) close();};
    const position=()=>{
      const rect=trigger.getBoundingClientRect();
      const width=Math.min(350,Math.max(260,window.innerWidth-20));
      const left=Math.max(10,Math.min(rect.left,window.innerWidth-width-10));
      const height=Math.min(408,window.innerHeight-18);
      const below=window.innerHeight-rect.bottom,above=rect.top;
      const flip=below < Math.min(355,height) && above>below;
      pop.style.width=`${width}px`;
      pop.style.left=`${left}px`;
      pop.style.maxHeight=`${Math.max(170,Math.min(height,flip?above-12:below-12))}px`;
      if(flip){pop.style.top='auto';pop.style.bottom=`${Math.max(6,window.innerHeight-rect.top+7)}px`;}
      else {pop.style.bottom='auto';pop.style.top=`${Math.min(rect.bottom+7,window.innerHeight-45)}px`;}
    };
    function close(refocus=false){if(pop.hidden)return;pop.hidden=true;wrap.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');if(refocus && !trigger.disabled) trigger.focus();}
    const offset=(n)=>{
      const proposed=new Date(Date.UTC(viewYear,viewMonth-1+n,1));
      return {y:proposed.getUTCFullYear(),m:proposed.getUTCMonth()+1};
    };
    const monthInBounds=({y,m})=>{
      const first=iso(y,m,1),last=iso(y,m,new Date(Date.UTC(y,m,0)).getUTCDate());
      const {min,max}=limits(input);
      return !(min && last < input.min) && !(max && first > input.max) && y>=1900 && y<=2100;
    };
    const buildYears=()=>{
      const {min,max}=limits(input);
      const lo=Math.max(1900,min?.y ?? 1900),hi=Math.min(2100,max?.y ?? Math.max(2100,todayLocal().y));
      year.replaceChildren();
      for(let y=hi;y>=lo;y--){const opt=document.createElement('option');opt.value=String(y);opt.textContent=String(y);year.append(opt);}
    };
    const render=()=>{
      if(!year.options.length || ![...year.options].some(opt=>Number(opt.value)===viewYear))buildYears();
      month.value=String(viewMonth);year.value=String(viewYear);
      prev.disabled=!monthInBounds(offset(-1));next.disabled=!monthInBounds(offset(1));
      const now=todayLocal();today.disabled=!allowed(input,iso(now.y,now.m,now.d));
      clear.disabled=!input.value;
      const firstWeekday=(new Date(Date.UTC(viewYear,viewMonth-1,1)).getUTCDay()+6)%7;
      const count=new Date(Date.UTC(viewYear,viewMonth,0)).getUTCDate();
      grid.replaceChildren();
      for(let i=0;i<firstWeekday;i++){const blank=document.createElement('span');blank.className='ec-date-blank';grid.append(blank);}
      for(let d=1;d<=count;d++){
        const value=iso(viewYear,viewMonth,d),button=document.createElement('button');
        button.type='button';button.textContent=String(d);button.className='ec-date-day';
        button.setAttribute('aria-label',dayName(viewYear,viewMonth,d));
        button.disabled=!allowed(input,value);
        if(value===input.value){button.classList.add('is-selected');button.setAttribute('aria-pressed','true');}
        if(value===iso(now.y,now.m,now.d))button.classList.add('is-today');
        button.addEventListener('click',()=>choose(value));grid.append(button);
      }
    };
    const choose=value=>{
      if(input.disabled || input.readOnly || !allowed(input,value))return;
      const changed=input.value!==value;input.value=value;
      sync();close(true);
      if(changed){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
    };
    const open=()=>{
      if(input.disabled || input.readOnly)return;
      document.querySelectorAll('.ec-date-control.is-open .ec-date-trigger').forEach(button=>{if(button!==trigger)button.click();});
      let value=parseDate(input.value) || todayLocal();
      const lim=limits(input);
      if(lim.max && iso(value.y,value.m,value.d)>input.max)value=lim.max;
      if(lim.min && iso(value.y,value.m,value.d)<input.min)value=lim.min;
      viewYear=value.y;viewMonth=value.m;
      buildYears();render();pop.hidden=false;wrap.classList.add('is-open');trigger.setAttribute('aria-expanded','true');
      position();(grid.querySelector('button.is-selected:not(:disabled)') || grid.querySelector('button:not(:disabled)') || month).focus();
    };
    trigger.addEventListener('click',()=>pop.hidden?open():close());
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','Enter',' '].includes(e.key)){e.preventDefault();if(pop.hidden)open();}else if(e.key==='Escape')close();});
    prev.addEventListener('click',()=>{const p=offset(-1);if(!prev.disabled){viewYear=p.y;viewMonth=p.m;render();}});
    next.addEventListener('click',()=>{const p=offset(1);if(!next.disabled){viewYear=p.y;viewMonth=p.m;render();}});
    month.addEventListener('change',()=>{viewMonth=Number(month.value);render();});
    year.addEventListener('change',()=>{viewYear=Number(year.value);render();});
    today.addEventListener('click',()=>{const n=todayLocal();choose(iso(n.y,n.m,n.d));});
    clear.addEventListener('click',()=>{if(input.disabled || input.readOnly)return;const changed=Boolean(input.value);input.value='';sync();close(true);if(changed){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}});
    dismiss.addEventListener('click',()=>close(true));
    pop.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close(true);return;}
      if(event.key==='Tab'){
        const focusable=[...pop.querySelectorAll('button:not([disabled]),select:not([disabled])')];
        if(!focusable.length)return;
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    // Capture Escape when focus is inside a native month/year <select>.
    window.addEventListener('keydown',event=>{if(event.key==='Escape' && !pop.hidden){event.preventDefault();close(true);}},true);
    document.addEventListener('pointerdown',event=>{if(!wrap.contains(event.target) && !pop.contains(event.target))close();});
    window.addEventListener('resize',()=>{if(!pop.hidden)position();});
    document.addEventListener('scroll',()=>{if(!pop.hidden)position();},true);
    input.addEventListener('input',sync);input.addEventListener('change',sync);
    input.addEventListener('esoria:paper-date-sync',sync);
    input.addEventListener('invalid',()=>{trigger.setAttribute('aria-invalid','true');trigger.focus();});
    if(typeof MutationObserver!=='undefined')new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled','readonly','min','max','required']});
    window.addEventListener('pageshow',sync);window.addEventListener('load',sync,{once:true});sync();
  }
}
