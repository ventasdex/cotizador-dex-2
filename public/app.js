const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n)||0);
let concepts = [];
let currentDexi = null;
let coverData = '';

const modal = $('modalBackdrop');
const body = $('modalBody');
const showModal = html => { body.innerHTML = html; modal.classList.remove('hidden'); };
const hideModal = () => modal.classList.add('hidden');
$('modalClose').onclick = hideModal;
modal.addEventListener('click', e => { if(e.target===modal) hideModal(); });

function toast(text){
  const el=document.createElement('div'); el.className='toast'; el.textContent=text; document.body.appendChild(el);
  setTimeout(()=>el.remove(),2200);
}

function quoteData(){
  return {
    client:$('client').value.trim(), contact:$('contact').value.trim(), whatsapp:$('whatsapp').value.trim(), email:$('email').value.trim(), validity:$('validity').value,
    title:$('title').value.trim(), presentation:$('presentation').value.trim(), objectives:$('objectives').value.trim(), benefit:$('benefit').value.trim(), audience:$('audience').value.trim(), temario:$('temario').value.trim(), considerations:$('considerations').value.trim(), notes:$('notes').value.trim(),
    discount:Number($('discount').value)||0, iva:Number($('iva').value)||0, concepts:concepts.map(x=>({...x})), coverData
  };
}

function applyData(p){
  ['client','contact','whatsapp','email','validity','title','presentation','objectives','benefit','audience','temario','considerations','notes','discount','iva'].forEach(k=>{ if(p[k]!==undefined && $(k)) $(k).value=p[k]; });
  concepts=Array.isArray(p.concepts)?p.concepts:[];
  coverData=p.coverData||'';
  if(coverData){$('coverPreview').style.backgroundImage=`url(${coverData})`; $('coverPreview').textContent='';}
  renderConcepts();
}

