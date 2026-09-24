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

// Historial persistente opcional (Supabase). Si no está configurado,
// el frontend usa respaldo local en el navegador para no bloquear la operación.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

// Generación profesional DEXI con OpenAI. La clave vive solo en Render.
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '');
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.6-luna');
const HAS_OPENAI = Boolean(OPENAI_API_KEY);

async function supabaseFetch(resource, options = {}) {
  if (!HAS_SUPABASE) throw new Error('SUPABASE_NOT_CONFIGURED');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

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
  const base = match
    ? `TEMARIO DEX DE REFERENCIA (úsalo como base, adáptalo y conserva profundidad técnica):\n${match.temario}`
    : 'No existe un temario DEX suficientemente equivalente. Desarrolla uno profesional desde cero y evita inventar normas, ediciones o requisitos.';
  return `Actúa como diseñador instruccional senior y redactor técnico-comercial de DEX México.\n\nSOLICITUD DEL CLIENTE (tal como la recibió la vendedora):\n${query}\n\nDATOS DETECTADOS:\n- Duración: ${parsed.hours || 'por definir'} horas\n- Modalidad: ${parsed.modality || 'por definir'}\n- Participantes: ${parsed.participants || 'por definir'}\n\n${base}\n\nOBJETIVO: construir una propuesta lista para que la vendedora solo supervise y haga correcciones mínimas.\n\nREGLAS DE PROFUNDIDAD DEL TEMARIO:\n- 4 horas: mínimo 3 módulos y 9 subtemas.\n- 8 horas: mínimo 4 módulos y 12 subtemas.\n- 12 horas: mínimo 5 módulos y 15 subtemas.\n- 16 horas: mínimo 6 módulos y 18 subtemas.\n- Más de 16 horas: aumenta módulos, ejercicios, casos y aplicación práctica proporcionalmente.\n- El contenido debe ser técnico, concreto y coherente con la duración; evita frases genéricas o temarios superficiales.\n\nDEVUELVE ÚNICAMENTE JSON VÁLIDO, SIN markdown, SIN explicaciones adicionales, con esta estructura exacta:\n{\n  "title": "Título profesional del curso o servicio",\n  "presentation": "Presentación comercial de 1 a 2 párrafos",\n  "objectives": ["Objetivo específico 1", "Objetivo específico 2", "Objetivo específico 3", "Objetivo específico 4"],\n  "benefit": "Función o beneficio principal del servicio",\n  "audience": "Perfil de participantes a quienes va dirigido",\n  "modality": "presencial|online|hibrida|por definir",\n  "durationHours": ${parsed.hours || 'null'},\n  "participants": ${parsed.participants || 'null'},\n  "temario": "MÓDULO I. ...\\n- ...\\n- ...\\n\\nMÓDULO II. ...",\n  "considerations": ["Solo consideraciones adicionales específicas del servicio, si aplican"],\n  "notes": "Metodología, entregables o notas relevantes si aplican"\n}\n\nNo incluyas precios. El precio lo calcula DEXI con información comercial interna. Las consideraciones comerciales estándar de DEX se insertan automáticamente; usa "considerations" solo para condiciones adicionales específicas del servicio.`;
}

