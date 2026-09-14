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

app.post('/api/export/pdf', (req,res) => {
  const p = req.body || {};
  const totals = proposalTotals(p);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="Propuesta_DEX_${Date.now()}.pdf"`);
  const doc = new PDFDocument({ size:'LETTER', margins:{top:54,bottom:54,left:54,right:54} });
  doc.pipe(res);
  const navy = '#0b3658', green='#166b59', muted='#65736d';
  doc.fillColor(navy).fontSize(22).font('Helvetica-Bold').text('DEX México');
  doc.fontSize(10).fillColor(muted).font('Helvetica').text('Propuesta comercial');
  doc.moveDown(1.2);
  doc.fillColor(navy).fontSize(18).font('Helvetica-Bold').text(p.title || 'Propuesta de servicio');
  doc.moveDown(.4);
  doc.fontSize(10).fillColor('#333').font('Helvetica').text(`Cliente: ${p.client || '—'}   |   Contacto: ${p.contact || '—'}`);
  doc.text(`Correo: ${p.email || '—'}   |   WhatsApp: ${p.whatsapp || '—'}   |   Vigencia: ${p.validity || '15 días'}`);
  doc.moveDown(1);

  const section = (title, body) => {
    if (!body) return;
    if (doc.y > 680) doc.addPage();
    doc.fillColor(green).fontSize(12).font('Helvetica-Bold').text(title);
    doc.moveDown(.25);
    doc.fillColor('#222').fontSize(10).font('Helvetica').text(String(body), { lineGap: 2 });
    doc.moveDown(.7);
  };
  section('Presentación', p.presentation);
  section('Objetivos', p.objectives);
  section('Función / beneficio principal', p.benefit);
  section('Dirigido a', p.audience);
  section('Desarrollo del tema', p.temario);
  section('Consideraciones', p.considerations);
  section('Notas de la propuesta', p.notes);

  if (doc.y > 560) doc.addPage();
  doc.fillColor(navy).fontSize(14).font('Helvetica-Bold').text('Inversión');
  doc.moveDown(.5);
  (p.concepts || []).forEach(c => {
    doc.fontSize(10).fillColor('#222').font('Helvetica-Bold').text(c.service || 'Servicio', {continued:true});
    doc.font('Helvetica').text(`   ${c.duration || ''}   ${money((Number(c.price)||0)*(Number(c.qty)||1))}`, {align:'right'});
  });
  doc.moveDown(.5);
  doc.font('Helvetica').text(`Subtotal: ${money(totals.subtotal)}`, {align:'right'});
  doc.text(`Descuento: ${Number(p.discount)||0}%`, {align:'right'});
  doc.text(`IVA: ${Number(p.iva ?? 16)}%`, {align:'right'});
  doc.font('Helvetica-Bold').fontSize(14).fillColor(green).text(`Total: ${money(totals.total)}`, {align:'right'});
  doc.moveDown(2);
  doc.fontSize(9).fillColor(muted).font('Helvetica').text('DEX México · www.dexmexico.com', {align:'center'});
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
    children.push(new Paragraph({ text:`Correo: ${p.email || '—'}   |   WhatsApp: ${p.whatsapp || '—'}   |   Vigencia: ${p.validity || '15 días'}`, spacing:{after:220} }));
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
