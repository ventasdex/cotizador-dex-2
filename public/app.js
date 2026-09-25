const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n)||0);
let concepts = [];
let currentDexi = null;
let coverData = '';
let selectedTemplate = 'A';
let currentQuoteRecord = null;

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

function standardConsiderations(min='', max=''){
  const range = min && max ? `${min} a ${max}` : min ? `${min}` : max ? `hasta ${max}` : '_ a _';
  return [
    'El equipo profesional involucrado estará integrado por especialistas con experiencia en el tema.',
    'Se entregará material del curso a cada participante.',
    'Se entrega DC-3 de la STPS y Certificado de participación.',
    `Los precios están dados para un grupo de ${range} participantes.`,
    'Las sesiones de entrenamiento se definen de acuerdo con la disponibilidad de las partes.',
    'Las fechas acordadas serán flexibles siempre que los cambios se notifiquen con al menos 15 días hábiles de anticipación.',
    'La presente cotización queda sujeta a las políticas publicadas en https://www.dexmexico.com/politicas.',
    'DEX México se compromete a mantener la confidencialidad de la información obtenida del cliente.',
    'Salvo que el Cliente manifieste expresamente y por escrito su negativa, la aceptación de la presente cotización autoriza a DEX Knowledge & Development México a utilizar el nombre comercial y/o logotipo del Cliente como referencia comercial, así como a realizar registros fotográficos y/o audiovisuales durante las sesiones de capacitación, para fines de evidencia de impartición, comunicación institucional, mercadotecnia y difusión de los servicios de DEX.'
  ].join('\n');
}
function syncStandardConsiderations(force=false){
  const box=$('considerations'); if(!box)return;
  const min=$('participantsMin')?.value||'', max=$('participantsMax')?.value||'';
  const current=box.value.trim();
  if(force || !current || current.includes('Los precios están dados para un grupo de _ a _ participantes.') || current.includes('Los precios están dados para un grupo de hasta ')) box.value=standardConsiderations(min,max);
  else {
    box.value=current.replace(/Los precios están dados para un grupo de .*? participantes\./, standardConsiderations(min,max).split('\n')[3]);
  }
}

function quoteData(){
  return {
    client:$('client').value.trim(), contact:$('contact').value.trim(), whatsapp:$('whatsapp').value.trim(), email:$('email').value.trim(), validity:$('validity').value,
    clientRequest:$('clientRequest')?.value.trim() || '',
    title:$('title').value.trim(), modality:$('modality').value, durationTotal:$('durationTotal').value.trim(), participants:$('participants').value.trim(), participantsMin:$('participantsMin')?.value.trim()||'', participantsMax:$('participantsMax')?.value.trim()||'', accreditation:$('accreditation').value.trim(),
    presentation:$('presentation').value.trim(), objectives:$('objectives').value.trim(), benefit:$('benefit').value.trim(), audience:$('audience').value.trim(), temario:$('temario').value.trim(), considerations:$('considerations').value.trim(), notes:$('notes').value.trim(),
    discount:Number($('discount').value)||0, iva:Number($('iva').value)||0, concepts:concepts.map(x=>({...x})), coverData, template:selectedTemplate, status:currentQuoteRecord?.estado || 'Borrador', historyId:currentQuoteRecord?.id || null, folio:currentQuoteRecord?.folio || null
  };
}

function applyData(p){
  ['client','contact','whatsapp','email','validity','clientRequest','title','modality','durationTotal','participants','participantsMin','participantsMax','accreditation','presentation','objectives','benefit','audience','temario','considerations','notes','discount','iva'].forEach(k=>{ if(p[k]!==undefined && $(k)) $(k).value=p[k]; });
  concepts=Array.isArray(p.concepts)?p.concepts:[];
  coverData=p.coverData||'';
  selectedTemplate=p.template||'A';
  if(p.historyId || p.id || p.folio) currentQuoteRecord={id:p.historyId||p.id||null,folio:p.folio||null,estado:p.status||p.estado||'Borrador'};
  if(coverData){$('coverPreview').style.backgroundImage=`url(${coverData})`; $('coverPreview').textContent='';}
  if(!$('considerations').value.trim()) syncStandardConsiderations(true);
  else if(($('participantsMin')?.value||$('participantsMax')?.value)) syncStandardConsiderations();
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
  const gross=concepts.reduce((s,c)=>s+(Number(c.price)||0)*(Number(c.qty)||1),0);
  const disc=Number($('discount').value)||0, iva=Number($('iva').value)||0;
  const subtotal=gross*(1-disc/100);
  const ivaAmount=subtotal*(iva/100);
  const total=subtotal+ivaAmount;
  $('subtotal').textContent=money(subtotal); if($('ivaAmount')) $('ivaAmount').textContent=money(ivaAmount); $('total').textContent=money(total);
}
$('discount').addEventListener('input',updateTotals); $('iva').addEventListener('input',updateTotals);
if($('participantsMin')) $('participantsMin').addEventListener('input',()=>syncStandardConsiderations());
if($('participantsMax')) $('participantsMax').addEventListener('input',()=>syncStandardConsiderations());

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

