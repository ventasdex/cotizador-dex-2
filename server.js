const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle
} = require('docx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
const TEMARIOS = loadJson('temarios.json');
const PRECIOS = loadJson('precios.json');
const HISTORICOS = loadJson('historicos.json');
const CONSULTORES = loadJson('consultores.json');

function normalize(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIASES = {
  'SPC': 'CONTROL ESTADISTICO DE PROCESOS',
  'AMEF': 'ANALISIS MODO EFECTO FALLA FMEA',
  'FMEA': 'ANALISIS MODO EFECTO FALLA AMEF',
  'APQP': 'PLANEACION AVANZADA CALIDAD PRODUCTO',
  'PPAP': 'PROCESO APROBACION PARTES PRODUCCION',
  'MSA': 'ANALISIS SISTEMA MEDICION',
  'CORE TOOLS': 'HERRAMIENTAS CORE TOOLS SPC MSA AMEF APQP PPAP PLAN CONTROL',
  'VDA 6 3': 'VDA 6 3 AUDITORIAS PROCESO',
  'VDA63': 'VDA 6 3 AUDITORIAS PROCESO',
  '8D': 'SOLUCION PROBLEMAS 8D',
  'RCA': 'ANALISIS CAUSA RAIZ',
  'LOTO': 'BLOQUEO ETIQUETADO ENERGIAS PELIGROSAS',
  'YELLOW BELT': 'SIX SIGMA YELLOW BELT',
  'GREEN BELT': 'SIX SIGMA GREEN BELT',
  'BLACK BELT': 'SIX SIGMA BLACK BELT'
};

function expandAliases(text) {
  let n = normalize(text);
  Object.entries(ALIASES).forEach(([k, v]) => {
    if (n.includes(k)) n += ' ' + v;
  });
  return n;
}

function tokens(text) {
  return new Set(expandAliases(text).split(' ').filter(t => t.length > 1));
}

function similarity(a, b) {
  const na = expandAliases(a);
  const nb = expandAliases(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const A = tokens(a), B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = new Set([...A, ...B]).size || 1;
  let score = inter / union;
  const important = ['SPC','AMEF','FMEA','APQP','PPAP','MSA','VDA','IATF','ISO','LEAN','SIX','SIGMA','CORE','LOTO','CQI','EXCEL','POWER','LIDERAZGO'];
  const aa = [...A], bb = [...B];
  const sharedImportant = important.some(t => aa.includes(t) && bb.includes(t));
  if (sharedImportant) score += 0.12;
  return Math.min(score, 1);
}

function topMatches(query, items, field, limit = 10) {
  const scored = items
    .map(item => ({ item, score: similarity(query, item[field] || '') }))
    .filter(x => x.score > 0.08)
    .sort((a,b) => b.score - a.score);
  return scored.slice(0, limit);
}

function median(nums) {
  const v = nums.filter(n => Number.isFinite(n)).sort((a,b) => a-b);
  if (!v.length) return null;
  const m = Math.floor(v.length/2);
  return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2;
}

function round500(n) {
  return n == null ? null : Math.round(n / 500) * 500;
}

function parseRequest(query = '', extra = {}) {
  const text = normalize(query);
  const hoursMatch = String(query).match(/(\d+(?:\.\d+)?)\s*(?:HORAS?|HRS?|H)\b/i);
  const partMatch = String(query).match(/(\d+)\s*(?:PARTICIPANTES?|PERSONAS?|PAX)\b/i);
  const modality = /ONLINE|VIRTUAL|EN LINEA/i.test(query) ? 'online' : /PRESENCIAL|IN COMPANY|EN PLANTA/i.test(query) ? 'presencial' : (extra.modality || null);
  return {
    hours: extra.hours ? Number(extra.hours) : (hoursMatch ? Number(hoursMatch[1]) : null),
    participants: extra.participants ? Number(extra.participants) : (partMatch ? Number(partMatch[1]) : null),
    modality,
    openCourse: /ABIERTO|PUBLICO|P[ÚU]BLICO/i.test(query),
    companyCourse: /EMPRESA|CORPORATIVO|IN COMPANY|PLANTA/i.test(query)
  };
}

function getPriceSuggestion(query, courseTitle, parsed) {
  const target = courseTitle || query;
  const priceMatches = topMatches(target, PRECIOS, 'curso', 12);
  const bestMatrix = priceMatches.find(x => x.item.tipo === 'empresa') || priceMatches[0] || null;
  const modality = parsed.modality || 'presencial';
  let matrixPrice = null;
  let matrixHours = null;
  let matrixTitle = null;
  let matrixScore = 0;
  if (bestMatrix) {
    matrixTitle = bestMatrix.item.curso;
    matrixScore = bestMatrix.score;
    matrixHours = bestMatrix.item.horas || null;
    matrixPrice = Number(bestMatrix.item[modality]);
    if (!Number.isFinite(matrixPrice)) matrixPrice = null;
    if (matrixPrice && parsed.hours && matrixHours && parsed.hours !== matrixHours) {
      matrixPrice = matrixPrice / matrixHours * parsed.hours;
    }
  }

  let historyMatches = topMatches(target, HISTORICOS, 'entrenamiento', 30)
    .filter(x => x.score >= 0.2)
    .filter(x => parsed.openCourse ? /ABIERTO/i.test(x.item.entrenamiento) : !/ABIERTO/i.test(x.item.entrenamiento));

  if (parsed.hours) {
    const exact = historyMatches.filter(x => Number(x.item.horas) === Number(parsed.hours));
    if (exact.length) historyMatches = exact;
  }
  historyMatches = historyMatches.slice(0, 8);
  const histValues = historyMatches.map(x => {
    const h = Number(x.item.horas);
    const amount = Number(x.item.importe);
    if (parsed.hours && h && h !== parsed.hours) return amount / h * parsed.hours;
    return amount;
  }).filter(Number.isFinite);
  const histMedian = median(histValues);

  let suggested = null;
  if (matrixPrice && histMedian) suggested = matrixPrice * 0.55 + histMedian * 0.45;
  else suggested = matrixPrice || histMedian;
  suggested = round500(suggested);
  const min = suggested ? round500(suggested * 0.90) : null;
  const max = suggested ? round500(suggested * 1.10) : null;

  let confidence = 'Baja';
  if (suggested && matrixScore >= 0.55 && historyMatches.length >= 2) confidence = 'Alta';
  else if (suggested && (matrixScore >= 0.35 || historyMatches.length >= 1)) confidence = 'Media';

  return {
    suggested,
    min,
    max,
    confidence,
    modality,
    matrix: bestMatrix ? {
      course: matrixTitle,
      hours: matrixHours,
      basePrice: Number(bestMatrix.item[modality]) || null,
      adjustedPrice: matrixPrice ? round500(matrixPrice) : null,
      score: Number(matrixScore.toFixed(3))
    } : null,
    historicalMedian: histMedian ? round500(histMedian) : null,
    comparables: historyMatches.map(x => ({
      training: x.item.entrenamiento,
      client: x.item.cliente,
      hours: x.item.horas,
      amount: x.item.importe,
      score: Number(x.score.toFixed(3))
    }))
  };
}

function buildChatGptPrompt(query, match, parsed) {
  const base = match ? `Usa como base este temario DEX existente y adáptalo sin perder profundidad:\n\n${match.temario}` : 'No existe todavía un temario DEX equivalente; desarrolla uno profesional desde cero.';
  return `Actúa como diseñador instruccional senior de DEX México especializado en capacitación corporativa.\n\nSolicitud comercial:\n${query}\n\nDatos detectados:\n- Duración: ${parsed.hours || 'por definir'} horas\n- Modalidad: ${parsed.modality || 'por definir'}\n- Participantes: ${parsed.participants || 'por definir'}\n\n${base}\n\nGenera una propuesta profesional con: título, presentación, objetivo general, 4-6 objetivos específicos, dirigido a, función/beneficio principal, metodología y un temario detallado proporcional a la duración. Para 8 horas usa al menos 4 módulos y 12 subtemas; para 16 horas o más aumenta profundidad, ejercicios y casos prácticos. No inventes normas o versiones. Conserva terminología técnica y evita contenido genérico. Devuelve secciones claramente identificadas.`;
}

app.get('/api/meta', (_req,res) => {
  res.json({ temarios: TEMARIOS.length, precios: PRECIOS.length, historicos: HISTORICOS.length, consultores: CONSULTORES.length, aiPaid: false });
});

app.get('/api/library', (req,res) => {
  const q = String(req.query.q || '').trim();
  const rows = q ? topMatches(q, TEMARIOS, 'title', 20).map(x => ({...x.item, score:x.score})) : TEMARIOS.slice(0,50);
  res.json(rows);
});

app.get('/api/catalog', (req,res) => {
  const q = String(req.query.q || '').trim();
  const rows = q ? topMatches(q, PRECIOS, 'curso', 30).map(x => ({...x.item, score:x.score})) : PRECIOS.slice(0,60);
  res.json(rows);
});

app.get('/api/history', (req,res) => {
  const q = String(req.query.q || '').trim();
  const rows = q ? topMatches(q, HISTORICOS, 'entrenamiento', 30).map(x => ({...x.item, score:x.score})) : HISTORICOS.slice().reverse().slice(0,50);
  res.json(rows);
});

app.post('/api/dexi/suggest', (req,res) => {
  const query = String(req.body.query || '').trim();
  if (!query) return res.status(400).json({ error:'Escribe lo que necesitas cotizar.' });
  const parsed = parseRequest(query, req.body || {});
  const best = topMatches(query, TEMARIOS, 'title', 1)[0] || null;
  const match = best && best.score >= 0.16 ? {...best.item, score:Number(best.score.toFixed(3))} : null;
  const price = getPriceSuggestion(query, match?.title, parsed);
  const prompt = buildChatGptPrompt(query, match, parsed);
  res.json({ parsed, match, price, prompt });
});

function money(n) {
  return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n)||0);
}

function proposalTotals(p) {
  const concepts = Array.isArray(p.concepts) ? p.concepts : [];
  const subtotal = concepts.reduce((s,c) => s + (Number(c.price)||0)*(Number(c.qty)||1),0);
  const discountPct = Number(p.discount)||0;
  const ivaPct = Number(p.iva ?? 16)||0;
  const afterDiscount = subtotal * (1-discountPct/100);
  const iva = afterDiscount * ivaPct/100;
  return { subtotal, afterDiscount, iva, total: afterDiscount+iva };
}

function parseModules(text='') {
  const lines = String(text || '').split(/\r?\n/);
  const modules = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^M[ÓO]DULO\b|^MODULO\b/i.test(line)) {
      if (current) modules.push(current);
      current = { title: line, items: [] };
    } else if (current) {
      current.items.push(line.replace(/^[-•→]\s*/, ''));
    } else {
      if (!modules.length) modules.push({ title: 'Contenido', items: [] });
      modules[0].items.push(line.replace(/^[-•→]\s*/, ''));
    }
  }
  if (current) modules.push(current);
  return modules;
}