app.get('/api/meta', (_req,res) => {
  res.json({ temarios: TEMARIOS.length, precios: PRECIOS.length, historicos: HISTORICOS.length, consultores: CONSULTORES.length, aiPaid: HAS_OPENAI, aiModel: HAS_OPENAI ? OPENAI_MODEL : null, persistentHistory: HAS_SUPABASE });
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


function dexiMatchInfo(query) {
  const best = topMatches(query, TEMARIOS, 'title', 1)[0] || null;
  if (!best) return { type:'new', match:null };
  const score = Number(best.score.toFixed(3));
  // Evita forzar temas lejanos: una coincidencia baja solo sirve para detectar que el tema es nuevo.
  if (score >= 0.55) return { type:'direct', match:{...best.item, score} };
  if (score >= 0.30) return { type:'partial', match:{...best.item, score} };
  return { type:'new', match:null };
}

function dexiDepthRules(hours) {
  const h = Number(hours || 0);
  if (!h) return 'Si la duración aún no está definida, desarrolla entre 4 y 6 módulos con profundidad suficiente y evita contenido de relleno.';
  if (h <= 4) return 'Desarrolla mínimo 3 módulos y entre 9 y 12 subtemas en total.';
  if (h <= 8) return 'Desarrolla entre 4 y 5 módulos y entre 12 y 18 subtemas en total.';
  if (h <= 12) return 'Desarrolla entre 5 y 6 módulos y entre 15 y 22 subtemas en total.';
  if (h <= 16) return 'Desarrolla entre 6 y 8 módulos y entre 20 y 28 subtemas en total.';
  if (h <= 24) return 'Desarrolla entre 8 y 10 módulos y entre 28 y 40 subtemas en total.';
  return 'Desarrolla entre 10 y 14 módulos y entre 40 y 60 subtemas en total, ajustando la profundidad al número de horas.';
}

function dexiSystemPrompt() {
  return `Eres DEXI, asistente técnico-comercial de DEX México, empresa de capacitación y consultoría industrial. Tu trabajo es convertir una solicitud comercial informal en una propuesta de capacitación profesional, específica, técnicamente coherente y lista para revisión humana.

REGLAS INNEGOCIABLES:
- Redacta en español profesional, natural y concreto; evita frases genéricas y repetitivas.
- No inventes precios. DEX calcula precios con su motor comercial interno.
- No inventes ediciones de normas, cláusulas, certificaciones, acreditaciones ni requisitos que el cliente no haya solicitado o que la referencia proporcionada no sustente.
- Si existe una referencia DEX directa, úsala como base y adáptala a la necesidad real del cliente.
- Si la referencia es parcial, úsala solo como orientación de estructura/profundidad; no mezcles contenido técnico que no corresponda.
- Si el tema es nuevo, desarrolla el contenido desde cero con criterio de diseñador instruccional senior.
- El temario debe ser proporcional a la duración, sin inflarlo artificialmente y sin quedarse superficial.
- El objetivo general debe expresar el resultado global del entrenamiento. Los objetivos específicos deben ser accionables.
- La presentación debe explicar el contexto, propósito y valor del entrenamiento, no repetir literalmente el objetivo.
- La función/beneficio debe explicar el impacto organizacional esperado.
- Dirigido a debe describir perfiles, áreas o roles pertinentes, sin inventar nombres de puestos demasiado específicos cuando no se conocen.
- La metodología y entregables van en notes; no incluyas condiciones comerciales estándar de DEX.
- Si falta modalidad, duración o participantes, conserva "por definir"/null en lugar de inventarlos.`;
}

function dexiUserPrompt(query, parsed, matchInfo) {
  let reference = 'No existe una referencia DEX suficientemente cercana. Desarrolla la propuesta desde cero.';
  if (matchInfo.match) {
    const use = matchInfo.type === 'direct'
      ? 'Referencia DEX directa: úsala como base principal y adáptala.'
      : 'Referencia DEX parcial: úsala solo como orientación; no copies elementos que no correspondan.';
    reference = `${use}\nTítulo: ${matchInfo.match.title}\nTemario de referencia:\n${matchInfo.match.temario}`;
  }
  return `SOLICITUD DEL CLIENTE:\n${query}\n\nDATOS DETECTADOS:\n- Duración: ${parsed.hours || 'por definir'} horas\n- Modalidad: ${parsed.modality || 'por definir'}\n- Participantes: ${parsed.participants || 'por definir'}\n\nTIPO DE COINCIDENCIA: ${matchInfo.type}\n${reference}\n\nPROFUNDIDAD REQUERIDA:\n${dexiDepthRules(parsed.hours)}\n\nGenera una propuesta completa que incluya título, presentación, objetivo general, 4 a 6 objetivos específicos, función/beneficio, dirigido a, temario modular, modalidad, duración, participantes y notas de metodología/entregables. No generes precio.`;
}

const DEXI_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type:'string' },
    presentation: { type:'string' },
    objectiveGeneral: { type:'string' },
    objectives: { type:'array', items:{ type:'string' }, minItems:4, maxItems:6 },
    benefit: { type:'string' },
    audience: { type:'string' },
    modality: { type:'string', enum:['presencial','online','hibrida','por definir'] },
    durationHours: { type:['number','null'] },
    participants: { type:['integer','null'] },
    temario: {
      type:'array',
      minItems:3,
      items:{
        type:'object',
        additionalProperties:false,
        properties:{
          title:{ type:'string' },
          items:{ type:'array', items:{ type:'string' }, minItems:2 }
        },
        required:['title','items']
      }
    },
    considerations: { type:'array', items:{ type:'string' } },
    notes: { type:'string' }
  },
  required:['title','presentation','objectiveGeneral','objectives','benefit','audience','modality','durationHours','participants','temario','considerations','notes']
};

function responseOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of (data?.output || [])) {
    for (const c of (item?.content || [])) {
      if ((c?.type === 'output_text' || c?.type === 'text') && typeof c.text === 'string') chunks.push(c.text);
    }
  }
  return chunks.join('').trim();
}

async function openAiStructuredProposal(query, parsed, matchInfo) {
  if (!HAS_OPENAI) throw new Error('OPENAI_NOT_CONFIGURED');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model: OPENAI_MODEL,
      input:[
        { role:'system', content:dexiSystemPrompt() },
        { role:'user', content:dexiUserPrompt(query, parsed, matchInfo) }
      ],
      text:{
        format:{
          type:'json_schema',
          name:'dexi_proposal',
          strict:true,
          schema:DEXI_PROPOSAL_SCHEMA
        }
      }
    })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const msg = data?.error?.message || `OpenAI ${response.status}`;
    const err = new Error(msg); err.status = response.status; throw err;
  }
  const text = responseOutputText(data);
  if (!text) throw new Error('OpenAI no devolvió contenido utilizable.');
  let proposal;
  try { proposal = JSON.parse(text); } catch { throw new Error('La respuesta de OpenAI no pudo convertirse en la estructura de propuesta.'); }
  return { proposal, model:data?.model || OPENAI_MODEL, usage:data?.usage || null, responseId:data?.id || null };
}

app.post('/api/dexi/generate', async (req,res) => {
  const query = String(req.body.query || '').trim();
  if (!query) return res.status(400).json({ error:'Describe primero lo que solicitó el cliente.' });
  if (!HAS_OPENAI) return res.status(503).json({ error:'DEXI todavía no tiene conectada la API de OpenAI.' });
  const parsed = parseRequest(query, req.body || {});
  const matchInfo = dexiMatchInfo(query);
  const price = getPriceSuggestion(query, matchInfo.match?.title, parsed);
  try {
    const ai = await openAiStructuredProposal(query, parsed, matchInfo);
    res.json({ parsed, matchType:matchInfo.type, match:matchInfo.match, price, generation:ai.proposal, ai:{model:ai.model,usage:ai.usage,responseId:ai.responseId} });
  } catch (e) {
    console.error('DEXI OpenAI error:', e.message);
    const status = e.status === 401 ? 401 : e.status === 429 ? 429 : 502;
    const friendly = status === 401
      ? 'La API key de OpenAI no fue aceptada. Revisa OPENAI_API_KEY en Render.'
      : status === 429
        ? 'OpenAI rechazó temporalmente la solicitud por saldo, límite o capacidad. Revisa Billing/Limits y vuelve a intentar.'
        : 'No fue posible generar la propuesta con OpenAI en este momento.';
    res.status(status).json({ error:friendly, detail:process.env.NODE_ENV === 'development' ? e.message : undefined });
  }
});

app.get('/api/storage/status', (_req,res) => {
  res.json({ persistent: HAS_SUPABASE, provider: HAS_SUPABASE ? 'supabase' : 'browser-fallback' });
});

app.get('/api/quotes', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false });
  try {
    const q = String(req.query.q || '').trim();
    let resource = 'dex_cotizaciones?select=*&order=created_at.desc&limit=100';
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      resource += `&or=(folio.ilike.*${encodeURIComponent(safe)}*,cliente.ilike.*${encodeURIComponent(safe)}*,titulo.ilike.*${encodeURIComponent(safe)}*)`;
    }
    const rows = await supabaseFetch(resource, { method:'GET', headers:{Prefer:'return=minimal'} });
    res.json(rows || []);
  } catch (e) {
    console.error(e); res.status(500).json({error:'No fue posible consultar el historial compartido.'});
  }
});