function openDexi(initialText=''){
  const request = initialText || $('clientRequest')?.value.trim() || '';
  showModal(`<div class="dexi-head"><h2>✦ DEXI</h2><p>Convierte lo que pidió el cliente en una propuesta profesional usando la biblioteca DEX, históricos y Gemini.</p></div>
  <p><b>Cuéntame qué solicitó el cliente.</b> Puedes escribirlo como te lo dijeron por teléfono, WhatsApp o correo.</p>
  <div class="dexi-input"><textarea id="dexiQuery" placeholder="Ej. El cliente necesita un curso de solución de problemas...">${escapeHtml(request)}</textarea><button class="btn btn-dexi" id="dexiGo">✦ Construir propuesta</button></div>
  <div id="dexiResult"><div class="dexi-workflow"><div class="dexi-step"><span class="dexi-step-num">1</span><div><b>Entender solicitud</b><small>Duración, modalidad, participantes y necesidad.</small></div></div><div class="dexi-step"><span class="dexi-step-num">2</span><div><b>Consultar DEX</b><small>Temarios, matriz de precios e históricos.</small></div></div><div class="dexi-step"><span class="dexi-step-num">3</span><div><b>Generar propuesta</b><small>Gemini construye o adapta el contenido con las reglas técnicas de DEX.</small></div></div></div></div>`);
  $('dexiGo').onclick=runDexi;
}
$('openDexi').onclick=()=>openDexi();
if($('buildWithDexi')) $('buildWithDexi').onclick=()=>openDexi($('clientRequest').value);

function normalizeGeneratedTemario(value){
  if(typeof value==='string') return value;
  if(Array.isArray(value)) return value.map((m,i)=>{
    const title=m.title||m.modulo||`MÓDULO ${i+1}`;
    const items=m.items||m.temas||m.subtemas||[];
    return `${title}\n${(Array.isArray(items)?items:[]).map(x=>'- '+x).join('\n')}`;
  }).join('\n\n');
  return '';
}
function applyGeneratedProposal(g){
  if(g.title) $('title').value=g.title;
  if(g.presentation) $('presentation').value=g.presentation;
  const objectiveLines=[];
  if(g.objectiveGeneral) objectiveLines.push(`OBJETIVO GENERAL\n${g.objectiveGeneral}`);
  if(g.objectives){
    const list=Array.isArray(g.objectives)?g.objectives:[String(g.objectives)];
    if(list.length) objectiveLines.push(`OBJETIVOS ESPECÍFICOS\n${list.map(x=>'• '+x).join('\n')}`);
  }
  if(objectiveLines.length) $('objectives').value=objectiveLines.join('\n\n');
  if(g.benefit) $('benefit').value=g.benefit;
  if(g.audience) $('audience').value=g.audience;
  const tem=normalizeGeneratedTemario(g.temario); if(tem) $('temario').value=tem;
  syncStandardConsiderations(true);
  const extras=g.considerations?(Array.isArray(g.considerations)?g.considerations.filter(Boolean).join('\n'):String(g.considerations)):'';
  if(extras) $('considerations').value += '\n' + extras;
  if(g.notes) $('notes').value=g.notes;
  if(g.modality && ['presencial','online','hibrida'].includes(String(g.modality).toLowerCase())) $('modality').value=String(g.modality).toLowerCase();
  if(g.durationHours) $('durationTotal').value=`${g.durationHours} horas`;
  if(g.participants){ $('participants').value=`${g.participants} participantes`; if($('participantsMax')) $('participantsMax').value=g.participants; syncStandardConsiderations(); }
  toast('DEXI aplicó únicamente el contenido de la propuesta');
}