function renderConcepts(){
  const tbody=$('conceptRows'); tbody.innerHTML='';
  $('emptyConcepts').classList.toggle('hidden',concepts.length>0);
  concepts.forEach((c,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><input data-i="${i}" data-k="service" value="${escapeHtml(c.service||'')}"></td><td><input data-i="${i}" data-k="duration" value="${escapeHtml(c.duration||'')}"></td><td><input data-i="${i}" data-k="price" type="number" value="${Number(c.price)||0}"></td><td><b>${money((Number(c.price)||0)*(Number(c.qty)||1))}</b></td><td><button class="del" data-del="${i}">×</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',e=>{ const i=+e.target.dataset.i,k=e.target.dataset.k; concepts[i][k]=k==='price'?Number(e.target.value):e.target.value; renderConcepts(); }));
  tbody.querySelectorAll('[data-del]').forEach(btn=>btn.onclick=()=>{concepts.splice(+btn.dataset.del,1);renderConcepts();});
  updateTotals();
}
function escapeHtml(s=''){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
function updateTotals(){
  const subtotal=concepts.reduce((s,c)=>s+(Number(c.price)||0)*(Number(c.qty)||1),0);
  const disc=Number($('discount').value)||0, iva=Number($('iva').value)||0;
  const total=subtotal*(1-disc/100)*(1+iva/100);
  $('subtotal').textContent=money(subtotal); $('total').textContent=money(total);
}
$('discount').addEventListener('input',updateTotals); $('iva').addEventListener('input',updateTotals);

function addConcept(c={}){ concepts.push({service:c.service||$('title').value||'Servicio DEX',duration:c.duration||'',price:Number(c.price)||0,qty:1}); renderConcepts(); }
$('addConcept').onclick=()=>addConcept();

async function api(url,opts={}){ const r=await fetch(url,opts); if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||'Error de conexión'); return r.json(); }

async function loadQuickCatalog(){
  const rows=await api('/api/catalog?q=SPC');
  const unique=[]; const seen=new Set();
  for(const r of rows){ if(r.tipo!=='empresa'||seen.has(r.curso))continue; seen.add(r.curso); unique.push(r); if(unique.length>=4)break; }
  $('quickCatalog').innerHTML=unique.map((r,i)=>`<button class="chip" data-qc="${i}">＋ ${escapeHtml(r.curso)} · ${money(r.presencial||r.online)}</button>`).join('');
  $('quickCatalog').querySelectorAll('[data-qc]').forEach(btn=>btn.onclick=()=>{ const r=unique[+btn.dataset.qc]; addConcept({service:r.curso,duration:r.horas?`${r.horas} h`:'',price:r.presencial||r.online}); });
}
loadQuickCatalog().catch(()=>{});

function courseTextBasics(title){
  return {
    presentation:`DEX México presenta un entrenamiento enfocado en ${title}, diseñado para fortalecer la aplicación práctica de conocimientos y herramientas en el entorno de trabajo.`,
    objectives:`Comprender los fundamentos y criterios de aplicación de ${title}.\nAplicar herramientas y conceptos mediante ejercicios y casos prácticos.\nIdentificar oportunidades de mejora y criterios para su implementación en la organización.`,
    benefit:`Fortalecer las competencias técnicas del personal, mejorar la estandarización de procesos y facilitar la aplicación práctica de los conocimientos en situaciones reales.`,
    audience:`Personal técnico, supervisores, coordinadores, líderes de área y colaboradores involucrados en los procesos relacionados con ${title}.`
  };
}

async function searchTemplate(q){
  if(!q.trim()) return toast('Escribe primero el curso o servicio.');
  const rows=await api('/api/library?q='+encodeURIComponent(q));
  if(!rows.length) return toast('No encontré un temario similar en la biblioteca DEX.');
  showModal(`<h2>Biblioteca DEX</h2><p class="modal-sub">Selecciona el temario que quieres usar como base.</p><div class="list">${rows.slice(0,10).map((r,i)=>`<div class="list-item" data-lib="${i}"><b>${escapeHtml(r.title)}</b><small>Coincidencia ${(Number(r.score||0)*100).toFixed(0)}% · ${r.temario.length.toLocaleString()} caracteres</small></div>`).join('')}</div>`);
  body.querySelectorAll('[data-lib]').forEach(el=>el.onclick=()=>{ const r=rows[+el.dataset.lib]; $('title').value=r.title; $('temario').value=r.temario; const t=courseTextBasics(r.title); Object.entries(t).forEach(([k,v])=>$(k).value=v); $('templateHint').innerHTML=`✓ Temario DEX aplicado: <b>${escapeHtml(r.title)}</b>`; $('templateHint').classList.remove('hidden'); hideModal(); toast('Temario DEX aplicado'); });
}
$('findTemplate').onclick=()=>searchTemplate($('title').value);

$('openDexi').onclick=()=>{
  showModal(`<div class="dexi-head"><h2>✦ DEXI</h2><p>Asistente comercial sin API de pago · usa biblioteca, matriz e históricos DEX.</p></div>
  <p>Cuéntame qué servicio o capacitación necesita el cliente. DEXI buscará un temario real y referencias de precio.</p>
  <div class="dexi-input"><textarea id="dexiQuery" placeholder="Ej. Necesito cotizar SPC presencial de 8 horas para 15 participantes"></textarea><button class="btn btn-dexi" id="dexiGo">Analizar</button></div><div id="dexiResult"></div>`);
  $('dexiGo').onclick=runDexi;
};

async function runDexi(){
  const query=$('dexiQuery').value.trim(); if(!query)return;
  const target=$('dexiResult'); target.innerHTML='<p>Buscando en los datos DEX…</p>';
  try{
    currentDexi=await api('/api/dexi/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    const d=currentDexi, m=d.match, p=d.price;
    target.innerHTML=`
      <div class="result-card"><h3>Temario</h3>${m?`<span class="pill">Coincidencia ${(m.score*100).toFixed(0)}%</span><b>${escapeHtml(m.title)}</b><p>${escapeHtml(m.temario.slice(0,450))}${m.temario.length>450?'…':''}</p>`:'<p>No encontré una coincidencia suficientemente clara. Puedes preparar un prompt profesional para ChatGPT.</p>'}</div>
      <div class="result-card"><h3>Precio</h3>${p.suggested?`<div class="price-big">${money(p.suggested)} + IVA</div><span class="pill">Confianza ${p.confidence}</span><p>Rango sugerido: <b>${money(p.min)} – ${money(p.max)}</b></p>${p.matrix?`<p>Matriz DEX: ${escapeHtml(p.matrix.course)} · ${money(p.matrix.adjustedPrice)}</p>`:''}${p.historicalMedian?`<p>Mediana histórica comparable: ${money(p.historicalMedian)} · ${p.comparables.length} referencia(s)</p>`:''}`:'<p>Aún no hay suficiente información para recomendar un precio automático.</p>'}</div>
      <div class="modal-actions">${m?'<button class="btn btn-primary" id="applyDexi">Aplicar a cotización</button>':''}${p.suggested?'<button class="btn btn-light" id="applyPrice">Aplicar solo precio</button>':''}<button class="btn btn-light" id="copyPrompt">Copiar prompt para ChatGPT</button></div>`;
    if($('applyDexi')) $('applyDexi').onclick=()=>{ applyDexiAll(); hideModal(); };
    if($('applyPrice')) $('applyPrice').onclick=()=>{ applyDexiPrice(); hideModal(); };
    $('copyPrompt').onclick=async()=>{ await navigator.clipboard.writeText(d.prompt); toast('Prompt copiado'); };
  }catch(e){target.innerHTML=`<p>${escapeHtml(e.message)}</p>`;}
}

function applyDexiAll(){
  const d=currentDexi;if(!d)return;
  if(d.match){ $('title').value=d.match.title; $('temario').value=d.match.temario; const t=courseTextBasics(d.match.title); Object.entries(t).forEach(([k,v])=>$(k).value=v); }
  applyDexiPrice(); toast('DEXI aplicó temario y referencia de precio');
}
function applyDexiPrice(){
  const d=currentDexi;if(!d?.price?.suggested)return;
  const hours=d.parsed.hours||d.match?.durationHours||d.price.matrix?.hours;
  addConcept({service:d.match?.title||$('title').value||'Servicio DEX',duration:hours?`${hours} h`:'',price:d.price.suggested});
  $('priceHint').innerHTML=`Precio sugerido por DEXI: <b>${money(d.price.suggested)} + IVA</b> · rango ${money(d.price.min)}–${money(d.price.max)} · confianza ${d.price.confidence}.`;
  $('priceHint').classList.remove('hidden');
}

$('suggestPrice').onclick=async()=>{
  const title=$('title').value.trim(); if(!title)return toast('Escribe primero el curso o servicio.');
  const hours=(concepts[0]?.duration||'').match(/\d+(?:\.\d+)?/)?.[0];
  currentDexi=await api('/api/dexi/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`${title}${hours?` ${hours} horas`:''}`})});
  const p=currentDexi.price;
  if(!p.suggested)return toast('No hay suficientes referencias para sugerir precio.');
  $('priceHint').innerHTML=`DEXI recomienda <b>${money(p.suggested)} + IVA</b>. Rango: ${money(p.min)}–${money(p.max)} · confianza ${p.confidence}. <button class="mini-btn" id="useSuggested">Usar precio</button>`;
  $('priceHint').classList.remove('hidden'); $('useSuggested').onclick=applyDexiPrice;
};

async function openCatalog(){
  showModal(`<h2>Catálogo DEX</h2><p class="modal-sub">Matriz de precios cargada desde tus históricos internos.</p><div class="inline"><input id="modalSearch" placeholder="Buscar curso..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="modalList" class="list" style="margin-top:14px"></div>`);
  const load=async()=>{const rows=await api('/api/catalog?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,25).map((r,i)=>`<div class="list-item" data-row="${i}"><b>${escapeHtml(r.curso)}</b><small>${r.tipo} · ${r.horas||'—'} h · Online ${money(r.online)} · Presencial ${money(r.presencial)}</small></div>`).join('');$('modalList').querySelectorAll('[data-row]').forEach(el=>el.onclick=()=>{const r=rows[+el.dataset.row];addConcept({service:r.curso,duration:r.horas?`${r.horas} h`:'',price:r.presencial||r.online});hideModal();});};
  $('modalSearchGo').onclick=load; $('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();}); await load();
}
async function openLibrary(){showModal(`<h2>Biblioteca DEX</h2><p class="modal-sub">Temarios extraídos del compendio DEX.</p><div class="inline"><input id="modalSearch" placeholder="Buscar temario..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="modalList" class="list" style="margin-top:14px"></div>`);const load=async()=>{const rows=await api('/api/library?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,25).map((r,i)=>`<div class="list-item" data-row="${i}"><b>${escapeHtml(r.title)}</b><small>${r.modules?.length||0} módulos · ${r.temario.length.toLocaleString()} caracteres</small></div>`).join('');$('modalList').querySelectorAll('[data-row]').forEach(el=>el.onclick=()=>{const r=rows[+el.dataset.row];$('title').value=r.title;$('temario').value=r.temario;Object.entries(courseTextBasics(r.title)).forEach(([k,v])=>$(k).value=v);hideModal();toast('Temario aplicado');});};$('modalSearchGo').onclick=load;$('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();});await load();}
async function openHistory(){showModal(`<h2>Históricos 2025</h2><p class="modal-sub">Importes facturados que DEXI usa como referencia comercial.</p><div class="inline"><input id="modalSearch" placeholder="Buscar curso o servicio..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="modalList" class="list" style="margin-top:14px"></div>`);const load=async()=>{const rows=await api('/api/history?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,30).map(r=>`<div class="list-item"><b>${escapeHtml(r.entrenamiento)}</b><small>${escapeHtml(r.cliente)} · ${r.horas||'—'} h · ${money(r.importe)} · ${r.fechaFacturacion||''}</small></div>`).join('');};$('modalSearchGo').onclick=load;$('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();});await load();}

document.querySelector('[data-action="catalog"]').onclick=openCatalog;document.querySelector('[data-action="library"]').onclick=openLibrary;document.querySelector('[data-action="history"]').onclick=openHistory;

$('coverInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{coverData=r.result;$('coverPreview').style.backgroundImage=`url(${coverData})`;$('coverPreview').textContent='';};r.readAsDataURL(f);});

function previewHtml(){
  const p=quoteData(); const subtotal=concepts.reduce((s,c)=>s+(Number(c.price)||0),0), total=subtotal*(1-p.discount/100)*(1+p.iva/100);
  const sec=(h,v)=>v?`<div class="preview-section"><h3>${h}</h3><div style="white-space:pre-wrap;line-height:1.55">${escapeHtml(v)}</div></div>`:'';
  return `<div class="preview-paper"><h1>DEX México</h1><p>Propuesta comercial</p><hr><h2>${escapeHtml(p.title||'Propuesta de servicio')}</h2><p><b>Cliente:</b> ${escapeHtml(p.client||'—')} &nbsp; <b>Contacto:</b> ${escapeHtml(p.contact||'—')}</p>${sec('Presentación',p.presentation)}${sec('Objetivos',p.objectives)}${sec('Función / beneficio principal',p.benefit)}${sec('Dirigido a',p.audience)}${sec('Desarrollo del tema',p.temario)}${sec('Consideraciones',p.considerations)}${sec('Notas',p.notes)}<div class="preview-section"><h3>Inversión</h3><table class="preview-table"><thead><tr><th>Servicio</th><th>Duración</th><th>Precio</th></tr></thead><tbody>${concepts.map(c=>`<tr><td>${escapeHtml(c.service)}</td><td>${escapeHtml(c.duration||'')}</td><td>${money(c.price)}</td></tr>`).join('')}</tbody></table><div class="preview-total">Total: ${money(total)}</div></div><div class="modal-actions"><button class="btn btn-primary" id="pdfBtn">Descargar PDF</button><button class="btn btn-light" id="docxBtn">Descargar Word editable</button><button class="btn btn-light" id="backEdit">← Seguir editando</button></div></div>`;
}
function openPreview(){showModal(previewHtml());$('backEdit').onclick=hideModal;$('pdfBtn').onclick=()=>downloadExport('/api/export/pdf','pdf');$('docxBtn').onclick=()=>downloadExport('/api/export/docx','docx');}
$('previewBtn').onclick=openPreview;$('generateBtn').onclick=openPreview;
async function downloadExport(url,ext){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(quoteData())});if(!r.ok)return toast('No fue posible generar el archivo.');const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Propuesta_DEX.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

$('saveDraft').onclick=()=>{localStorage.setItem('dex_quote_draft',JSON.stringify(quoteData()));toast('Borrador guardado en este dispositivo');};
$('clearBtn').onclick=()=>{if(!confirm('¿Limpiar toda la cotización?'))return;localStorage.removeItem('dex_quote_draft');location.reload();};
const saved=localStorage.getItem('dex_quote_draft');if(saved){try{applyData(JSON.parse(saved));toast('Borrador recuperado');}catch{}}
renderConcepts();