app.post('/api/quotes', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false });
  try {
    const p = req.body || {};
    const totals = proposalTotals(p);
    const payload = {
      folio: null,
      cliente: p.client || null,
      contacto: p.contact || null,
      titulo: p.title || null,
      solicitud_cliente: p.clientRequest || null,
      modalidad: p.modality || null,
      duracion: p.durationTotal || null,
      participantes: p.participants || null,
      plantilla: p.template || 'A',
      estado: p.status || 'Borrador',
      monto_cotizado: Number(totals.total || 0),
      monto_contratado: p.contractedAmount == null || p.contractedAmount === '' ? null : Number(p.contractedAmount),
      vendedor: p.seller || 'Equipo DEX',
      data: p
    };
    const inserted = await supabaseFetch('dex_cotizaciones?select=*', { method:'POST', body:JSON.stringify(payload) });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!row?.id) throw new Error('No se recibió ID de cotización.');
    const year = new Date(row.created_at || Date.now()).getFullYear();
    const folio = `DEX-${year}-${String(row.id).padStart(4,'0')}`;
    const updated = await supabaseFetch(`dex_cotizaciones?id=eq.${row.id}&select=*`, { method:'PATCH', body:JSON.stringify({folio}) });
    res.json((Array.isArray(updated) ? updated[0] : updated) || {...row,folio});
  } catch (e) {
    console.error(e); res.status(500).json({error:'No fue posible guardar la cotización en el historial compartido.'});
  }
});

app.patch('/api/quotes/:id', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false });
  try {
    const allowed = {};
    if (req.body.estado !== undefined) allowed.estado = req.body.estado;
    if (req.body.monto_contratado !== undefined) allowed.monto_contratado = req.body.monto_contratado === '' ? null : Number(req.body.monto_contratado);
    const rows = await supabaseFetch(`dex_cotizaciones?id=eq.${Number(req.params.id)}&select=*`, {method:'PATCH',body:JSON.stringify(allowed)});
    res.json(Array.isArray(rows)?rows[0]:rows);
  } catch(e){ console.error(e); res.status(500).json({error:'No fue posible actualizar la cotización.'}); }
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