async function runDexi(){
  const query=$('dexiQuery').value.trim(); if(!query)return toast('Describe primero lo que pidió el cliente.');
  if($('clientRequest')) $('clientRequest').value=query;
  const target=$('dexiResult');
  target.innerHTML='<div class="result-card"><h3>DEXI está construyendo la propuesta…</h3><p>Estoy consultando referencias DEX y generando el contenido profesional. Puede tardar unos segundos.</p></div>';
  try{
    currentDexi=await api('/api/dexi/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    const d=currentDexi, m=d.match, p=d.price, g=d.generation;
    const detected=[d.parsed?.hours?`${d.parsed.hours} h`:null,d.parsed?.participants?`${d.parsed.participants} participantes`:null,d.parsed?.modality||null].filter(Boolean).join(' · ') || 'Datos por completar';
    const matchLabel=d.matchType==='direct'?'Coincidencia directa':d.matchType==='partial'?'Referencia parcial':'Tema nuevo';
    const matchHtml=m?`<span class="pill">${matchLabel} · ${(m.score*100).toFixed(0)}%</span><b>${escapeHtml(m.title)}</b><p>${d.matchType==='direct'?'DEXI utilizó esta referencia como base principal y la adaptó a la solicitud.':'DEXI la usó solo como orientación para evitar mezclar contenidos que no correspondan.'}</p>`:`<span class="pill">Tema nuevo</span><p>No encontré una referencia DEX suficientemente cercana. DEXI desarrolló el contenido desde cero.</p>`;
    const previewModules=Array.isArray(g?.temario)?g.temario.slice(0,4).map(x=>`<li><b>${escapeHtml(x.title||'Módulo')}</b> · ${(x.items||[]).length} temas</li>`).join(''):'';
    target.innerHTML=`
      <div class="result-card"><h3>Solicitud entendida</h3><span class="pill">${escapeHtml(detected)}</span></div>
      <div class="result-card"><h3>Referencia DEX</h3>${matchHtml}</div>
      <div class="result-card"><h3>Propuesta generada</h3><b>${escapeHtml(g.title||'Propuesta DEX')}</b><p>${escapeHtml(g.presentation||'')}</p>${previewModules?`<ul>${previewModules}</ul>`:''}<p><small>Generada con ${escapeHtml(d.ai?.provider||'IA')} · ${escapeHtml(d.ai?.model||'modelo disponible')}.</small></p></div>
      <div class="result-card"><h3>Precio DEXI</h3>${p.recommended?`
        <div class="price-options">
          <div class="price-option"><small>COMPETITIVO</small><b>${money(p.competitive)} + IVA</b><span>Prioriza facilidad de cierre</span><button class="mini-btn" data-price-tier="competitive">Usar</button></div>
          <div class="price-option featured"><small>RECOMENDADO</small><b>${money(p.recommended)} + IVA</b><span>Equilibrio entre mercado y margen</span><button class="mini-btn" data-price-tier="recommended">Usar</button></div>
          <div class="price-option"><small>PREMIUM</small><b>${money(p.premium)} + IVA</b><span>Mayor margen / especialización</span><button class="mini-btn" data-price-tier="premium">Usar</button></div>
        </div>
        <p><span class="pill">Confianza ${p.confidence}</span> · Rango comercial <b>${money(p.min)} – ${money(p.max)}</b></p>
        <p><b>Base:</b> ${escapeHtml(p.basis||'Referencias DEX')}</p>
        ${p.floor?`<p><b>Piso comercial DEX:</b> ${money(p.floor)} + IVA <small>· por debajo de este monto conviene revisar margen/autorización.</small></p>`:''}
        ${p.policyApplied?`<p class="price-policy-note"><small>Los comparables quedaron por debajo de la política comercial vigente; DEXI ajustó la recomendación para proteger posicionamiento y margen.</small></p>`:''}
        <div class="price-evidence-grid">
          <div class="price-evidence-card">
            <div class="evidence-title">Matriz DEX</div>
            ${p.matrixWeighted?`<div class="evidence-median">Referencia ponderada <b>${money(p.matrixWeighted)}</b>${p.matrixMedian?` · mediana simple ${money(p.matrixMedian)}`:''}</div>`:(p.matrixMedian?`<div class="evidence-median">Mediana comparable <b>${money(p.matrixMedian)}</b></div>`:'<div class="evidence-empty">Sin referencias de matriz suficientemente comparables.</div>')}
            ${Array.isArray(p.matrixComparables)&&p.matrixComparables.length?`<ul>${p.matrixComparables.slice(0,4).map(r=>`<li><span class="relevance-badge relevance-${escapeHtml(r.relevance||'contextual')}">${escapeHtml(r.relevanceLabel||'Contextual')}</span> ${escapeHtml(r.course)} <span>${r.hours||'—'} h · ${money(r.amount)} · peso ${Math.round((Number(r.weight)||0)*100)}%</span></li>`).join('')}</ul>`:''}
          </div>
          <div class="price-evidence-card">
            <div class="evidence-title">Operaciones históricas DEX</div>
            ${p.historicalWeighted?`<div class="evidence-median">Referencia ponderada <b>${money(p.historicalWeighted)}</b>${p.historicalMedian?` · mediana simple ${money(p.historicalMedian)}`:''} · ${p.historicalCount||p.historicalComparables?.length||0} referencia(s)</div>`:(p.historicalMedian?`<div class="evidence-median">Mediana real <b>${money(p.historicalMedian)}</b> · ${p.historicalCount||p.historicalComparables?.length||0} referencia(s)</div>`:'<div class="evidence-empty">Sin operaciones históricas suficientemente comparables.</div>')}
            ${Array.isArray(p.historicalComparables)&&p.historicalComparables.length?`<ul>${p.historicalComparables.slice(0,4).map(r=>`<li><span class="relevance-badge relevance-${escapeHtml(r.relevance||'contextual')}">${escapeHtml(r.relevanceLabel||'Contextual')}</span> ${escapeHtml(r.training)}${r.client?` <em>· ${escapeHtml(r.client)}</em>`:''} <span>${r.hours||'—'} h · ${money(r.amount)} · peso ${Math.round((Number(r.weight)||0)*100)}%</span></li>`).join('')}</ul>`:''}
          </div>
        </div>
      `:'<p>Aún no hay suficientes referencias internas para sugerir un precio automático.</p>'}</div>
      <div class="modal-actions"><button class="btn btn-dexi" id="applyAiProposal">✦ Aplicar propuesta completa</button><button class="btn btn-light" id="closeDexiReview">Revisar después</button></div>`;
    $('applyAiProposal').onclick=()=>{applyGeneratedProposal(g);hideModal();};
    target.querySelectorAll('[data-price-tier]').forEach(btn=>btn.onclick=()=>applyDexiPrice(btn.dataset.priceTier));
    $('closeDexiReview').onclick=hideModal;
  }catch(e){
    target.innerHTML=`<div class="result-card"><h3>No pude generar la propuesta</h3><p>${escapeHtml(e.message)}</p><p>DEXI ya realizó reintentos automáticos y, cuando aplica, probó el modelo alterno. Si Google está temporalmente saturado, espera unos minutos y vuelve a intentarlo.</p></div><div class="modal-actions"><button class="btn btn-dexi" id="retryDexi">Reintentar</button></div>`;
    if($('retryDexi')) $('retryDexi').onclick=runDexi;
  }
}

function applyDexiAll(){
  const d=currentDexi;if(!d)return;
  if(d.generation) return applyGeneratedProposal(d.generation);
  if(d.match){ $('title').value=d.match.title; $('temario').value=d.match.temario; const t=courseTextBasics(d.match.title); Object.entries(t).forEach(([k,v])=>$(k).value=v); }
  if(d.parsed?.modality) $('modality').value=d.parsed.modality==='online'?'online':d.parsed.modality==='presencial'?'presencial':'hibrida';
  if(d.parsed?.hours) $('durationTotal').value=`${d.parsed.hours} horas`;
  if(d.parsed?.participants){ $('participants').value=`${d.parsed.participants} participantes`; if($('participantsMax')) $('participantsMax').value=d.parsed.participants; syncStandardConsiderations(); }
  toast('DEXI aplicó únicamente el contenido de la propuesta');
}
function applyDexiPrice(tier='recommended'){
  const d=currentDexi;if(!d?.price?.recommended)return;
  const p=d.price;
  const price=Number(p[tier] || p.recommended || p.suggested);
  if(!price)return;
  const hours=d.parsed.hours||d.match?.durationHours||d.price.matrix?.hours;
  const labels={competitive:'Competitivo',recommended:'Recomendado',premium:'Premium'};
  addConcept({service:d.generation?.title||d.match?.title||$('title').value||'Servicio DEX',duration:hours?`${hours} h`:'',price});
  $('priceHint').innerHTML=`Precio ${labels[tier]||'Recomendado'} aplicado: <b>${money(price)} + IVA</b> · rango comercial ${money(p.min)}–${money(p.max)} · confianza ${p.confidence}.${p.floor?` Piso DEX: ${money(p.floor)}.`:''}`;
  $('priceHint').classList.remove('hidden');
  toast(`Precio ${labels[tier]||'Recomendado'} aplicado`);
}

$('suggestPrice').onclick=async()=>{
  const title=$('title').value.trim(); if(!title)return toast('Escribe primero el curso o servicio.');
  const hours=($('durationTotal').value||concepts[0]?.duration||'').match(/\d+(?:\.\d+)?/)?.[0];
  const mode=$('modality').value==='online'?' online':$('modality').value==='presencial'?' presencial':'';
  currentDexi=await api('/api/dexi/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`${title}${hours?` ${hours} horas`:''}${mode}`})});
  const p=currentDexi.price;
  if(!p.recommended)return toast('No hay suficientes referencias para sugerir precio.');
  $('priceHint').innerHTML=`DEXI propone: <b>Competitivo ${money(p.competitive)}</b> · <b>Recomendado ${money(p.recommended)}</b> · <b>Premium ${money(p.premium)}</b> + IVA · confianza ${p.confidence}. <button class="mini-btn" data-quick-tier="competitive">Usar competitivo</button> <button class="mini-btn" data-quick-tier="recommended">Usar recomendado</button> <button class="mini-btn" data-quick-tier="premium">Usar premium</button>`;
  $('priceHint').classList.remove('hidden');
  $('priceHint').querySelectorAll('[data-quick-tier]').forEach(btn=>btn.onclick=()=>applyDexiPrice(btn.dataset.quickTier));
};

async function openCatalog(){
  showModal(`<h2>Catálogo DEX</h2><p class="modal-sub">Matriz de precios cargada desde tus históricos internos.</p><div class="inline"><input id="modalSearch" placeholder="Buscar curso..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="modalList" class="list" style="margin-top:14px"></div>`);
  const load=async()=>{const rows=await api('/api/catalog?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,25).map((r,i)=>`<div class="list-item" data-row="${i}"><b>${escapeHtml(r.curso)}</b><small>${r.tipo} · ${r.horas||'—'} h · Online ${money(r.online)} · Presencial ${money(r.presencial)}</small></div>`).join('');$('modalList').querySelectorAll('[data-row]').forEach(el=>el.onclick=()=>{const r=rows[+el.dataset.row];addConcept({service:r.curso,duration:r.horas?`${r.horas} h`:'',price:r.presencial||r.online});hideModal();});};
  $('modalSearchGo').onclick=load; $('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();}); await load();
}
async function openLibrary(){showModal(`<h2>Biblioteca DEX</h2><p class="modal-sub">Temarios extraídos del compendio DEX.</p><div class="inline"><input id="modalSearch" placeholder="Buscar temario..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="modalList" class="list" style="margin-top:14px"></div>`);const load=async()=>{const rows=await api('/api/library?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,25).map((r,i)=>`<div class="list-item" data-row="${i}"><b>${escapeHtml(r.title)}</b><small>${r.modules?.length||0} módulos · ${r.temario.length.toLocaleString()} caracteres</small></div>`).join('');$('modalList').querySelectorAll('[data-row]').forEach(el=>el.onclick=()=>{const r=rows[+el.dataset.row];$('title').value=r.title;$('temario').value=r.temario;Object.entries(courseTextBasics(r.title)).forEach(([k,v])=>$(k).value=v);hideModal();toast('Temario aplicado');});};$('modalSearchGo').onclick=load;$('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load();});await load();}
function emergencyQuoteHistory(){ try{return JSON.parse(localStorage.getItem('dex_quote_emergency')||'[]');}catch{return [];} }
function saveEmergencyQuote(p, errorMessage=''){
  const rows=emergencyQuoteHistory(); const now=new Date();
  const folio=`PENDIENTE-${now.getFullYear()}-${String(Date.now()).slice(-6)}`;
  const subtotal=(p.concepts||[]).reduce((s,c)=>s+(Number(c.price)||0)*(Number(c.qty)||1),0); const total=subtotal*(1-(Number(p.discount)||0)/100)*(1+(Number(p.iva)||0)/100);
  const row={id:'pending-'+Date.now(),folio,created_at:now.toISOString(),cliente:p.client,titulo:p.title,estado:'Pendiente de sincronizar',monto_cotizado:total,solicitud_cliente:p.clientRequest,plantilla:p.template,data:{...p,folio,status:'Pendiente de sincronizar'},syncError:errorMessage};
  rows.unshift(row); localStorage.setItem('dex_quote_emergency',JSON.stringify(rows.slice(0,50))); return row;
}
async function saveQuoteToHistory(){
  const p=quoteData();
  if(!p.title && !p.clientRequest) return toast('Agrega la solicitud del cliente o el título de la propuesta.');
  try{
    const existingId = Number(currentQuoteRecord?.id);
    const isSharedExisting = Number.isFinite(existingId) && existingId > 0 && !String(currentQuoteRecord?.id).startsWith('pending-');
    const row=await api(isSharedExisting?`/api/quotes/${existingId}`:'/api/quotes',{method:isSharedExisting?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    currentQuoteRecord=row; localStorage.removeItem('dex_quote_draft'); toast(`✓ Cotización guardada en historial compartido: ${row.folio||'DEX'}`); return row;
  }catch(e){
    const row=saveEmergencyQuote(p,e.message||'Sin conexión con Supabase');
    currentQuoteRecord=null;
    toast(`⚠ NO se guardó en el historial compartido. Se conservó una copia de emergencia: ${row.folio}`);
    return null;
  }
}
async function loadSharedQuotes(q=''){
  try{
    const rows=await api('/api/quotes?q='+encodeURIComponent(q));
    return {rows,persistent:true,error:null,pending:emergencyQuoteHistory()};
  }catch(e){
    return {rows:[],persistent:false,error:e.message||'Sin conexión con Supabase',pending:emergencyQuoteHistory()};
  }
}
function renderGeneratedHistory(rows,persistent){
  if(!rows.length) return '<div class="empty-state"><b>Aún no hay cotizaciones guardadas</b><span>Cuando guardes una propuesta aparecerá aquí.</span></div>';
  return rows.map((r,i)=>`<div class="quote-history-item"><div><div class="folio">${escapeHtml(r.folio||'Sin folio')} ${persistent?'<span class="history-badge">Compartido</span>':'<span class="history-badge local">Pendiente</span>'}</div><div class="meta">${new Date(r.created_at||Date.now()).toLocaleDateString('es-MX')} · ${escapeHtml(r.estado||'Borrador')}</div></div><div><div class="title">${escapeHtml(r.titulo||'Propuesta sin título')}</div><div class="meta">${escapeHtml(r.cliente||'Sin cliente')}</div></div><div class="amount">${money(r.monto_cotizado||0)}</div><div class="quote-history-actions"><button data-openq="${i}">Abrir</button><button data-dupq="${i}">Duplicar</button></div></div>`).join('');
}
function renderPendingHistory(rows){
  if(!rows.length) return '';
  return `<div class="storage-note storage-warn"><b>${rows.length} copia(s) de emergencia sin sincronizar.</b> Estas cotizaciones NO son visibles para el resto del equipo hasta que se guarden correctamente en Supabase.</div>${renderGeneratedHistory(rows,false)}`;
}
async function openHistory(){
  showModal(`<h2>Histórico de cotizaciones</h2><p class="modal-sub">Cotizaciones generadas por el equipo y referencias comerciales anteriores.</p><div class="history-tabs"><button id="tabGenerated" class="active">Cotizaciones generadas</button><button id="tabLegacy">Referencias 2025</button></div><div class="inline" style="margin-top:12px"><input id="modalSearch" placeholder="Buscar folio, cliente o curso..."><button class="mini-btn" id="modalSearchGo">Buscar</button></div><div id="historyStatus" class="history-status"></div><div id="modalList" class="list" style="margin-top:12px"></div>`);
  let mode='generated';
  const loadGenerated=async()=>{
    mode='generated'; $('tabGenerated').classList.add('active'); $('tabLegacy').classList.remove('active');
    const result=await loadSharedQuotes($('modalSearch').value.trim());
    if(result.persistent){
      $('historyStatus').innerHTML='<div class="storage-note storage-ok">✓ Historial compartido conectado a Supabase. Todo lo guardado aquí es permanente y visible para el equipo.</div>';
      $('modalList').innerHTML=renderGeneratedHistory(result.rows,true)+(result.pending?.length?renderPendingHistory(result.pending):'');
      const combined=[...result.rows,...(result.pending||[])];
      $('modalList').querySelectorAll('[data-openq]').forEach((el,index)=>el.onclick=()=>{const r=combined[index];applyData(r.data||r);currentQuoteRecord=String(r.id||'').startsWith('pending-')?null:r;hideModal();toast(`Cotización ${r.folio||''} cargada`);});
      $('modalList').querySelectorAll('[data-dupq]').forEach((el,index)=>el.onclick=()=>{const r=combined[index];applyData(r.data||r);currentQuoteRecord=null;hideModal();toast('Cotización duplicada como nueva');});
    }else{
      $('historyStatus').innerHTML=`<div class="storage-note storage-error"><b>✕ Historial compartido sin conexión.</b> ${escapeHtml(result.error||'Revisa Supabase en Render.')}</div>`;
      $('modalList').innerHTML=renderPendingHistory(result.pending||[])+(!result.pending?.length?'<div class="empty-state"><b>No hay una copia compartida disponible.</b><span>No consideres una cotización guardada hasta que aparezca con la etiqueta Compartido.</span></div>':'');
      const pending=result.pending||[];
      $('modalList').querySelectorAll('[data-openq]').forEach((el,index)=>el.onclick=()=>{const r=pending[index];applyData(r.data||r);currentQuoteRecord=null;hideModal();toast('Copia de emergencia cargada');});
      $('modalList').querySelectorAll('[data-dupq]').forEach((el,index)=>el.onclick=()=>{const r=pending[index];applyData(r.data||r);currentQuoteRecord=null;hideModal();toast('Copia duplicada como nueva');});
    }
  };
  const loadLegacy=async()=>{mode='legacy';$('tabLegacy').classList.add('active');$('tabGenerated').classList.remove('active');$('historyStatus').textContent='Referencias históricas de ventas que DEXI utiliza para sugerir precios.';const rows=await api('/api/history?q='+encodeURIComponent($('modalSearch').value));$('modalList').innerHTML=rows.slice(0,40).map(r=>`<div class="list-item"><b>${escapeHtml(r.entrenamiento)}</b><small>${escapeHtml(r.cliente)} · ${r.horas||'—'} h · ${money(r.importe)} · ${r.fechaFacturacion||''}</small></div>`).join('');};
  $('tabGenerated').onclick=loadGenerated;$('tabLegacy').onclick=loadLegacy;$('modalSearchGo').onclick=()=>mode==='generated'?loadGenerated():loadLegacy();$('modalSearch').addEventListener('keydown',e=>{if(e.key==='Enter') $('modalSearchGo').click();});await loadGenerated();
}

document.querySelector('[data-action="catalog"]').onclick=openCatalog;document.querySelector('[data-action="library"]').onclick=openLibrary;document.querySelector('[data-action="history"]').onclick=openHistory;

$('coverInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{coverData=r.result;$('coverPreview').style.backgroundImage=`url(${coverData})`;$('coverPreview').textContent='';};r.readAsDataURL(f);});

function nl2br(s=''){ return escapeHtml(s).replace(/\n/g,'<br>'); }
function parsePreviewModules(text=''){
  const lines=String(text).split(/\r?\n/); const out=[]; let cur=null;
  lines.forEach(raw=>{ const line=raw.trim(); if(!line)return;
    if(/^M[ÓO]DULO\b|^MODULO\b/i.test(line)){ if(cur)out.push(cur); cur={title:line,items:[]}; }
    else if(cur){ cur.items.push(line.replace(/^[-•→]\s*/,'')); }
    else { if(!out.length) out.push({title:'Contenido',items:[]}); out[0].items.push(line.replace(/^[-•→]\s*/,'')); }
  }); if(cur)out.push(cur); return out.slice(0,12);
}
function totalCalc(p){const gross=p.concepts.reduce((s,c)=>s+(Number(c.price)||0)*(Number(c.qty)||1),0);const subtotal=gross*(1-(Number(p.discount)||0)/100);const ivaAmount=subtotal*((Number(p.iva)||0)/100);return {gross,subtotal,ivaAmount,total:subtotal+ivaAmount};}
function previewContact(p,klass=''){
 return `<div class="pv-contact ${klass}"><div><span class="pv-contact-kicker">Contacto comercial DEX</span><b>Hablemos de tu proyecto</b><small>Estamos listos para revisar fechas, modalidad y alcance.</small></div><div class="pv-contact-grid"><span><i>WhatsApp</i><b>+52 477 294 4676</b></span><span><i>Teléfono</i><b>+52 477 510 5426</b></span><span><i>Correo</i><b>ventas@dexmexico.com</b></span><span><i>Web</i><b>www.dexmexico.com</b></span></div></div>`;
}
function previewInvestmentBreakdown(t,p){return `<div class="pv-tax-breakdown"><span>Subtotal <b>${money(t.subtotal)}</b></span><span>IVA ${Number(p.iva)||0}% <b>${money(t.ivaAmount)}</b></span><span class="pv-tax-total">Total con IVA <b>${money(t.total)}</b></span><small>El importe total mostrado ya incluye el IVA correspondiente.</small></div>`;}
function previewConsiderations(p){const lines=String(p.considerations||'').split(/\r?\n/).filter(Boolean);return `<div class="pv-considerations"><h3>Consideraciones</h3><ul>${lines.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`;}
function previewA(p){const t=totalCalc(p),mods=parsePreviewModules(p.temario);return `<div class="pv-sheet pv-a"><div class="pv-a-hero"><img src="/dex-logo-real.png"><span>PROPUESTA COMERCIAL DE CAPACITACIÓN</span><h1>${escapeHtml(p.title||'Propuesta de servicio')}</h1></div><div class="pv-meta">${[['Modalidad',p.modality],['Duración',p.durationTotal],['Participantes',p.participants],['Acreditación',p.accreditation]].map(x=>`<div><small>${x[0]}</small><b>${escapeHtml(x[1]||'—')}</b></div>`).join('')}</div><div class="pv-a-body"><p>${nl2br(p.presentation)}</p><div class="pv-cols"><section><h3>Objetivo general</h3><p>${nl2br(p.objectives)}</p><h3>Dirigido a</h3><p>${nl2br(p.audience)}</p></section><aside><h3>Función / beneficio principal</h3><p>${nl2br(p.benefit)}</p></aside></div><h3>Contenido programático</h3><div class="pv-mods">${mods.map((m,i)=>`<div><b>${escapeHtml(m.title)}</b><ul>${m.items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`).join('')}</div><div class="pv-invest"><div><small>INVERSIÓN</small><b>${escapeHtml(p.title||'Servicio DEX')}</b><span>${escapeHtml(p.durationTotal||'')}</span></div>${previewInvestmentBreakdown(t,p)}</div>${previewConsiderations(p)}${previewContact(p,'pv-contact-a')}</div></div>`;}
function previewB(p){const t=totalCalc(p),mods=parsePreviewModules(p.temario);return `<div class="pv-sheet pv-b"><div class="pv-b-hero"><img src="/dex-logo-real.png"><span>DEX MÉXICO / PROPUESTA COMERCIAL</span><h1>${escapeHtml(p.title||'Propuesta de servicio')}</h1><div class="pv-pills"><b>${escapeHtml(p.modality||'—')}</b><b>${escapeHtml(p.durationTotal||'—')}</b><b>${escapeHtml(p.participants||'—')}</b><b>${escapeHtml(p.accreditation||'—')}</b></div></div><div class="pv-b-body"><div class="pv-card-grid"><section><h3>Objetivo general</h3><p>${nl2br(p.objectives)}</p></section><section><h3>Función / beneficio</h3><p>${nl2br(p.benefit)}</p></section><section><h3>Dirigido a</h3><p>${nl2br(p.audience)}</p></section><section><h3>Presentación</h3><p>${nl2br(p.presentation)}</p></section></div><h3 class="pv-title-green">Contenido programático</h3><div class="pv-b-mods">${mods.map((m,i)=>`<article><span>${String(i+1).padStart(2,'0')}</span><b>${escapeHtml(m.title)}</b><ul>${m.items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></article>`).join('')}</div><div class="pv-b-money"><div><small>SERVICIO COTIZADO</small><b>${escapeHtml(p.title||'Servicio DEX')}</b></div>${previewInvestmentBreakdown(t,p)}</div>${previewConsiderations(p)}${previewContact(p,'pv-contact-b')}</div></div>`;}
function previewC(p){const t=totalCalc(p),mods=parsePreviewModules(p.temario);return `<div class="pv-sheet pv-c"><div class="pv-c-hero"><div class="pv-c-copy"><img src="/dex-logo-real.png"><span>PROPUESTA DE CAPACITACIÓN</span><h1>${escapeHtml(p.title||'Propuesta de servicio')}</h1></div><div class="pv-c-image" ${p.coverData?`style="background-image:url('${p.coverData}')"`:''}>${p.coverData?'':'<b>ESPACIO PARA IMAGEN</b><small>La imagen cargada se acomoda automáticamente.</small>'}</div></div><div class="pv-meta pv-meta-c">${[['Modalidad',p.modality],['Duración',p.durationTotal],['Participantes',p.participants],['Acreditación',p.accreditation]].map(x=>`<div><small>${x[0]}</small><b>${escapeHtml(x[1]||'—')}</b></div>`).join('')}</div><div class="pv-c-body"><p class="pv-c-lead">${nl2br(p.presentation)}</p><div class="pv-cols"><section><h3>Objetivo</h3><p>${nl2br(p.objectives)}</p><h3>Dirigido a</h3><p>${nl2br(p.audience)}</p></section><aside><h3>Función / beneficio</h3><p>${nl2br(p.benefit)}</p></aside></div><h3 class="pv-c-gold">Contenido programático</h3><div class="pv-c-mods">${mods.map(m=>`<article><b>${escapeHtml(m.title)}</b><ul>${m.items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></article>`).join('')}</div><div class="pv-c-money"><div><small>INVERSIÓN</small><b>${escapeHtml(p.title||'Servicio DEX')}</b><span>${escapeHtml(p.durationTotal||'')}</span></div>${previewInvestmentBreakdown(t,p)}</div>${previewConsiderations(p)}${previewContact(p,'pv-contact-c')}</div></div>`;}
function renderSelectedPreview(){ const p=quoteData(); return selectedTemplate==='B'?previewB(p):selectedTemplate==='C'?previewC(p):previewA(p); }

function proposalCompleteness(){
  const p=quoteData();
  const checks=[
    ['title','Título del curso o servicio',p.title],
    ['presentation','Presentación',p.presentation],
    ['objectives','Objetivo general / objetivos',p.objectives],
    ['benefit','Función / beneficio principal',p.benefit],
    ['audience','Dirigido a',p.audience],
    ['temario','Contenido programático / temario',p.temario],
    ['durationTotal','Duración total',p.durationTotal],
    ['participants','Participantes',p.participants]
  ];
  const missing=checks.filter(([, ,value])=>!String(value||'').trim()).map(([id,label])=>({id,label}));
  const validConcepts=(p.concepts||[]).filter(c=>String(c.service||'').trim() && Number(c.price)>0);
  if(!validConcepts.length) missing.push({id:'investment',label:'Inversión / concepto cotizado'});
  return {ok:missing.length===0,missing};
}

function showIncompleteProposal(){
  const result=proposalCompleteness();
  const items=result.missing.map(x=>`<li><b>${escapeHtml(x.label)}</b></li>`).join('');
  showModal(`<div class="dexi-head"><h2>✦ La propuesta todavía está incompleta</h2><p>Antes de generar el PDF o la vista previa, completa los datos esenciales para evitar enviar una cotización con espacios vacíos.</p></div>
    <div class="result-card"><h3>Falta completar</h3><ul class="missing-list">${items}</ul></div>
    <div class="result-card"><h3>DEXI puede ayudarte</h3><p>${$('clientRequest')?.value.trim()? 'Ya tengo la solicitud del cliente. DEXI puede usarla para construir la propuesta y buscar referencias DEX.' : 'Escribe qué solicitó el cliente y DEXI te ayudará a estructurar la propuesta.'}</p></div>
    <div class="modal-actions"><button class="btn btn-dexi" id="completeWithDexi">✦ Construir con DEXI</button><button class="btn btn-light" id="returnToEdit">Seguir editando</button></div>`);
  $('completeWithDexi').onclick=()=>{ const request=$('clientRequest')?.value.trim()||''; hideModal(); openDexi(request); };
  $('returnToEdit').onclick=()=>{ const first=result.missing[0]; hideModal(); if(first?.id && first.id!=='investment' && $(first.id)){ $(first.id).scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>$(first.id).focus(),350); } else if(first?.id==='investment'){ $('addConcept')?.scrollIntoView({behavior:'smooth',block:'center'}); } };
}

function previewHtml(){return `<div class="preview-shell"><div class="template-toolbar"><div><b>Elige el diseño de la cotización</b><small>La información se acomoda automáticamente al cambiar de plantilla.</small></div><div class="template-switch"><button data-template="A" class="${selectedTemplate==='A'?'active':''}">A · Corporativa</button><button data-template="B" class="${selectedTemplate==='B'?'active':''}">B · Moderna</button><button data-template="C" class="${selectedTemplate==='C'?'active':''}">C · Premium visual</button></div></div><div id="templatePreview">${renderSelectedPreview()}</div><div class="modal-actions preview-actions"><button class="btn btn-primary" id="savePreviewQuote">Guardar cotización</button><button class="btn btn-light" id="pdfBtn">Descargar PDF con este diseño</button><button class="btn btn-light" id="docxBtn">Descargar Word editable</button><button class="btn btn-light" id="backEdit">← Seguir editando</button></div></div>`;}
function bindPreviewActions(){
 document.querySelectorAll('[data-template]').forEach(btn=>btn.onclick=()=>{selectedTemplate=btn.dataset.template; body.innerHTML=previewHtml(); bindPreviewActions();});
 $('backEdit').onclick=hideModal; if($('savePreviewQuote')) $('savePreviewQuote').onclick=saveQuoteToHistory; $('pdfBtn').onclick=()=>downloadExport('/api/export/pdf','pdf'); $('docxBtn').onclick=()=>downloadExport('/api/export/docx','docx');
}
function openPreview(){ const check=proposalCompleteness(); if(!check.ok) return showIncompleteProposal(); showModal(previewHtml());bindPreviewActions();}
$('previewBtn').onclick=openPreview;$('generateBtn').onclick=openPreview;
async function downloadExport(url,ext){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(quoteData())});if(!r.ok)return toast('No fue posible generar el archivo.');const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Propuesta_DEX.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}

if($('saveQuote')) $('saveQuote').onclick=saveQuoteToHistory;
$('saveDraft').onclick=()=>{localStorage.setItem('dex_quote_draft',JSON.stringify(quoteData()));toast('Borrador guardado en este dispositivo');};
$('clearBtn').onclick=()=>{if(!confirm('¿Limpiar toda la cotización?'))return;localStorage.removeItem('dex_quote_draft');location.reload();};
const saved=localStorage.getItem('dex_quote_draft');if(saved){try{applyData(JSON.parse(saved));toast('Borrador recuperado');}catch{}}
if(!$('considerations').value.trim()) syncStandardConsiderations(true);
renderConcepts();
