/* ESORIA: public records only; no authentication or App Check required. */
(() => {
 'use strict';
 const kind=document.body.dataset.workspace;
 const previewLocal = ['127.0.0.1','localhost'].includes(location.hostname) && location.port === '5000' && window.ESORIA_RUNTIME_CONFIG?.demoEmulator === true;
 const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const box=(heading,message,extra='')=>`<div class="cf-empty" role="status"><h3>${esc(heading)}</h3><p>${esc(message)}</p>${extra}</div>`;
 const errorBox=(heading)=>box(heading,'Layanan arsip sedang mengalami kendala. Ini bukan berarti hasil sudah atau belum diumumkan.','<button type="button" class="cf-button" data-public-retry>Coba lagi</button> <a class="cf-public-help" href="legal/contact.html">Bantuan</a>');
 const monthWib=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}`;};
 async function getPublic(data){
  const url=new URL('/api/public',location.origin);
  Object.entries(data).forEach(([k,v])=>url.searchParams.set(k,String(v??'')));
  const control=new AbortController();const timer=setTimeout(()=>control.abort(),16000);
  try{
   const response=await fetch(url,{method:'GET',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:control.signal});
   const result=await response.json().catch(()=>null);
   if(!response.ok || !result || result.ok!==true){const e=new Error('Layanan publik belum tersedia.');e.status=response.status;throw e;}
   return result.data;
  }finally{clearTimeout(timer);}
 }
 function results(){
  const form=document.querySelector('#scope-form'), panel=document.querySelector('#public-results');if(!form||!panel)return;
  const archivePanel=document.querySelector('#results-archive');
  form.elements.periodId.value=monthWib();form.elements.periodId.dispatchEvent(new Event('input',{bubbles:true}));let seq=0;
  const submit=form.querySelector('[type=submit]');
  const onFilterEdited=()=>{
   // Invalidate any in-flight request, even if the visitor does not submit again.
   // Otherwise a response for the old scope could appear under newly selected filters.
   ++seq;
   if(submit)submit.disabled=false;
   panel.innerHTML=box('Filter telah berubah.','Tekan Tampilkan untuk memeriksa hasil sesuai pilihan terbaru.');
  };
  form.addEventListener('input',onFilterEdited);
  form.addEventListener('change',onFilterEdited);
  async function load(){
   const current=++seq,data=Object.fromEntries(new FormData(form));
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.periodId)||!['web','cyber','team'].includes(data.package)||!['wave-01','wave-02'].includes(data.wave)){
    if(submit)submit.disabled=false;
    panel.innerHTML=box('Pilihan belum lengkap.','Pilih periode, kategori, dan gelombang yang valid.');return;
   }
   if(submit)submit.disabled=true;
   panel.innerHTML=box('Memeriksa hasil resmi…','Mengambil arsip sesuai periode dan kategori yang dipilih.');
   try{
    const response=await getPublic({kind:'results',...data});if(current!==seq)return;
    if(!response?.published || (response?.demoFixture === true && !previewLocal)){panel.innerHTML=box('Belum ada hasil resmi yang diumumkan.','Hasil mungkin belum disahkan, belum mencapai jadwal pengumuman, atau tidak tersedia untuk pilihan ini.');return;}
    const rows=Array.isArray(response.rows)?response.rows:[];
    if(!rows.length){panel.innerHTML=box('Arsip resmi belum berisi peringkat.','Tidak ada entri peringkat yang dapat ditampilkan.');return;}
    const category=form.elements.package.selectedOptions[0]?.textContent||'Kompetisi';
    const wave=form.elements.wave.selectedOptions[0]?.textContent||data.wave;
    panel.innerHTML=`<div class="cf-section-head cf-results-heading"><div><span class="cf-kicker">${previewLocal?'Arsip hasil internal':'Arsip hasil resmi'}</span><h2>Hasil kompetisi yang diumumkan.</h2><p class="cf-meta">${esc(data.periodId)} · ${esc(category)} · ${esc(wave)}</p></div><span class="cf-tag green">TELAH DIUMUMKAN</span></div><div class="cf-table-wrap" role="region" aria-label="Hasil kompetisi resmi" tabindex="0"><table><thead><tr><th>Peringkat</th><th>Peserta / tim / tiket</th><th>Skor</th><th>Keterangan</th></tr></thead><tbody>${rows.map(i=>`<tr><td><strong>${esc(i.disqualified?'—':i.rank||'—')}</strong></td><td>${esc(i.displayName||'Tidak ditampilkan')}</td><td>${esc(i.disqualified?'—':i.total??'—')}</td><td><span class="cf-tag ${i.disqualified?'red':i.rank&&i.rank<=3?'green':''}">${i.disqualified?'Diskualifikasi':i.rank&&i.rank<=3?'Pemenang':'Peserta tervalidasi'}</span></td></tr>`).join('')}</tbody></table></div><p class="cf-meta">${previewLocal?'Data peninjauan internal, bukan keputusan lomba resmi.':'Hasil resmi mengikuti keputusan panitia saat publikasi.'}</p>`;
   }catch(e){if(current!==seq)return;console.warn('Arsip hasil ESORIA tidak tersedia:',e?.status||e?.name);panel.innerHTML=errorBox('Arsip belum bisa diperiksa.');}
   finally{if(current===seq&&submit)submit.disabled=false;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();void load();});
  panel.addEventListener('click',e=>{if(e.target.closest('[data-public-retry]'))void load();});
  // The archive endpoint exposes only published/announced scopes; the server
  // still checks each selected scope independently when its rows are fetched.
  async function bootstrapArchive(){
   try{
    const archive=await getPublic({kind:'archive'});
    const items=Array.isArray(archive?.items)?archive.items.filter((x)=>
      /^\d{4}-(0[1-9]|1[0-2])$/.test(x.periodId)&&['web','cyber','team'].includes(x.package)&&['wave-01','wave-02'].includes(x.wave)):[];
    if(!items.length){archivePanel.innerHTML='';void load();return;}
    const label={web:'Website Programming',cyber:'Cybersecurity Mini CTF',team:'Full Stack Development Team'};
    const title=previewLocal?'Pilihan hasil yang tersedia':'Arsip hasil yang telah diumumkan';
    archivePanel.innerHTML=`<h2 class="cf-archive-heading">${title}</h2><p class="cf-archive-help">Pilih periode, kategori, dan gelombang untuk melihat peringkat.</p><div class="cf-archive-grid">${items.map((x,i)=>`<button type="button" class="cf-archive-scope" data-archive-index="${i}" aria-pressed="false"><span>${esc(x.periodId)} · ${esc(x.wave==='wave-01'?'Awal bulan':'Pertengahan bulan')}</span><strong>${esc(label[x.package])}</strong></button>`).join('')}</div>${previewLocal?'<p class="cf-archive-note">Data peninjauan internal, bukan pengumuman pemenang resmi.</p>':''}`;
    const query=new URLSearchParams(location.search);
    const selected=items.find((x)=>x.periodId===query.get('periodId')&&x.package===query.get('package')&&x.wave===query.get('wave'))||items[0];
    const select=(x)=>{
     form.elements.periodId.value=x.periodId;
     form.elements.package.value=x.package;
     form.elements.wave.value=x.wave;
     form.elements.periodId.dispatchEvent(new Event('input',{bubbles:true}));
     const all=archivePanel.querySelectorAll?.('[data-archive-index]')||[];
     all.forEach((button)=>button.setAttribute('aria-pressed',String(items[Number(button.dataset.archiveIndex)]===x)));
     void load();
    };
    archivePanel.addEventListener('click',(e)=>{
     const button=e.target.closest('[data-archive-index]');
     if(!button)return;
     const x=items[Number(button.dataset.archiveIndex)];
     if(x)select(x);
    });
    select(selected);
   }catch(error){
    console.warn('Daftar arsip ESORIA tidak dapat dibaca:',error?.status||error?.name);
    archivePanel.innerHTML='<p class="cf-archive-help">Daftar periode belum tersedia; gunakan filter manual di bawah.</p>';
    void load();
   }
  }
  if(archivePanel)void bootstrapArchive();else void load();
 }
 function certificates(){
  const form=document.querySelector('#verify-certificate-form'),panel=document.querySelector('#certificate-verdict');if(!form||!panel)return;
  let requestSequence=0;
  const submit=form.querySelector('[type=submit]');
  const onIdEdited=()=>{
   // Revocation lookup is bound to the exact ID shown at request time.
   ++requestSequence;
   if(submit)submit.disabled=false;
   panel.innerHTML=box('ID sertifikat berubah.','Tekan Periksa status untuk memverifikasi ID terbaru.');
  };
  form.addEventListener('input',onIdEdited);
  form.addEventListener('change',onIdEdited);
  async function load(){
   const current=++requestSequence;
   const id=String(form.elements.certificateId.value||'').trim().toLowerCase();
   if(!/^[a-f0-9]{32}$/.test(id)){
    if(submit)submit.disabled=false;
    panel.innerHTML=box('ID belum valid.','Gunakan 32 karakter ID pada sertifikat.');return;
   }
   if(submit)submit.disabled=true;
   panel.innerHTML=box('Memeriksa sertifikat…','Memeriksa status dokumen resmi.');
   try{
    const d=await getPublic({kind:'certificate',certificateId:id});
    if(current!==requestSequence)return;
    // Fail closed if an older API still serves a synthetic record.
    if (d?.demoFixture === true && !previewLocal) {panel.innerHTML=box('ID tidak ditemukan.','Hanya sertifikat resmi yang telah diterbitkan yang dapat diverifikasi.');return;}
    const labels={valid:'Sertifikat berlaku.',revoked:'Sertifikat telah dicabut.',withdrawn:'Hasil sedang ditarik.',not_found:'ID tidak ditemukan.'};
    const issuedAt=Number(d?.issuedAt);const when=d?.issuedAt!=null&&Number.isFinite(issuedAt)&&issuedAt>0?new Date(issuedAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}):'Belum tercatat';
    panel.innerHTML=`<div class="cf-verdict" data-valid="${d?.valid===true}">${esc(labels[d?.status]||'Status belum tersedia.')}</div>${d?.recipient?`<dl class="cf-facts"><div><dt>Penerima</dt><dd>${esc(d.recipient)}</dd></div><div><dt>Kategori</dt><dd>${esc(d.category)}</dd></div><div><dt>Periode</dt><dd>${esc(d.period)} · ${esc(d.wave)}</dd></div><div><dt>Terbit</dt><dd>${esc(when)}</dd></div></dl>`:'<p>Periksa kembali ID pada dokumen asli.</p>'}`;
   }catch(e){if(current!==requestSequence)return;console.warn('Verifikasi sertifikat ESORIA tidak tersedia:',e?.status||e?.name);panel.innerHTML=errorBox('Verifikasi belum berhasil.');}
   finally{if(current===requestSequence&&submit)submit.disabled=false;}
  }
  form.addEventListener('submit',e=>{e.preventDefault();void load();});
  panel.addEventListener('click',e=>{if(e.target.closest('[data-public-retry]'))void load();});
  const q=new URLSearchParams(location.search).get('id');if(/^[a-f0-9]{32}$/.test(q||'')){form.elements.certificateId.value=q;void load();}
 }
 if(kind==='results')results();if(kind==='verify')certificates();
})();