function standardConsiderationsServer(p={}) {
  const min = String(p.participantsMin || '').trim();
  const max = String(p.participantsMax || '').trim();
  const range = min && max ? `${min} a ${max}` : min ? min : max ? `hasta ${max}` : '_ a _';
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
function drawTaxBreakdown(doc, p, totals, y, palette, variant='A') {
  const x=40,w=515,cell=w/3;
  const bg=variant==='C'?'#fffaf0':variant==='B'?'#f4f8f6':'#f3fafb';
  const accent=variant==='C'?palette.gold:palette.accent;
  doc.roundedRect(x,y,w,62,8).fill(bg).strokeColor(palette.line).lineWidth(.7).stroke();
  const items=[
    ['SUBTOTAL',money(totals.afterDiscount)],
    [`IVA ${Number(p.iva ?? 16)||0}%`,money(totals.iva)],
    ['TOTAL CON IVA',money(totals.total)]
  ];
  items.forEach((it,i)=>{
    const xx=x+i*cell;
    if(i>0) doc.moveTo(xx,y+10).lineTo(xx,y+52).strokeColor(palette.line).lineWidth(.6).stroke();
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(6.6).text(it[0],xx+10,y+13,{width:cell-20,align:'center'});
    doc.fillColor(palette.dark).fontSize(i===2?13.5:11).text(it[1],xx+10,y+31,{width:cell-20,align:'center'});
  });
  doc.fillColor(palette.muted).font('Helvetica').fontSize(7.2).text('El importe total mostrado ya incluye el IVA correspondiente.',x,y+69,{width:w,align:'right'});
  return y+88;
}

function addClosingPage(doc, p, totals, palette, variant='A') {
  doc.addPage({size:'A4',margin:0}); let y=48;
  doc.fillColor(variant==='C'?palette.gold:palette.accent).font('Helvetica-Bold').fontSize(8).text('03 | PROPUESTA ECONÓMICA Y CIERRE',40,y);
  y+=22; doc.fillColor(palette.dark).fontSize(20).text('Inversión, consideraciones y contacto',40,y); y+=40;
  if(variant==='B'){
    doc.roundedRect(40,y,515,105,14).fill(palette.dark); doc.fillColor('#87dac9').fontSize(7).text('SERVICIO COTIZADO',58,y+16); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+32,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+57,{width:300}); doc.fillColor('#e7bb59').fontSize(24).font('Helvetica-Bold').text(money(totals.total),360,y+31,{width:175,align:'right'}); doc.fontSize(8).fillColor('#fff').text('TOTAL CON IVA',430,y+68,{width:105,align:'right'});
  } else if(variant==='C'){
    doc.roundedRect(40,y,515,105,12).fill(palette.dark); doc.fillColor('#dbc995').fontSize(7).text('INVERSIÓN',58,y+16); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+32,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+57,{width:300}); doc.fillColor('#f1d28f').fontSize(24).font('Helvetica-Bold').text(money(totals.total),360,y+31,{width:175,align:'right'}); doc.fontSize(8).fillColor('#fff').text('TOTAL CON IVA',430,y+68,{width:105,align:'right'});
  } else {
    doc.rect(40,y,340,105).fill(palette.dark); doc.rect(380,y,175,105).fill(palette.accent); doc.fillColor('#75d7dd').fontSize(7).text('SERVICIO COTIZADO',58,y+16); doc.fillColor('#fff').fontSize(14).text(p.title||'Servicio DEX',58,y+32,{width:300}); doc.fontSize(9).text(`${p.durationTotal||''} · ${p.participants||''}`,58,y+58,{width:300}); doc.fontSize(23).font('Helvetica-Bold').text(money(totals.total),390,y+29,{width:155,align:'center'}); doc.fontSize(8).text('TOTAL CON IVA',390,y+67,{width:155,align:'center'});
  }
  y+=118;
  y=drawTaxBreakdown(doc,p,totals,y,palette,variant);
  doc.fillColor(variant==='C'?palette.gold:palette.accent).font('Helvetica-Bold').fontSize(8).text('CONSIDERACIONES',40,y); y+=17;
  const cond=(p.considerations||standardConsiderationsServer(p)).split(/\r?\n/).filter(Boolean);
  doc.font('Helvetica').fontSize(7.7).fillColor(palette.ink);
  for(const line of cond){
    const txt='• '+line;
    const h=doc.heightOfString(txt,{width:499,lineGap:1})+5;
    if(y+h>730){
      drawFooter(doc,'DEX México · Consideraciones');
      doc.addPage({size:'A4',margin:0});
      y=58;
      doc.fillColor(variant==='C'?palette.gold:palette.accent).font('Helvetica-Bold').fontSize(8).text('CONSIDERACIONES (CONTINUACIÓN)',40,y);
      y+=18;
      doc.font('Helvetica').fontSize(7.7).fillColor(palette.ink);
    }
    doc.text(txt,48,y,{width:499,lineGap:1}); y=doc.y+4;
  }
  if(p.notes){
    y+=4;
    const noteH=doc.heightOfString(p.notes,{width:499,lineGap:1})+32;
    if(y+noteH>730){ drawFooter(doc,'DEX México · Consideraciones'); doc.addPage({size:'A4',margin:0}); y=58; }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(variant==='C'?palette.gold:palette.accent).text('NOTAS',40,y); y+=15;
    doc.font('Helvetica').fontSize(8).fillColor(palette.ink).text(p.notes,48,y,{width:499,lineGap:1}); y=doc.y+10;
  }
  if(y+124>790){ drawFooter(doc,'DEX México · Consideraciones'); doc.addPage({size:'A4',margin:0}); y=62; }
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
    addSection('Consideraciones', p.considerations || standardConsiderationsServer(p));
    addSection('Notas de la propuesta', p.notes);

    children.push(new Paragraph({ text:'Inversión', heading:HeadingLevel.HEADING_2 }));
    const border = { style:BorderStyle.SINGLE, size:1, color:'D6DFDB' };
    const rows = [new TableRow({ children:['Servicio','Duración','Precio','Importe'].map(x => new TableCell({children:[new Paragraph({children:[new TextRun({text:x,bold:true})]})],borders:{top:border,bottom:border,left:border,right:border}})) })];
    (p.concepts || []).forEach(c => rows.push(new TableRow({ children:[
      c.service || '', c.duration || '', money(c.price), money((Number(c.price)||0)*(Number(c.qty)||1))
    ].map(x => new TableCell({children:[new Paragraph(String(x))],borders:{top:border,bottom:border,left:border,right:border}})) })));
    children.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, spacing:{before:220}, children:[new TextRun(`Subtotal: ${money(totals.afterDiscount)}`)] }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, text:`Descuento aplicado: ${Number(p.discount)||0}%` }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, text:`IVA ${Number(p.iva ?? 16)}%: ${money(totals.iva)}` }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, children:[new TextRun({text:`Total con IVA: ${money(totals.total)}`,bold:true,size:30})] }));
    children.push(new Paragraph({ alignment:AlignmentType.RIGHT, text:'El importe total mostrado ya incluye el IVA correspondiente.' }));
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

app.listen(PORT, () => console.log(`Cotizador DEX 2.6 en puerto ${PORT}`));