const LOGO_PATH = path.join(__dirname, 'public', 'dex-logo-real.png');
const PDF = { W: 595.28, H: 841.89, M: 40 };

function drawLogo(doc, x, y, width=92) {
  try { doc.image(LOGO_PATH, x, y, { width }); } catch (_) {}
}
function drawFooter(doc, label='DEX México') {
  doc.save().strokeColor('#d9e2e3').lineWidth(.6).moveTo(40, 807).lineTo(555, 807).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor('#66757b').text(label, 40, 816, { width: 410 });
  doc.text(`Página ${doc.bufferedPageRange().count || 1}`, 480, 816, { width: 75, align: 'right' }).restore();
}
function metaValue(p, key, fallback='—') { return String(p[key] || fallback); }
function drawMetaRow(doc, p, y, palette) {
  const items = [['MODALIDAD', metaValue(p,'modality')], ['DURACIÓN', metaValue(p,'durationTotal')], ['PARTICIPANTES', metaValue(p,'participants')], ['ACREDITACIÓN', metaValue(p,'accreditation')]];
  const x=40, totalW=515, cellW=totalW/4, h=58;
  items.forEach((it,i)=>{
    const xx=x+i*cellW;
    doc.save().fillColor('#ffffff').rect(xx,y,cellW,h).fill().strokeColor(palette.line||'#d7e2e5').lineWidth(.8).rect(xx,y,cellW,h).stroke();
    doc.fillColor(palette.muted||'#71848c').font('Helvetica-Bold').fontSize(7.2).text(it[0],xx+6,y+14,{width:cellW-12,align:'center'});
    doc.fillColor(palette.ink||'#17324a').fontSize(10).text(it[1],xx+6,y+30,{width:cellW-12,align:'center'}).restore();
  });
  return y+h;
}
function drawTwoColumnText(doc, p, y, palette, variant='A') {
  const x=48, gap=24, col=(499-gap)/2;
  doc.font('Helvetica').fontSize(9.4).fillColor(palette.ink).text(p.presentation || '', x, y, {width:499,lineGap:2});
  y=doc.y+16;
  const startY=y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(palette.accent).text('OBJETIVO GENERAL',x,startY,{width:col});
  doc.font('Helvetica').fontSize(9).fillColor(palette.ink).text(p.objectives || '—',x,startY+17,{width:col,lineGap:2});
  let ly=doc.y+14;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(palette.accent).text('DIRIGIDO A',x,ly,{width:col});
  doc.font('Helvetica').fontSize(9).fillColor(palette.ink).text(p.audience || '—',x,ly+17,{width:col,lineGap:2});
  const leftBottom=doc.y;
  const rx=x+col+gap;
  const benefitH=Math.max(118, doc.heightOfString(p.benefit || '—',{width:col-24,lineGap:2})+50);
  if (variant==='C') doc.roundedRect(rx,startY,col,benefitH,12).fill(palette.soft);
  else { doc.rect(rx,startY,col,benefitH).fill(palette.soft); if(variant==='A') doc.rect(rx,startY,4,benefitH).fill(palette.accent); }
  doc.font('Helvetica-Bold').fontSize(8).fillColor(variant==='C'?palette.dark:palette.accent).text('FUNCIÓN / BENEFICIO PRINCIPAL',rx+14,startY+14,{width:col-28});
  doc.font('Helvetica').fontSize(9).fillColor(palette.ink).text(p.benefit || '—',rx+14,startY+33,{width:col-28,lineGap:2});
  return Math.max(leftBottom,startY+benefitH)+16;
}
function addModulesPage(doc, p, palette, variant='A') {
  doc.addPage({size:'A4',margin:0});
  let y=46;
  doc.fillColor(palette.accent).font('Helvetica-Bold').fontSize(8).text('02 | DESARROLLO DEL TEMA',40,y);
  y+=22; doc.fillColor(palette.dark).fontSize(20).text('Contenido programático',40,y); y+=36;
  const modules=parseModules(p.temario);
  const colW=245, gap=18, x1=40, x2=40+colW+gap;
  let colY=[y,y];
  modules.forEach((m,idx)=>{
    const col=colY[0] <= colY[1] ? 0 : 1; const x=col===0?x1:x2; let yy=colY[col];
    const text=m.items.length?m.items.map(t=>'• '+t).join('\n'):'—';
    const titleH=doc.heightOfString(m.title,{width:colW-24});
    const bodyH=doc.heightOfString(text,{width:colW-24,lineGap:1});
    const h=Math.max(62,titleH+bodyH+33);
    if (yy+h>785) { // extra page if needed
      drawFooter(doc,'DEX México · Desarrollo del tema');
      doc.addPage({size:'A4',margin:0}); colY[0]=colY[1]=58; yy=58;
    }
    if (variant==='B') {
      doc.roundedRect(x,yy,colW,h,12).fill(idx%2?'#eef5f3':'#f5f8f7').strokeColor('#dfe8e4').lineWidth(.7).stroke();
      doc.circle(x+18,yy+18,11).fill(palette.accent); doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(String(idx+1).padStart(2,'0'),x+8.5,yy+14,{width:19,align:'center'});
      doc.fillColor(palette.dark).fontSize(9.4).text(m.title,x+38,yy+11,{width:colW-50});
      doc.font('Helvetica').fontSize(8.2).fillColor(palette.ink).text(text,x+16,yy+35,{width:colW-30,lineGap:1});
    } else if (variant==='C') {
      doc.save().strokeColor(palette.gold).lineWidth(3).moveTo(x,yy+4).lineTo(x,yy+h-4).stroke().restore();
      doc.fillColor(palette.dark).font('Helvetica-Bold').fontSize(9.2).text(m.title,x+12,yy,{width:colW-15});
      doc.font('Helvetica').fontSize(8.2).fillColor(palette.ink).text(text,x+12,yy+titleH+9,{width:colW-15,lineGap:1});
    } else {
      doc.rect(x,yy,colW,h).strokeColor('#d7e3e7').lineWidth(.7).stroke();
      doc.rect(x,yy,colW,Math.max(26,titleH+13)).fill(idx%2?palette.accent:palette.dark);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(m.title,x+10,yy+8,{width:colW-20});
      doc.font('Helvetica').fontSize(8.2).fillColor(palette.ink).text(text,x+12,yy+Math.max(34,titleH+18),{width:colW-24,lineGap:1});
    }
    colY[col]=yy+h+12;
  });
  drawFooter(doc,'DEX México · Desarrollo del tema');
}
function drawContactPanel(doc, p, y, palette, variant='A') {
  const x=40,w=515,h=112;
  if (variant==='B') doc.roundedRect(x,y,w,h,14).fill(palette.dark);
  else if (variant==='C') { doc.roundedRect(x,y,w,h,12).fill('#fffaf0').strokeColor(palette.gold).lineWidth(1.7).stroke(); }
  else doc.rect(x,y,w,h).fill('#f3fafb').strokeColor('#cfe1e7').lineWidth(.8).stroke();
  const fg=variant==='B'?'#ffffff':palette.dark; const subtle=variant==='B'?'#a8e5d8':variant==='C'?palette.gold:palette.accent;
  doc.fillColor(subtle).font('Helvetica-Bold').fontSize(7.5).text('CONTACTO COMERCIAL DEX',x+16,y+13);
  doc.fillColor(fg).fontSize(16).text('Hablemos de tu proyecto',x+16,y+29);
  doc.font('Helvetica').fontSize(8.2).fillColor(variant==='B'?'#d9ede8':'#5f6f70').text('Confirma modalidad, fechas tentativas y alcance para avanzar con la programación.',x+16,y+49,{width:w-32});
  const cards=[['WHATSAPP','+52 477 294 4676'],['TELÉFONO','+52 477 510 5426'],['CORREO','ventas@dexmexico.com'],['WEB','www.dexmexico.com']];
  const cw=(w-32-18)/4;
  cards.forEach((c,i)=>{const xx=x+16+i*(cw+6), yy=y+69;
    if(variant==='B') doc.roundedRect(xx,yy,cw,30,5).fill('#ffffff18').strokeColor('#ffffff28').stroke();
    else doc.roundedRect(xx,yy,cw,30,5).fill(variant==='C'?'#f7f2e8':'#ffffff').strokeColor(variant==='C'?'#eadfca':'#d7e5e9').stroke();
    doc.fillColor(subtle).font('Helvetica-Bold').fontSize(6.4).text(c[0],xx+6,yy+5,{width:cw-12});
    doc.fillColor(fg).fontSize(7.2).text(c[1],xx+6,yy+16,{width:cw-12});
  });
}
function addClosingPage(doc, p, totals, palette, variant='A') {
  doc.addPage({size:'A4',margin:0}); let y=48;
  doc.fillColor(variant==='C'?palette.gold:palette.accent).font('Helvetica-Bold').fontSize(8).text('03 | PROPUESTA ECONÓMICA Y CIERRE',40,y);
  y+=22; doc.fillColor(palette.dark).fontSize(20).text('Inversión, condiciones y contacto',40,y); y+=40;
  if(variant==='B'){
    doc.roundedRect(40,y,515,116,14).fill(palette.dark); doc.fillColor('#87dac9').fontSize(7).text('SERVICIO COTIZADO',58,y+18); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+34,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+59,{width:300}); doc.fillColor('#e7bb59').fontSize(27).font('Helvetica-Bold').text(money(totals.total),360,y+38,{width:175,align:'right'}); doc.fontSize(9).fillColor('#fff').text('MXN',450,y+73,{width:85,align:'right'});
  } else if(variant==='C'){
    doc.roundedRect(40,y,515,116,12).fill(palette.dark); doc.fillColor('#dbc995').fontSize(7).text('INVERSIÓN',58,y+18); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+34,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+59,{width:300}); doc.fillColor('#f1d28f').fontSize(27).font('Helvetica-Bold').text(money(totals.total),360,y+38,{width:175,align:'right'}); doc.fontSize(9).fillColor('#fff').text('MXN',450,y+73,{width:85,align:'right'});
  } else {
    doc.rect(40,y,340,116).fill(palette.dark); doc.rect(380,y,175,116).fill(palette.accent); doc.fillColor('#75d7dd').fontSize(7).text('SERVICIO COTIZADO',58,y+18); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+34,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+61,{width:300}); doc.fontSize(26).font('Helvetica-Bold').text(money(totals.total),390,y+35,{width:155,align:'center'}); doc.fontSize(9).text('MXN',390,y+74,{width:155,align:'center'});
  }
  y+=136;
  doc.fillColor(variant==='C'?palette.gold:palette.accent).font('Helvetica-Bold').fontSize(8).text('CONDICIONES COMERCIALES',40,y); y+=17;
  const cond=(p.considerations||'').split(/\r?\n/).filter(Boolean).slice(0,8);
  doc.font('Helvetica').fontSize(8.5).fillColor(palette.ink);
  cond.forEach(line=>{ doc.text('• '+line,48,y,{width:499,lineGap:1}); y=doc.y+5; });
  if(p.notes){ y+=4; doc.font('Helvetica-Bold').fontSize(8).fillColor(variant==='C'?palette.gold:palette.accent).text('NOTAS',40,y); y+=15; doc.font('Helvetica').fontSize(8.5).fillColor(palette.ink).text(p.notes,48,y,{width:499,lineGap:1}); y=doc.y+12; }
  if(y>660) y=660;
  drawContactPanel(doc,p,y,palette,variant);
  drawFooter(doc,'DEX México · Cierre comercial');
}
function addCoverA(doc,p,palette){
  doc.rect(0,0,PDF.W,235).fill(palette.dark); drawLogo(doc,445,38,90);
  doc.fillColor('#58d5da').font('Helvetica-Bold').fontSize(8).text('PROPUESTA COMERCIAL DE CAPACITACIÓN',40,50);
  doc.fillColor('#fff').fontSize(28).text(p.title||'Propuesta de servicio',40,105,{width:375});
  doc.strokeColor(palette.accent).lineWidth(2).moveTo(40,195).lineTo(215,195).stroke();
  const y=drawMetaRow(doc,p,285,palette); drawTwoColumnText(doc,p,y+28,palette,'A'); drawFooter(doc,'DEX México · Plantilla A Corporativa');
}
function addCoverB(doc,p,palette){
  doc.roundedRect(40,40,515,260,22).fill(palette.dark); drawLogo(doc,440,66,80);
  doc.fillColor('#7be0ca').font('Helvetica-Bold').fontSize(8).text('DEX MÉXICO / PROPUESTA COMERCIAL',70,70);
  doc.fillColor('#fff').fontSize(27).text(p.title||'Propuesta de servicio',70,118,{width:330});
  doc.font('Helvetica').fontSize(10).fillColor('#d9ece6').text(p.presentation||'',70,190,{width:330,height:52,ellipsis:true});
  const pills=[metaValue(p,'modality'),metaValue(p,'durationTotal'),metaValue(p,'participants'),metaValue(p,'accreditation')]; let x=70; pills.forEach(v=>{const w=Math.min(112,doc.widthOfString(v)+22);doc.roundedRect(x,255,w,25,12).strokeColor('#ffffff55').lineWidth(.8).stroke();doc.fillColor('#fff').fontSize(7.7).text(v,x+7,263,{width:w-14,align:'center'});x+=w+8;});
  const y=340; const gap=18,cw=(515-gap)/2; const cards=[['OBJETIVO GENERAL',p.objectives],['FUNCIÓN / BENEFICIO PRINCIPAL',p.benefit],['DIRIGIDO A',p.audience],['PRESENTACIÓN',p.presentation]];
  cards.forEach((c,i)=>{const xx=40+(i%2)*(cw+gap), yy=y+Math.floor(i/2)*150;doc.roundedRect(xx,yy,cw,132,14).fill(i===1||i===2?'#f1f6f4':'#ffffff').strokeColor('#dfe8e4').lineWidth(.7).stroke();doc.fillColor(palette.accent).font('Helvetica-Bold').fontSize(7.5).text(c[0],xx+14,yy+15,{width:cw-28});doc.fillColor(palette.ink).font('Helvetica').fontSize(8.7).text(c[1]||'—',xx+14,yy+36,{width:cw-28,height:82,ellipsis:true,lineGap:1});});
  drawFooter(doc,'DEX México · Plantilla B Moderna');
}
function dataUriBuffer(data='') { const m=String(data).match(/^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i); return m?Buffer.from(m[1],'base64'):null; }
function addCoverC(doc,p,palette){
  doc.rect(0,0,PDF.W,270).fill(palette.dark); drawLogo(doc,55,55,95);
  doc.fillColor(palette.gold).font('Helvetica-Bold').fontSize(8).text('PROPUESTA DE CAPACITACIÓN',40,170);
  doc.fillColor('#fff').fontSize(26).text(p.title||'Propuesta de servicio',40,195,{width:270});
  const bx=325,by=30,bw=230,bh=210; doc.roundedRect(bx,by,bw,bh,20).fill('#e8dec7');
  const buf=dataUriBuffer(p.coverData); if(buf){ try{doc.image(buf,bx,by,{cover:[bw,bh],align:'center',valign:'center'});}catch(_){}} else {doc.fillColor('#6b624f').font('Helvetica-Bold').fontSize(11).text('ESPACIO PARA IMAGEN',bx+20,by+90,{width:bw-40,align:'center'});doc.font('Helvetica').fontSize(7.5).text('La imagen cargada se ajusta automáticamente.',bx+25,by+112,{width:bw-50,align:'center'});}
  const y=drawMetaRow(doc,p,270,palette); doc.font('Helvetica').fontSize(10.5).fillColor(palette.ink).text(p.presentation||'',40,y+25,{width:515,lineGap:2}); drawTwoColumnText(doc,{...p,presentation:''},doc.y+18,palette,'C'); drawFooter(doc,'DEX México · Plantilla C Premium Visual');
}

app.post('/api/export/pdf', (req,res) => {
  const p = req.body || {};
  const totals = proposalTotals(p);
  const template = ['A','B','C'].includes(p.template) ? p.template : 'A';
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="Propuesta_DEX_${template}_${Date.now()}.pdf"`);
  const doc = new PDFDocument({ size:'A4', margin:0, bufferPages:true });
  doc.pipe(res);
  const palettes={
    A:{dark:'#0f3252',accent:'#1aa6af',soft:'#edf7f8',ink:'#173047',muted:'#71848c',line:'#d7e2e5',gold:'#c9a458'},
    B:{dark:'#194556',accent:'#18745f',soft:'#eef5f3',ink:'#183142',muted:'#6f827c',line:'#dfe8e4',gold:'#e7bb59'},
    C:{dark:'#173d35',accent:'#c9a458',soft:'#f4efe5',ink:'#273631',muted:'#7d7463',line:'#e6ddcb',gold:'#c9a458'}
  };
  const palette=palettes[template];
  if(template==='B') addCoverB(doc,p,palette); else if(template==='C') addCoverC(doc,p,palette); else addCoverA(doc,p,palette);
  addModulesPage(doc,p,palette,template);
  addClosingPage(doc,p,totals,palette,template);
  const range=doc.bufferedPageRange(); for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);}
  doc.end();
});

app.post('/api/export/docx', async (req,res) => {
  try {
    const p = req.body || {};
    const totals = proposalTotals(p);
    const children = [];
    children.push(new Paragraph({ text:'DEX México', heading:HeadingLevel.TITLE }));
    children.push(new Paragraph({ text:'Propuesta comercial', spacing:{after:220} }));
    children.push(new Paragraph({ text:p.title || 'Propuesta de servicio', heading:HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ children:[new TextRun({text:`Cliente: ${p.client || '—'}`,bold:true}), new TextRun(`   Contacto: ${p.contact || '—'}`)] }));
    children.push(new Paragraph({ text:`Correo: ${p.email || '—'}   |   WhatsApp: ${p.whatsapp || '—'}   |   Vigencia: ${p.validity || '15 días'}` }));
    children.push(new Paragraph({ text:`Modalidad: ${p.modality || '—'}   |   Duración: ${p.durationTotal || '—'}   |   Participantes: ${p.participants || '—'}   |   Acreditación: ${p.accreditation || '—'}`, spacing:{after:220} }));
    const addSection = (title, body) => {
      if (!body) return;
      children.push(new Paragraph({ text:title, heading:HeadingLevel.HEADING_2 }));
      String(body).split(/\n/).forEach(line => children.push(new Paragraph({ text:line || ' ' })));
    };
    addSection('Presentación', p.presentation);
    addSection('Objetivos', p.objectives);
    addSection('Función / beneficio principal', p.benefit);
    addSection('Dirigido a', p.audience);
    addSection('Desarrollo del tema', p.temario);
    addSection('Consideraciones', p.considerations);
    addSection('Notas de la propuesta', p.notes);

    children.push(new Paragraph({ text:'Inversión', heading:HeadingLevel.HEADING_2 }));
    const border = { style:BorderStyle.SINGLE, size:1, color:'D6DFDB' };
    const rows = [new TableRow({ children:['Servicio','Duración','Precio','Importe'].map(x => new TableCell({children:[new Paragraph({children:[new TextRun({text:x,bold:true})]})],borders:{top:border,bottom:border,left:border,right:border}})) })];
    (p.concepts || []).forEach(c => rows.push(new TableRow({ children:[
      c.service || '', c.duration || '', money(c.price), money((Number(c.price)||0)*(Number(c.qty)||1))
    ].map(x => new TableCell({children:[new Paragraph(String(x))],borders:{top:border,bottom:border,left:border,right:border}})) })));
    children.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, spacing:{before:220}, children:[new TextRun(`Subtotal: ${money(totals.subtotal)}`)] }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, text:`Descuento: ${Number(p.discount)||0}%` }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, text:`IVA: ${Number(p.iva ?? 16)}%` }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, children:[new TextRun({text:`Total: ${money(totals.total)}`,bold:true,size:30})] }));
    children.push(new Paragraph({ alignment:AlignmentType.CENTER, spacing:{before:400}, text:'DEX México · www.dexmexico.com' }));

    const doc = new Document({ sections:[{ properties:{}, children }] });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="Propuesta_DEX_${Date.now()}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'No fue posible generar el Word.'});
  }
});

app.get('*', (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, () => console.log(`Cotizador DEX 2.0 en puerto ${PORT}`));
