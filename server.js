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
  BorderStyle,
  ImageRun,
  PageBreak,
  VerticalAlign,
  Footer,
  TableLayoutType
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

// Historial persistente compartido (Supabase).
// Supabase está migrando de las claves legacy service_role (JWT) a claves secret sb_secret_... .
// El backend admite ambas. Las nuevas claves secret deben enviarse SOLO en el header apikey;
// enviarlas como Bearer provoca "Invalid JWT".
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVER_KEY = String(
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim();
const SUPABASE_KEY_IS_LEGACY_JWT = SUPABASE_SERVER_KEY.startsWith('eyJ');
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVER_KEY);

// Generación profesional DEXI. Gemini es el proveedor principal y OpenAI puede quedar como respaldo.
// Las claves viven solo en Render y nunca se exponen al navegador.
const GEMINI_API_KEY_PRIMARY = String(process.env.GEMINI_API_KEY || '');
const GEMINI_API_KEY_BACKUP = String(process.env.GEMINI_API_KEY_BACKUP || '');
const GEMINI_KEY_MODE = String(process.env.GEMINI_KEY_MODE || 'primary').trim().toLowerCase() === 'backup' ? 'backup' : 'primary';
const GEMINI_API_KEY = GEMINI_KEY_MODE === 'backup'
  ? (GEMINI_API_KEY_BACKUP || GEMINI_API_KEY_PRIMARY)
  : GEMINI_API_KEY_PRIMARY;
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash');
const GEMINI_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.GEMINI_MAX_ATTEMPTS || 2)));
const GEMINI_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const HAS_GEMINI = Boolean(GEMINI_API_KEY);

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '');
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.6-luna');
const HAS_OPENAI = Boolean(OPENAI_API_KEY);

const DEXI_PROVIDER = String(process.env.DEXI_AI_PROVIDER || (HAS_GEMINI ? 'gemini' : 'openai')).toLowerCase();
const HAS_AI = HAS_GEMINI || HAS_OPENAI;

async function supabaseFetch(resource, options = {}) {
  if (!HAS_SUPABASE) {
    const err = new Error('SUPABASE_NOT_CONFIGURED');
    err.status = 503;
    throw err;
  }

  const headers = {
    apikey: SUPABASE_SERVER_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(options.headers || {})
  };

  // Compatibilidad con la clave legacy service_role (JWT).
  // Para sb_secret_... NO se debe enviar Authorization: Bearer.
  if (SUPABASE_KEY_IS_LEGACY_JWT && !headers.Authorization) {
    headers.Authorization = `Bearer ${SUPABASE_SERVER_KEY}`;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`Supabase ${response.status}: ${text}`);
    err.status = response.status;
    err.supabaseBody = text;
    throw err;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function supabasePublicError(error) {
  const status = Number(error?.status || 500);
  const raw = String(error?.supabaseBody || error?.message || '');
  if (!HAS_SUPABASE) return { status:503, code:'SUPABASE_NOT_CONFIGURED', message:'Falta configurar Supabase en Render.' };
  if (status === 401 || /invalid jwt|api key|apikey|unauthorized/i.test(raw)) {
    return { status:503, code:'SUPABASE_AUTH', message:'Supabase rechazó la clave del servidor. Revisa la clave secret configurada en Render.' };
  }
  if (status === 404 || /dex_cotizaciones|relation .* does not exist/i.test(raw)) {
    return { status:503, code:'SUPABASE_SCHEMA', message:'No se encontró la tabla dex_cotizaciones. Ejecuta el esquema de Supabase del cotizador.' };
  }
  return { status:500, code:'SUPABASE_ERROR', message:'No fue posible conectar con el historial compartido.' };
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

function weightedMedian(entries = []) {
  const rows = entries
    .filter(x => Number.isFinite(Number(x.value)) && Number(x.weight) > 0)
    .map(x => ({ value:Number(x.value), weight:Number(x.weight) }))
    .sort((a,b) => a.value - b.value);
  if (!rows.length) return null;
  const total = rows.reduce((s,x) => s + x.weight, 0);
  let acc = 0;
  for (const row of rows) {
    acc += row.weight;
    if (acc >= total / 2) return row.value;
  }
  return rows[rows.length - 1].value;
}

function durationFit(rowHours, requestedHours) {
  const h = Number(rowHours), req = Number(requestedHours);
  if (!req || !h) return 0.55;
  const diff = Math.abs(h - req);
  if (diff === 0) return 1;
  if (diff <= 2) return 0.90;
  if (diff <= 4) return 0.55;
  if (diff <= 8) return 0.30;
  return 0.12;
}

function parseParticipantCount(value) {
  if (value == null || value === '') return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const text = String(value).replace(/,/g, '.');
  const nums = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0])).filter(Number.isFinite);
  if (!nums.length) return null;
  // Cuando el registro trae un rango (ej. 15 a 20), usamos su punto medio.
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  return nums[0];
}

function participantFit(rowParticipants, requestedParticipants) {
  const req = parseParticipantCount(requestedParticipants);
  const row = parseParticipantCount(rowParticipants);
  // Si la solicitud aún no define participantes, el tamaño del grupo no debe castigar el comparable.
  if (!req) return { fit:0.75, known:Boolean(row), row, requested:req, label:row ? 'Grupo disponible' : 'Grupo no definido' };
  // La ausencia del dato sigue permitiendo usar la referencia, pero con menor peso comercial.
  if (!row) return { fit:0.60, known:false, row:null, requested:req, label:'Participantes sin dato' };
  const diff = Math.abs(row - req);
  let fit = 0.30;
  if (diff <= 3) fit = 1;
  else if (diff <= 7) fit = 0.75;
  else if (diff <= 10) fit = 0.50;
  return { fit, known:true, row, requested:req, label:`Grupo comparable: ${Math.round(row)} vs ${Math.round(req)}` };
}

function leadershipComparableLevel(text = '') {
  const n = normalize(text);
  if (!n) return 'contextual';
  const strong = ['LIDERAZGO','SUPERVISION','SUPERVISOR','COACHING','GESTION DE EQUIPOS','DIRECCION DE EQUIPOS','MANDOS','DELEGACION'];
  const related = ['COMUNICACION ASERTIVA','COMUNICACION','RETROALIMENTACION','FEEDBACK','CONFLICTO','SERVICIO AL CLIENTE','CALIDAD EN EL SERVICIO'];
  if (strong.some(term => n.includes(normalize(term)))) return 'strong';
  if (related.some(term => n.includes(normalize(term)))) return 'related';
  return 'contextual';
}

function refineFamilyRelevance(family, rowText, rel) {
  if (family !== 'liderazgo_personas' || !rel) return rel;
  const level = leadershipComparableLevel(rowText);
  if (level === 'strong') return rel;
  if (level === 'related' && rel.tier === 'strong') {
    return {...rel, tier:'related', label:'Relacionada', weight:Math.max(0.05, rel.weight * 0.72)};
  }
  if (level === 'contextual' && rel.tier !== 'contextual') {
    return {...rel, tier:'contextual', label:'Contextual', weight:Math.max(0.03, rel.weight * 0.35)};
  }
  return rel;
}

function relevanceTier({ sameFamily, sim, rowHours, requestedHours, rowParticipants, requestedParticipants }) {
  const d = durationFit(rowHours, requestedHours);
  const pf = participantFit(rowParticipants, requestedParticipants);
  if (!sameFamily) return { tier:'contextual', label:'Contextual', weight:0.05 * pf.fit, durationFit:d, participantFit:pf.fit, participantKnown:pf.known, participantLabel:pf.label, rowParticipants:pf.row };
  const topical = Math.min(1, Math.max(0, Number(sim || 0)) / 0.35);
  // El peso final combina cercanía técnica/duración con el tamaño del grupo.
  const baseWeight = Math.max(0.08, Math.min(1, d * (0.70 + topical * 0.30)));
  const weight = Math.max(0.05, Math.min(1, baseWeight * pf.fit));
  if (d >= 0.90 && (topical >= 0.18 || Number(rowHours) === Number(requestedHours))) {
    return { tier:'strong', label:'Fuerte', weight, durationFit:d, participantFit:pf.fit, participantKnown:pf.known, participantLabel:pf.label, rowParticipants:pf.row };
  }
  if (d >= 0.55 || topical >= 0.45) {
    return { tier:'related', label:'Relacionada', weight, durationFit:d, participantFit:pf.fit, participantKnown:pf.known, participantLabel:pf.label, rowParticipants:pf.row };
  }
  return { tier:'contextual', label:'Contextual', weight, durationFit:d, participantFit:pf.fit, participantKnown:pf.known, participantLabel:pf.label, rowParticipants:pf.row };
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

function percentile(nums, p) {
  const v = nums.filter(n => Number.isFinite(n)).sort((a,b) => a-b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return v[lo];
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

const PRICE_FAMILIES = {
  core_tools: {
    strong: ['CORE TOOLS','APQP','PPAP','AMEF','FMEA','MSA','SPC','PLAN DE CONTROL','CONTROL PLAN'],
    weak: []
  },
  calidad_procesos: {
    strong: ['SCRAP','DESPERDICIO','MERMA','DEFECTO','8D','A3','5 PORQUES','ISHIKAWA','CAUSA RAIZ','RCA','MEJORA CONTINUA','LEAN','SIX SIGMA','DMAIC','CONTROL ESTADISTICO','CAPACIDAD DE PROCESO','MANUFACTURA','INYECCION','MOLDEO','PROCESO DE PRODUCCION'],
    weak: ['CALIDAD','PROCESO','PRODUCCION']
  },
  sistemas_gestion: {
    strong: ['ISO 9001','ISO 14001','ISO 45001','ISO 19011','IATF','VDA','AUDITORIA','AUDITOR','SISTEMA DE GESTION'],
    weak: ['ISO']
  },
  liderazgo_personas: {
    strong: ['CALIDAD EN EL SERVICIO','SERVICIO AL CLIENTE','COMUNICACION ASERTIVA','LIDERAZGO','SUPERVISION','COACHING','EQUIPOS','RETROALIMENTACION','DELEGACION','CONFLICTO'],
    weak: ['COMUNICACION','PERSONAL']
  },
  seguridad: {
    strong: ['SEGURIDAD','LOTO','BLOQUEO ETIQUETADO','ERGONOMIA','GRUAS','DERRAMES','RIESGO','EPP'],
    weak: ['NOM','STPS']
  },
  datos_software: {
    strong: ['EXCEL','POWER BI','MINITAB','MACROS','VBA','AUTOMATIZACION'],
    weak: ['DATOS']
  },
  logistica_operaciones: {
    strong: ['LOGISTICA','INVENTARIO','ALMACEN','CADENA DE SUMINISTRO','COMERCIO EXTERIOR','ADUANA','KANBAN'],
    weak: ['OPERACIONES']
  }
};

// Política comercial DEX: piso interno para evitar que históricos viejos o temas poco comparables
// empujen hacia abajo las propuestas técnicas especializadas. Se aplica solo a familias calibradas.
const DEX_COMMERCIAL_POLICY = {
  core_tools: {
    presencial: [
      {maxHours:4, competitive:15000, recommended:18000, premium:22000},
      {maxHours:8, competitive:22000, recommended:26000, premium:30000},
      {maxHours:12, competitive:26000, recommended:30000, premium:35000},
      {maxHours:16, competitive:32000, recommended:38000, premium:44000},
      {maxHours:24, competitive:46000, recommended:52000, premium:60000}
    ]
  },
  calidad_procesos: {
    presencial: [
      {maxHours:4, competitive:15000, recommended:18000, premium:22000},
      {maxHours:8, competitive:22000, recommended:26000, premium:29500},
      {maxHours:12, competitive:26000, recommended:30000, premium:35000},
      {maxHours:16, competitive:32000, recommended:38000, premium:44000},
      {maxHours:24, competitive:46000, recommended:52000, premium:60000}
    ]
  }
};

function containsFamilyTerm(normalizedText, term) {
  const n = ` ${normalizedText} `;
  const t = ` ${normalize(term)} `;
  return n.includes(t);
}

function priceFamily(text = '') {
  const n = normalize(text);
  if (!n) return null;

  // Clasificadores prioritarios. Evitan que palabras genéricas como PROCESO,
  // MANUFACTURA, RIESGO o VDA desplacen a una familia explícita.
  // En especial, AMEF AIAG & VDA debe seguir siendo CORE TOOLS.
  const hardRules = [
    ['core_tools', ['CORE TOOLS','AMEF','FMEA','APQP','PPAP','MSA','SPC','PLAN DE CONTROL','CONTROL PLAN']],
    ['sistemas_gestion', ['ISO 9001','ISO 14001','ISO 45001','ISO 19011','IATF 16949','IATF','VDA 6 3','VDA 6 5','AUDITORIA','AUDITOR','SISTEMA DE GESTION']],
    ['liderazgo_personas', ['LIDERAZGO','COACHING','SUPERVISION','COMUNICACION ASERTIVA','SERVICIO AL CLIENTE','CALIDAD EN EL SERVICIO','RETROALIMENTACION','DELEGACION','CONFLICTO']],
    ['datos_software', ['EXCEL','POWER BI','MINITAB','MACROS','VBA']],
    ['seguridad', ['LOTO','BLOQUEO ETIQUETADO','ERGONOMIA','GRUAS','DERRAMES','EPP']],
    ['logistica_operaciones', ['LOGISTICA','INVENTARIO','ALMACEN','CADENA DE SUMINISTRO','COMERCIO EXTERIOR','ADUANA']],
    ['calidad_procesos', ['SCRAP','DESPERDICIO','MERMA','8D','A3','5 PORQUES','ISHIKAWA','CAUSA RAIZ','RCA','LEAN','SIX SIGMA','DMAIC','CAPACIDAD DE PROCESO','INYECCION','MOLDEO']]
  ];

  for (const [family, terms] of hardRules) {
    if (terms.some(term => containsFamilyTerm(n, term))) return family;
  }

  // Fallback por puntuación para solicitudes menos explícitas.
  let best = null, bestScore = 0;
  for (const [family, cfg] of Object.entries(PRICE_FAMILIES)) {
    let score = 0;
    for (const w of cfg.strong || []) if (n.includes(normalize(w))) score += 3;
    for (const w of cfg.weak || []) if (n.includes(normalize(w))) score += 0.5;
    if (score > bestScore) { bestScore = score; best = family; }
  }
  // Una sola palabra genérica como CALIDAD/PROCESO no basta para clasificar una familia técnica.
  return bestScore >= 1.5 ? best : null;
}

function policyFor(family, modality, requestedHours) {
  const familyPolicy = DEX_COMMERCIAL_POLICY[family];
  if (!familyPolicy || !requestedHours) return null;
  const rows = familyPolicy.presencial || [];
  if (!rows.length) return null;
  const base = rows.find(r => requestedHours <= r.maxHours) || rows[rows.length - 1];
  const scale = requestedHours > base.maxHours ? requestedHours / base.maxHours : 1;
  const modalityFactor = modality === 'online' ? 0.85 : modality === 'hibrida' ? 0.93 : 1;
  return {
    competitive: round500(base.competitive * scale * modalityFactor),
    recommended: round500(base.recommended * scale * modalityFactor),
    premium: round500(base.premium * scale * modalityFactor),
    floor: round500(base.competitive * scale * modalityFactor),
    source: 'Política comercial DEX para capacitación técnica especializada'
  };
}

function parseHoursValue(value) {
  if (value == null || value === '') return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

async function sharedContractedHistory() {
  if (!HAS_SUPABASE) return [];
  try {
    // Solo operaciones realmente contratadas alimentan el aprendizaje comercial.
    const rows = await supabaseFetch('dex_cotizaciones?select=cliente,titulo,modalidad,duracion,participantes,monto_contratado,data,updated_at&monto_contratado=gt.0&order=updated_at.desc&limit=200', { method:'GET', headers:{Prefer:'return=minimal'} });
    return (Array.isArray(rows) ? rows : []).map(row => {
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      return {
        cliente: row.cliente || data.client || '',
        entrenamiento: row.titulo || data.title || '',
        horas: parseHoursValue(row.duracion || data.durationTotal || data.durationHours),
        importe: Number(row.monto_contratado || 0),
        participantes: parseParticipantCount(row.participantes || data.participants || data.participantsQuoted),
        modalidad: String(row.modalidad || data.modality || '').toLowerCase() || null,
        sourceType:'supabase'
      };
    }).filter(r => r.entrenamiento && Number.isFinite(r.importe) && r.importe > 0);
  } catch (e) {
    console.warn('[DEXI pricing] No fue posible consultar operaciones contratadas de Supabase:', e.message);
    return [];
  }
}

function adjustedAmount(amount, rowHours, requestedHours) {
  const a = Number(amount), h = Number(rowHours), req = Number(requestedHours);
  if (!Number.isFinite(a) || a <= 0) return null;
  if (req && h && h > 0 && req !== h) return a / h * req;
  return a;
}

async function getPriceSuggestion(query, courseTitle, parsed) {
  const target = [courseTitle, query].filter(Boolean).join(' ');
  const modality = parsed.modality || 'presencial';
  const requestedHours = Number(parsed.hours || 0) || null;
  const requestedParticipants = parseParticipantCount(parsed.participants);
  const family = priceFamily(target);
  const desiredType = parsed.openCourse ? 'personal' : 'empresa';
  const policy = policyFor(family, modality, requestedHours);

  const matrixRows = PRECIOS
    .filter(r => !r.tipo || r.tipo === desiredType || (!parsed.openCourse && r.tipo === 'empresa'))
    .map(item => {
      const raw = Number(item[modality]);
      if (!Number.isFinite(raw) || raw <= 0) return null;
      const sim = similarity(target, item.curso || '');
      const rowFamily = priceFamily(item.curso || '');
      const sameFamily = Boolean(family && rowFamily === family);
      const h = Number(item.horas || 0) || null;
      const rowParticipants = parseParticipantCount(item.participantes || item.participants || item.participantesMax || item.participantesMin);
      let rel = relevanceTier({ sameFamily, sim, rowHours:h, requestedHours, rowParticipants, requestedParticipants });
      rel = refineFamilyRelevance(family, item.curso || '', rel);
      const commercialScore = sim * 0.40 + (sameFamily ? 0.25 : 0) + rel.durationFit * 0.20 + rel.participantFit * 0.15;
      return {
        item, sim, rowFamily, sameFamily, commercialScore,
        adjusted:adjustedAmount(raw,h,requestedHours),
        actualAmount:raw,
        relevance:rel.tier,
        relevanceLabel:rel.label,
        relevanceWeight:rel.weight,
        durationFit:rel.durationFit,
        participantFit:rel.participantFit,
        participantKnown:rel.participantKnown,
        participantLabel:rel.participantLabel,
        rowParticipants:rel.rowParticipants
      };
    })
    .filter(Boolean)
    .filter(x => !family || x.sameFamily)
    .sort((a,b) => (b.relevanceWeight * 0.65 + b.commercialScore * 0.35) - (a.relevanceWeight * 0.65 + a.commercialScore * 0.35));

  const sharedHistory = await sharedContractedHistory();
  const allHistory = [
    ...HISTORICOS.map(item => ({...item, sourceType:item.sourceType || 'legacy'})),
    ...sharedHistory
  ];

  const historyRows = allHistory.map(item => {
    const amount = Number(item.importe);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const sim = similarity(target, item.entrenamiento || '');
    const rowFamily = priceFamily(item.entrenamiento || '');
    const sameFamily = Boolean(family && rowFamily === family);
    const h = Number(item.horas || 0) || null;
    const rowParticipants = parseParticipantCount(item.participantes || item.participants);
    let rel = relevanceTier({ sameFamily, sim, rowHours:h, requestedHours, rowParticipants, requestedParticipants });
    rel = refineFamilyRelevance(family, item.entrenamiento || '', rel);
    const commercialScore = sim * 0.40 + (sameFamily ? 0.25 : 0) + rel.durationFit * 0.20 + rel.participantFit * 0.15;
    return {
      item, sim, rowFamily, sameFamily, commercialScore,
      adjusted:amount,
      actualAmount:amount,
      relevance:rel.tier,
      relevanceLabel:rel.label,
      relevanceWeight:rel.weight,
      durationFit:rel.durationFit,
      participantFit:rel.participantFit,
      participantKnown:rel.participantKnown,
      participantLabel:rel.participantLabel,
      rowParticipants:rel.rowParticipants
    };
  }).filter(Boolean)
    .filter(x => parsed.openCourse ? /ABIERTO/i.test(x.item.entrenamiento || '') : !/ABIERTO/i.test(x.item.entrenamiento || ''))
    .filter(x => !x.item.modalidad || !modality || String(x.item.modalidad).toLowerCase() === modality)
    .filter(x => !family || x.sameFamily)
    .sort((a,b) => (b.relevanceWeight * 0.65 + b.commercialScore * 0.35) - (a.relevanceWeight * 0.65 + a.commercialScore * 0.35));

  const usefulMatrix = matrixRows.filter(x => x.relevance !== 'contextual').slice(0,10);
  const usefulHistory = historyRows.filter(x => x.relevance !== 'contextual').slice(0,10);
  const contextualMatrix = matrixRows.filter(x => x.relevance === 'contextual').slice(0,4);
  const contextualHistory = historyRows.filter(x => x.relevance === 'contextual').slice(0,4);

  const matrixEvidence = usefulMatrix.length ? usefulMatrix : contextualMatrix;
  const historyEvidence = usefulHistory.length ? usefulHistory : contextualHistory;

  const matrixWeighted = weightedMedian(matrixEvidence.map(x => ({ value:x.adjusted, weight:x.relevanceWeight })));
  const historyWeighted = weightedMedian(historyEvidence.map(x => ({ value:x.actualAmount, weight:x.relevanceWeight })));
  const matrixMedianSimple = median(matrixEvidence.map(x => x.adjusted));
  const historicalMedianSimple = median(historyEvidence.map(x => x.actualAmount));

  const matrixStrong = matrixEvidence.filter(x => x.relevance === 'strong');
  const historyStrong = historyEvidence.filter(x => x.relevance === 'strong');
  const matrixRelated = matrixEvidence.filter(x => x.relevance === 'related');
  const historyRelated = historyEvidence.filter(x => x.relevance === 'related');

  let dataRecommended = null;
  let basis = 'Sin evidencia suficiente';
  const components = [];
  if (matrixWeighted) components.push({ value:matrixWeighted, weight: matrixStrong.length ? 0.55 : 0.40 });
  if (historyWeighted) components.push({ value:historyWeighted, weight: historyStrong.length ? 0.35 : 0.25 });

  if (!components.length) {
    const fallback = weightedMedian([
      ...contextualMatrix.map(x => ({value:x.adjusted, weight:x.relevanceWeight * 0.20})),
      ...contextualHistory.map(x => ({value:x.actualAmount, weight:x.relevanceWeight * 0.15}))
    ]);
    if (fallback) components.push({ value:fallback, weight:0.15 });
  }

  const totalW = components.reduce((s,x) => s + x.weight, 0);
  if (totalW) dataRecommended = components.reduce((s,x) => s + x.value * x.weight, 0) / totalW;

  if (matrixStrong.length || historyStrong.length) {
    basis = 'Comparables DEX ponderados por familia técnica, cercanía de duración, similitud temática y tamaño del grupo';
  } else if (matrixRelated.length || historyRelated.length) {
    basis = 'Referencias relacionadas DEX ponderadas por duración, tema y tamaño del grupo; sin comparable comercial exacto';
  } else if (dataRecommended) {
    basis = 'Referencias contextuales DEX con peso reducido';
  }

  dataRecommended = round500(dataRecommended);
  let recommended = dataRecommended;
  let policyApplied = false;
  if (policy && (!recommended || recommended < policy.recommended)) {
    recommended = policy.recommended;
    policyApplied = true;
    basis = dataRecommended
      ? `${basis}. Ajustado al piso comercial vigente DEX`
      : policy.source;
  }

  if (!recommended) {
    return {
      suggested:null, recommended:null, competitive:null, premium:null, min:null, max:null, floor:null,
      confidence:'Baja', modality, family, basis, matrix:null, matrixMedian:null, matrixCount:0,
      historicalMedian:null, historicalCount:0, matrixWeighted:null, historicalWeighted:null,
      matrixComparables:[], historicalComparables:[], comparables:[], references:[], policyApplied:false
    };
  }

  const evidenceValues = [matrixWeighted, historyWeighted].filter(Number.isFinite);
  const p25 = percentile(evidenceValues, 0.25);
  const p75 = percentile(evidenceValues, 0.75);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let competitive = round500(p25 ? clamp(p25, recommended*0.82, recommended*0.90) : recommended*0.85);
  let premium = round500(p75 ? clamp(p75, recommended*1.10, recommended*1.18) : recommended*1.14);

  if (policy) {
    competitive = Math.max(competitive || 0, policy.competitive);
    premium = Math.max(premium || 0, policy.premium);
  }
  if (competitive >= recommended) competitive = round500(recommended * 0.85);
  if (premium <= recommended) premium = round500(recommended * 1.14);

  let confidence = 'Baja';
  const strongCount = matrixStrong.length + historyStrong.length;
  const relatedCount = matrixRelated.length + historyRelated.length;
  if (strongCount >= 3 && historyStrong.length >= 1) confidence = 'Alta';
  else if (strongCount >= 1 || relatedCount >= 3) confidence = 'Media';
  if (policy && confidence === 'Baja' && (matrixEvidence.length + historyEvidence.length) >= 2) confidence = 'Media';
  const participantEvidence = [...matrixEvidence, ...historyEvidence].filter(x => x.participantKnown && x.participantFit >= 0.75);
  const strongParticipantEvidence = [...matrixEvidence, ...historyEvidence].filter(x => x.relevance === 'strong' && x.participantKnown && x.participantFit >= 0.75);
  const exactParticipantEvidence = [...matrixEvidence, ...historyEvidence].filter(x => x.participantKnown && x.participantFit >= 0.75 && x.durationFit >= 0.90 && Number(x.sim || 0) >= 0.45);
  // Con participantes solicitados, la confianza Alta requiere evidencia comercial real del tamaño de grupo:
  // al menos dos comparables fuertes con grupo conocido, o una coincidencia casi exacta con grupo conocido.
  if (requestedParticipants && confidence === 'Alta' && strongParticipantEvidence.length < 2 && exactParticipantEvidence.length < 1) confidence = 'Media';

  const serializeMatrix = x => ({
    course:x.item.curso,
    hours:x.item.horas,
    amount:round500(x.adjusted),
    baseAmount:Number(x.actualAmount) || null,
    score:Number(x.commercialScore.toFixed(3)),
    relevance:x.relevance,
    relevanceLabel:x.relevanceLabel,
    weight:Number(x.relevanceWeight.toFixed(3)),
    participants:x.rowParticipants ? Math.round(x.rowParticipants) : null,
    participantFit:Number(x.participantFit.toFixed(3)),
    participantKnown:Boolean(x.participantKnown),
    participantLabel:x.participantLabel
  });
  const serializeHistory = x => ({
    training:x.item.entrenamiento,
    client:x.item.cliente,
    hours:x.item.horas,
    amount:x.item.importe,
    adjustedAmount:x.item.importe,
    score:Number(x.commercialScore.toFixed(3)),
    relevance:x.relevance,
    relevanceLabel:x.relevanceLabel,
    weight:Number(x.relevanceWeight.toFixed(3)),
    participants:x.rowParticipants ? Math.round(x.rowParticipants) : null,
    participantFit:Number(x.participantFit.toFixed(3)),
    participantKnown:Boolean(x.participantKnown),
    participantLabel:x.participantLabel,
    sourceType:x.item.sourceType || 'legacy'
  });

  const primaryMatrix = matrixEvidence[0] || null;
  const references = [
    ...matrixEvidence.slice(0,4).map(x => ({
      source:'Matriz', name:x.item.curso, hours:x.item.horas, amount:round500(x.adjusted),
      score:Number(x.commercialScore.toFixed(3)), relevance:x.relevance, weight:Number(x.relevanceWeight.toFixed(3)), participants:x.rowParticipants ? Math.round(x.rowParticipants) : null, participantFit:Number(x.participantFit.toFixed(3))
    })),
    ...historyEvidence.slice(0,4).map(x => ({
      source:'Histórico', name:x.item.entrenamiento, client:x.item.cliente, hours:x.item.horas,
      amount:Number(x.item.importe), score:Number(x.commercialScore.toFixed(3)),
      relevance:x.relevance, weight:Number(x.relevanceWeight.toFixed(3)), participants:x.rowParticipants ? Math.round(x.rowParticipants) : null, participantFit:Number(x.participantFit.toFixed(3))
    }))
  ];

  return {
    suggested: recommended,
    recommended,
    competitive,
    premium,
    min: competitive,
    max: premium,
    floor: policy?.floor || competitive,
    confidence,
    modality,
    family,
    basis,
    matrix: primaryMatrix ? {
      course: primaryMatrix.item.curso,
      hours: primaryMatrix.item.horas || null,
      basePrice: Number(primaryMatrix.item[modality]) || null,
      adjustedPrice: round500(primaryMatrix.adjusted),
      score: Number(primaryMatrix.sim.toFixed(3)),
      familyComparable: primaryMatrix.sameFamily,
      relevance:primaryMatrix.relevance,
      weight:Number(primaryMatrix.relevanceWeight.toFixed(3))
    } : null,
    matrixMedian: matrixMedianSimple ? round500(matrixMedianSimple) : null,
    matrixWeighted: matrixWeighted ? round500(matrixWeighted) : null,
    matrixCount: matrixEvidence.length,
    historicalMedian: historicalMedianSimple ? round500(historicalMedianSimple) : null,
    historicalWeighted: historyWeighted ? round500(historyWeighted) : null,
    historicalCount: historyEvidence.length,
    strongCount,
    relatedCount,
    requestedParticipants,
    participantComparableCount: participantEvidence.length,
    dataRecommended,
    policyApplied,
    matrixComparables: matrixEvidence.slice(0,8).map(serializeMatrix),
    historicalComparables: historyEvidence.slice(0,8).map(serializeHistory),
    comparables: historyEvidence.slice(0,8).map(serializeHistory),
    references
  };
}

function buildChatGptPrompt(query, match, parsed) {
  const base = match
    ? `TEMARIO DEX DE REFERENCIA (úsalo como base, adáptalo y conserva profundidad técnica):\n${match.temario}`
    : 'No existe un temario DEX suficientemente equivalente. Desarrolla uno profesional desde cero y evita inventar normas, ediciones o requisitos.';
  return `Actúa como diseñador instruccional senior y redactor técnico-comercial de DEX México.\n\nSOLICITUD DEL CLIENTE (tal como la recibió la vendedora):\n${query}\n\nDATOS DETECTADOS:\n- Duración: ${parsed.hours || 'por definir'} horas\n- Modalidad: ${parsed.modality || 'por definir'}\n- Participantes: ${parsed.participants || 'por definir'}\n\n${base}\n\nOBJETIVO: construir una propuesta lista para que la vendedora solo supervise y haga correcciones mínimas.\n\nREGLAS DE PROFUNDIDAD DEL TEMARIO:\n- 4 horas: mínimo 3 módulos y 9 subtemas.\n- 8 horas: mínimo 4 módulos y 12 subtemas.\n- 12 horas: mínimo 5 módulos y 15 subtemas.\n- 16 horas: mínimo 6 módulos y 18 subtemas.\n- Más de 16 horas: aumenta módulos, ejercicios, casos y aplicación práctica proporcionalmente.\n- El contenido debe ser técnico, concreto y coherente con la duración; evita frases genéricas o temarios superficiales.\n\nDEVUELVE ÚNICAMENTE JSON VÁLIDO, SIN markdown, SIN explicaciones adicionales, con esta estructura exacta:\n{\n  "title": "Título profesional del curso o servicio",\n  "presentation": "Presentación comercial de 1 a 2 párrafos",\n  "objectives": ["Objetivo específico 1", "Objetivo específico 2", "Objetivo específico 3", "Objetivo específico 4"],\n  "benefit": "Función o beneficio principal del servicio",\n  "audience": "Perfil de participantes a quienes va dirigido",\n  "modality": "presencial|online|hibrida|por definir",\n  "durationHours": ${parsed.hours || 'null'},\n  "participants": ${parsed.participants || 'null'},\n  "temario": "MÓDULO I. ...\\n- ...\\n- ...\\n\\nMÓDULO II. ...",\n  "considerations": ["Solo consideraciones adicionales específicas del servicio, si aplican"],\n  "notes": "Metodología, entregables o notas relevantes si aplican"\n}\n\nNo incluyas precios. El precio lo calcula DEXI con información comercial interna. Las consideraciones comerciales estándar de DEX se insertan automáticamente; usa "considerations" solo para condiciones adicionales específicas del servicio.`;
}

app.get('/api/meta', (_req,res) => {
  res.json({ temarios: TEMARIOS.length, precios: PRECIOS.length, historicos: HISTORICOS.length, consultores: CONSULTORES.length, aiConnected: HAS_AI, aiProvider: HAS_GEMINI ? 'Gemini' : (HAS_OPENAI ? 'OpenAI' : null), aiModel: HAS_GEMINI ? GEMINI_MODEL : (HAS_OPENAI ? OPENAI_MODEL : null), persistentHistory: HAS_SUPABASE });
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

app.post('/api/dexi/suggest', async (req,res) => {
  const query = String(req.body.query || '').trim();
  if (!query) return res.status(400).json({ error:'Escribe lo que necesitas cotizar.' });
  const parsed = parseRequest(query, req.body || {});
  const best = topMatches(query, TEMARIOS, 'title', 1)[0] || null;
  const match = best && best.score >= 0.16 ? {...best.item, score:Number(best.score.toFixed(3))} : null;
  const price = await getPriceSuggestion(query, match?.title, parsed);
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
  if (!h) return 'Si la duración aún no está definida, desarrolla entre 4 y 6 módulos con al menos 16 subtemas en total y evita contenido de relleno.';
  if (h <= 4) return 'Desarrolla mínimo 3 módulos y entre 9 y 12 subtemas en total.';
  if (h <= 8) return 'Desarrolla entre 4 y 5 módulos y entre 16 y 24 subtemas en total.';
  if (h <= 12) return 'Desarrolla entre 5 y 6 módulos y entre 20 y 28 subtemas en total.';
  if (h <= 16) return 'Desarrolla entre 6 y 8 módulos y entre 24 y 32 subtemas en total.';
  if (h <= 24) return 'Desarrolla entre 8 y 10 módulos y entre 32 y 44 subtemas en total.';
  return 'Desarrolla entre 10 y 14 módulos y entre 40 y 60 subtemas en total, ajustando la profundidad al número de horas.';
}

function dexiSchemaDepth(hours) {
  const h = Number(hours || 0);
  if (!h) return { minModules:4, minItems:4 };
  if (h <= 4) return { minModules:3, minItems:3 };
  if (h <= 8) return { minModules:4, minItems:4 };
  if (h <= 12) return { minModules:5, minItems:4 };
  if (h <= 16) return { minModules:6, minItems:4 };
  if (h <= 24) return { minModules:8, minItems:4 };
  return { minModules:10, minItems:4 };
}

function dexiSystemPrompt() {
  return `Eres DEXI, asistente técnico-comercial de DEX México, empresa de capacitación y consultoría industrial. Tu trabajo es convertir una solicitud comercial informal en una propuesta de capacitación profesional, específica, técnicamente coherente y lista para revisión humana.

REGLAS INNEGOCIABLES:
- Redacta en español profesional, natural y concreto; evita frases genéricas, repetitivas o que parezcan texto de relleno.
- No inventes precios. DEX calcula precios con su motor comercial interno.
- No inventes ediciones de normas, cláusulas, certificaciones, acreditaciones ni requisitos que el cliente no haya solicitado o que la referencia proporcionada no sustente.
- Si existe una referencia DEX directa, úsala como base y adáptala a la necesidad real del cliente.
- Si la referencia es parcial, úsala solo como orientación de estructura/profundidad; no mezcles contenido técnico que no corresponda.
- Si el tema es nuevo, desarrolla el contenido desde cero con criterio de diseñador instruccional senior y especialista técnico en el tema.
- El temario debe ser proporcional a la duración, sin inflarlo artificialmente y sin quedarse superficial.
- Cada módulo debe tener una función clara dentro de la secuencia de aprendizaje; evita títulos vagos como "Generalidades", "Otros temas" o "Aspectos varios".
- Siempre que sea pertinente, nombra herramientas y métodos concretos en lugar de expresiones genéricas. Ejemplos: Pareto, Ishikawa, 5 Porqués, estratificación, análisis causa-efecto, validación de causas, plan de acción, estandarización y seguimiento.
- Cuando la necesidad trate de reducción de pérdidas, scrap, defectos, variación, productividad o mejora de proceso, estructura el contenido para cubrir: medición/caracterización del problema, priorización, variables o factores técnicos, análisis de causa raíz, acciones/contramedidas y control/seguimiento.
- Cuando corresponda, incluye indicadores o criterios de medición útiles para la toma de decisiones. No inventes metas numéricas que el cliente no haya proporcionado.
- El objetivo general debe expresar el resultado global del entrenamiento. Los objetivos específicos deben ser accionables y usar verbos claros.
- La presentación debe explicar contexto, propósito y valor del entrenamiento, sin repetir literalmente el objetivo.
- La función/beneficio debe describir capacidades y resultados esperados sin garantizar ahorros, reducciones o mejoras. Evita expresiones como "disminución directa", "garantiza", "asegura" o equivalentes.
- Dirigido a debe describir perfiles, áreas o roles pertinentes, sin inventar nombres de puestos demasiado específicos cuando no se conocen.
- En notes describe únicamente la metodología de impartición y, si es indispensable, alguna nota técnica específica. No inventes manuales, constancias, certificados, DC-3, grabaciones, licencias, materiales o entregables comerciales: DEX los incorpora por separado con sus reglas estándar.
- No agregues contenido solo para cumplir cantidad. Cada subtema debe ser técnicamente útil, distinto y directamente relacionado con la solicitud.
- Antes de responder, revisa internamente que el temario tenga una secuencia lógica, que no repita conceptos y que cubra el ciclo completo que exija el problema (por ejemplo: medición → análisis → causa raíz → acciones → control). Corrige la propuesta antes de devolver el JSON si detectas huecos o redundancias.
- En temas de pérdidas, scrap o defectos, cuando sea pertinente incluye scrap vs. retrabajo, costo de no calidad e indicadores de scrap, sin inventar metas numéricas.
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

function dexiProposalSchema(hours) {
  const depth = dexiSchemaDepth(hours);
  return {
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
        minItems:depth.minModules,
        items:{
          type:'object',
          additionalProperties:false,
          properties:{
            title:{ type:'string' },
            items:{ type:'array', items:{ type:'string' }, minItems:depth.minItems }
          },
          required:['title','items']
        }
      },
      considerations: { type:'array', items:{ type:'string' } },
      notes: { type:'string' }
    },
    required:['title','presentation','objectiveGeneral','objectives','benefit','audience','modality','durationHours','participants','temario','considerations','notes']
  };
}

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

function geminiOutputText(data) {
  const chunks = [];
  for (const candidate of (data?.candidates || [])) {
    for (const part of (candidate?.content?.parts || [])) {
      if (typeof part?.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('').trim();
}

async function geminiStructuredProposal(query, parsed, matchInfo, model = GEMINI_MODEL) {
  if (!HAS_GEMINI) throw new Error('GEMINI_NOT_CONFIGURED');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method:'POST',
    headers:{
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      systemInstruction:{
        parts:[{ text:dexiSystemPrompt() }]
      },
      contents:[{
        role:'user',
        parts:[{ text:dexiUserPrompt(query, parsed, matchInfo) }]
      }],
      generationConfig:{
        responseMimeType:'application/json',
        responseJsonSchema:dexiProposalSchema(parsed.hours)
      }
    })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const msg = data?.error?.message || `Gemini ${response.status}`;
    const err = new Error(msg); err.status = response.status; err.provider = 'Gemini'; err.model = model; throw err;
  }
  const text = geminiOutputText(data);
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new Error(blocked ? `Gemini bloqueó la solicitud: ${blocked}` : 'Gemini no devolvió contenido utilizable.');
  }
  let proposal;
  try { proposal = JSON.parse(text); } catch { throw new Error('La respuesta de Gemini no pudo convertirse en la estructura de propuesta.'); }
  return {
    proposal,
    provider:'Gemini',
    model:data?.modelVersion || model,
    usage:data?.usageMetadata || null,
    responseId:data?.responseId || null
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  // Backoff corto para no hacer esperar demasiado a la vendedora.
  // 1er reintento ~1.5 s, 2do ~3 s.
  return Math.min(6000, 1500 * Math.pow(2, Math.max(0, attempt - 1)));
}

async function geminiWithRetry(query, parsed, matchInfo, model, maxAttempts = GEMINI_MAX_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await geminiStructuredProposal(query, parsed, matchInfo, model);
    } catch (e) {
      lastError = e;
      const status = Number(e.status || 0);
      const retryable = GEMINI_RETRYABLE_STATUS.has(status);
      if (!retryable || attempt >= maxAttempts) throw e;
      const delay = retryDelayMs(attempt);
      console.warn(`DEXI Gemini ${model} respondió ${status || 'error'}. Reintento ${attempt + 1}/${maxAttempts} en ${delay} ms.`);
      await wait(delay);
    }
  }
  throw lastError || new Error(`Gemini ${model} no respondió.`);
}

async function geminiProposalWithFallback(query, parsed, matchInfo) {
  try {
    return await geminiWithRetry(query, parsed, matchInfo, GEMINI_MODEL);
  } catch (e) {
    const status = Number(e.status || 0);
    const canFallback = [404, 429, 500, 502, 503, 504].includes(status);
    if (canFallback && GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
      console.warn(`DEXI Gemini ${GEMINI_MODEL} no disponible después de reintentos (${status || 'error'}). Cambiando a ${GEMINI_FALLBACK_MODEL}.`);
      try {
        return await geminiWithRetry(query, parsed, matchInfo, GEMINI_FALLBACK_MODEL);
      } catch (fallbackError) {
        fallbackError.primaryModel = GEMINI_MODEL;
        fallbackError.fallbackModel = GEMINI_FALLBACK_MODEL;
        throw fallbackError;
      }
    }
    throw e;
  }
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
          schema:dexiProposalSchema(parsed.hours)
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
  return { proposal, provider:'OpenAI', model:data?.model || OPENAI_MODEL, usage:data?.usage || null, responseId:data?.id || null };
}

async function generateDexiProposal(query, parsed, matchInfo) {
  // Gemini es principal cuando está configurado. OpenAI queda como respaldo opcional.
  if (DEXI_PROVIDER === 'gemini' && HAS_GEMINI) {
    try {
      return await geminiProposalWithFallback(query, parsed, matchInfo);
    } catch (e) {
      const transient = [429, 500, 502, 503, 504].includes(Number(e.status));
      if (transient && HAS_OPENAI) {
        console.warn('DEXI Gemini no disponible temporalmente. Intentando respaldo OpenAI.');
        return await openAiStructuredProposal(query, parsed, matchInfo);
      }
      throw e;
    }
  }
  if (DEXI_PROVIDER === 'openai' && HAS_OPENAI) {
    try {
      return await openAiStructuredProposal(query, parsed, matchInfo);
    } catch (e) {
      const transient = [429, 500, 502, 503, 504].includes(Number(e.status));
      if (transient && HAS_GEMINI) return await geminiProposalWithFallback(query, parsed, matchInfo);
      throw e;
    }
  }
  if (HAS_GEMINI) return await geminiProposalWithFallback(query, parsed, matchInfo);
  if (HAS_OPENAI) return await openAiStructuredProposal(query, parsed, matchInfo);
  throw new Error('AI_NOT_CONFIGURED');
}

app.post('/api/dexi/generate', async (req,res) => {
  const query = String(req.body.query || '').trim();
  if (!query) return res.status(400).json({ error:'Describe primero lo que solicitó el cliente.' });
  if (!HAS_AI) return res.status(503).json({ error:'DEXI todavía no tiene conectada una API de inteligencia artificial.' });
  const parsed = parseRequest(query, req.body || {});
  const matchInfo = dexiMatchInfo(query);
  try {
    const ai = await generateDexiProposal(query, parsed, matchInfo);
    const price = await getPriceSuggestion(query, ai?.proposal?.title || matchInfo.match?.title, parsed);
    res.json({
      parsed,
      matchType:matchInfo.type,
      match:matchInfo.match,
      price,
      generation:ai.proposal,
      ai:{provider:ai.provider,model:ai.model,usage:ai.usage,responseId:ai.responseId}
    });
  } catch (e) {
    console.error(`DEXI ${e.provider || 'AI'} error:`, e.message);
    const rawStatus = Number(e.status || 0);
    const status = [401,403,429].includes(rawStatus) ? rawStatus : 502;
    let friendly = 'No fue posible generar la propuesta con la IA en este momento.';
    if (e.provider === 'Gemini' || DEXI_PROVIDER === 'gemini') {
      if (status === 401 || status === 403) friendly = 'Gemini no aceptó la clave o el proyecto. Revisa GEMINI_API_KEY y el acceso del proyecto en Google AI Studio.';
      else if (status === 429) friendly = 'Gemini alcanzó un límite temporal de solicitudes o cuota. DEXI ya intentó automáticamente con el modelo alterno.';
      else if (rawStatus === 503) friendly = 'Gemini está temporalmente no disponible (503). DEXI ya hizo reintentos automáticos y probó el modelo alterno.';
      else friendly = 'No fue posible generar la propuesta con Gemini en este momento, incluso después de los reintentos automáticos.';
    } else if (e.provider === 'OpenAI') {
      if (status === 401 || status === 403) friendly = 'OpenAI no aceptó la API key configurada en Render.';
      else if (status === 429) friendly = 'OpenAI rechazó temporalmente la solicitud por saldo, límite o capacidad.';
      else friendly = 'No fue posible generar la propuesta con OpenAI en este momento.';
    }
    res.status(status).json({ error:friendly, detail:process.env.NODE_ENV === 'development' ? e.message : undefined });
  }
});

app.get('/api/storage/status', async (_req,res) => {
  if (!HAS_SUPABASE) {
    return res.json({ persistent:false, connected:false, provider:'none', reason:'not-configured' });
  }
  try {
    await supabaseFetch('dex_cotizaciones?select=id&limit=1', { method:'GET', headers:{Prefer:'return=minimal'} });
    res.json({ persistent:true, connected:true, provider:'supabase', keyType:SUPABASE_KEY_IS_LEGACY_JWT ? 'legacy-service-role' : 'secret' });
  } catch (e) {
    const info = supabasePublicError(e);
    console.error('[Supabase status]', e.message);
    res.status(info.status).json({ persistent:false, connected:false, provider:'supabase', code:info.code, error:info.message });
  }
});

app.get('/api/quotes', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false, code:'SUPABASE_NOT_CONFIGURED' });
  try {
    const q = String(req.query.q || '').trim();
    let resource = 'dex_cotizaciones?select=*&order=created_at.desc&limit=200';
    if (q) {
      const safe = q.replace(/[,%()]/g, ' ').trim();
      resource += `&or=(folio.ilike.*${encodeURIComponent(safe)}*,cliente.ilike.*${encodeURIComponent(safe)}*,titulo.ilike.*${encodeURIComponent(safe)}*)`;
    }
    const rows = await supabaseFetch(resource, { method:'GET', headers:{Prefer:'return=minimal'} });
    res.json(rows || []);
  } catch (e) {
    const info = supabasePublicError(e);
    console.error('[Supabase quotes GET]', e.message);
    res.status(info.status).json({error:info.message, code:info.code, persistent:false});
  }
});

function quotePayload(p = {}) {
  const totals = proposalTotals(p);
  return {
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
}

app.post('/api/quotes', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false, code:'SUPABASE_NOT_CONFIGURED' });
  try {
    const payload = { folio:null, ...quotePayload(req.body || {}) };
    const inserted = await supabaseFetch('dex_cotizaciones?select=*', { method:'POST', body:JSON.stringify(payload) });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!row?.id) throw new Error('No se recibió ID de cotización.');
    const year = new Date(row.created_at || Date.now()).getFullYear();
    const folio = `DEX-${year}-${String(row.id).padStart(4,'0')}`;
    const storedData = { ...(req.body || {}), folio, historyId:row.id, status:payload.estado };
    const updated = await supabaseFetch(`dex_cotizaciones?id=eq.${row.id}&select=*`, {
      method:'PATCH',
      body:JSON.stringify({folio, data:storedData})
    });
    res.json((Array.isArray(updated) ? updated[0] : updated) || {...row,folio,data:storedData});
  } catch (e) {
    const info = supabasePublicError(e);
    console.error('[Supabase quotes POST]', e.message);
    res.status(info.status).json({error:info.message, code:info.code, persistent:false});
  }
});

// Guarda cambios sobre la misma cotización para evitar duplicados al volver a guardar.
app.put('/api/quotes/:id', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false, code:'SUPABASE_NOT_CONFIGURED' });
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({error:'ID de cotización inválido.'});
    const currentRows = await supabaseFetch(`dex_cotizaciones?id=eq.${id}&select=id,folio,created_at`, {method:'GET'});
    const current = Array.isArray(currentRows) ? currentRows[0] : currentRows;
    if (!current?.id) return res.status(404).json({error:'Cotización no encontrada.'});
    const payload = quotePayload(req.body || {});
    payload.data = { ...(req.body || {}), folio:current.folio, historyId:id, status:payload.estado };
    const rows = await supabaseFetch(`dex_cotizaciones?id=eq.${id}&select=*`, {method:'PATCH',body:JSON.stringify(payload)});
    res.json(Array.isArray(rows)?rows[0]:rows);
  } catch (e) {
    const info = supabasePublicError(e);
    console.error('[Supabase quotes PUT]', e.message);
    res.status(info.status).json({error:info.message, code:info.code, persistent:false});
  }
});

app.patch('/api/quotes/:id', async (req,res) => {
  if (!HAS_SUPABASE) return res.status(503).json({ error:'El historial compartido aún no está conectado.', persistent:false, code:'SUPABASE_NOT_CONFIGURED' });
  try {
    const allowed = {};
    if (req.body.estado !== undefined) allowed.estado = req.body.estado;
    if (req.body.monto_contratado !== undefined) allowed.monto_contratado = req.body.monto_contratado === '' ? null : Number(req.body.monto_contratado);
    const rows = await supabaseFetch(`dex_cotizaciones?id=eq.${Number(req.params.id)}&select=*`, {method:'PATCH',body:JSON.stringify(allowed)});
    res.json(Array.isArray(rows)?rows[0]:rows);
  } catch(e){
    const info = supabasePublicError(e);
    console.error('[Supabase quotes PATCH]', e.message);
    res.status(info.status).json({error:info.message, code:info.code, persistent:false});
  }
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
    const template = ['A','B','C'].includes(p.template) ? p.template : 'A';
    const theme = {
      A:{dark:'123D53',accent:'16806D',soft:'F4F8F6',line:'D8E4DF',ink:'193042',muted:'667C75'},
      B:{dark:'123D53',accent:'1499A3',soft:'F4F8F8',line:'D9E6E4',ink:'193042',muted:'667C75'},
      C:{dark:'17493F',accent:'C7A24E',soft:'FBF7ED',line:'E7DDC6',ink:'243832',muted:'776B56'}
    }[template];

    const FONT = 'Segoe UI';
    const noBorder = { style:BorderStyle.NONE, size:0, color:'FFFFFF' };
    const cellBorders = {top:noBorder,bottom:noBorder,left:noBorder,right:noBorder,insideHorizontal:noBorder,insideVertical:noBorder};
    const lightBorder = { style:BorderStyle.SINGLE, size:4, color:theme.line };
    const lightBorders = {top:lightBorder,bottom:lightBorder,left:lightBorder,right:lightBorder};
    const moneyText = (v)=>money(v);
    const txt = (value='')=>String(value||'').trim();
    const lines = (value='')=>txt(value).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const logoPath = path.join(__dirname,'public','dex-logo-real.png');
    const logoData = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    const imageDataInfo = (dataUri='') => {
      const m = String(dataUri||'').match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
      if(!m) return null;
      return { type:/^jpe?g$/i.test(m[1]) ? 'jpg' : 'png', data:Buffer.from(m[2],'base64') };
    };
    const imageDims = (buf,type) => {
      try {
        if(type==='png' && buf.length>=24 && buf.slice(1,4).toString()==='PNG') {
          return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};
        }
        if(type==='jpg') {
          let i=2;
          while(i<buf.length-9){
            if(buf[i]!==0xFF){ i++; continue; }
            const marker=buf[i+1];
            if([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) {
              return {height:buf.readUInt16BE(i+5),width:buf.readUInt16BE(i+7)};
            }
            const len=buf.readUInt16BE(i+2);
            if(!len || len<2) break;
            i += 2 + len;
          }
        }
      } catch(_) {}
      return null;
    };
    const fitImage = (info,maxW,maxH) => {
      if(!info) return null;
      const d=imageDims(info.data,info.type);
      if(!d || !d.width || !d.height) return {width:maxW,height:maxH};
      const scale=Math.min(maxW/d.width,maxH/d.height);
      return {width:Math.max(1,Math.round(d.width*scale)),height:Math.max(1,Math.round(d.height*scale))};
    };
    const coverInfo = imageDataInfo(p.coverData);

    const paragraph = (text, opts={}) => new Paragraph({
      alignment:opts.alignment || AlignmentType.LEFT,
      spacing:{before:opts.before||0,after:opts.after===undefined?100:opts.after,line:opts.line||276},
      keepNext:!!opts.keepNext,
      keepLines:!!opts.keepLines,
      children:[new TextRun({
        text:String(text||''),
        font:FONT,
        size:opts.size||21,
        bold:!!opts.bold,
        color:opts.color||theme.ink,
        allCaps:!!opts.allCaps
      })]
    });
    const heading = (text, opts={}) => paragraph(text,{size:opts.size||20,bold:true,color:opts.color||theme.accent,after:opts.after===undefined?80:opts.after,before:opts.before||0,keepNext:true,allCaps:opts.allCaps!==false});
    const justified = (text, opts={}) => new Paragraph({
      alignment:AlignmentType.JUSTIFIED,
      spacing:{before:opts.before||0,after:opts.after===undefined?95:opts.after,line:opts.line||286},
      keepLines:true,
      children:[new TextRun({text:String(text||''),font:FONT,size:opts.size||21,color:opts.color||theme.ink,bold:!!opts.bold})]
    });
    const bullet = (text, opts={}) => new Paragraph({
      bullet:{level:0},
      alignment:AlignmentType.JUSTIFIED,
      spacing:{after:opts.after===undefined?45:opts.after,line:opts.line||250},
      children:[new TextRun({text:String(text||''),font:FONT,size:opts.size||18.5,color:opts.color||theme.ink})]
    });
    // Word desktop is stricter than LibreOffice with percentage table widths.
    // Use fixed DXA widths (twips) throughout the DOCX to avoid Word's
    // "unreadable content" repair prompt.
    const CONTENT_WIDTH_DXA = 11120; // Letter 8.5in minus 0.389in margins each side
    const pctToDxa = (pct) => Math.max(1, Math.round(CONTENT_WIDTH_DXA * Number(pct || 0) / 100));
    const gridToDxa = (value) => Math.max(1, Math.round(CONTENT_WIDTH_DXA * Number(value || 0) / 10000));
    const cell = (children, opts={}) => new TableCell({
      width:opts.width ? {size:pctToDxa(opts.width),type:WidthType.DXA}:undefined,
      columnSpan:opts.columnSpan,
      verticalAlign:VerticalAlign.CENTER,
      margins:{top:opts.top||110,bottom:opts.bottom||110,left:opts.left||130,right:opts.right||130},
      shading:opts.fill ? {fill:opts.fill}:undefined,
      borders:opts.borders || cellBorders,
      children:Array.isArray(children)?children:[children]
    });
    const table = (rows, widths) => new Table({
      width:{size:CONTENT_WIDTH_DXA,type:WidthType.DXA},
      layout:TableLayoutType.FIXED,
      columnWidths:Array.isArray(widths) ? widths.map(gridToDxa) : undefined,
      borders:cellBorders,
      rows
    });
    const row = (cells)=>new TableRow({children:cells,cantSplit:true});

    function objectiveGeneral(value='') {
      let arr=lines(value).filter(x=>!/^OBJETIVO GENERAL\s*$/i.test(x));
      const idx=arr.findIndex(x=>/^OBJETIVOS? ESPEC[IÍ]FICOS/i.test(x));
      if(idx>=0) arr=arr.slice(0,idx);
      return arr.join(' ').replace(/^[•\-→]\s*/,'').trim();
    }
    function parseTemario(value='') {
      const arr=lines(value);
      const mods=[];
      let cur=null;
      const titleish=(line)=>{
        if(/^M[ÓO]DULO\b/i.test(line)) return true;
        if(/^\d+[\.\)]\s+/.test(line) && !/^\d+[\.\)]\s+(?:h|hrs?|horas?)\b/i.test(line)) return true;
        if(!/^[•\-→]/.test(line) && line.length<=92 && line.split(/\s+/).length>=3 && line.split(/\s+/).length<=12) return true;
        return false;
      };
      for(const raw of arr){
        const line=raw.trim();
        if(!line) continue;
        const bulletLike=/^[•\-→]/.test(line);
        if(!bulletLike && titleish(line)){
          if(cur) mods.push(cur);
          cur={title:line.replace(/^M[ÓO]DULO\s*[IVX\d.:-]*\s*/i,'').replace(/^\d+[\.\)]\s*/,''),items:[]};
        } else {
          if(!cur) cur={title:'Contenido programático',items:[]};
          cur.items.push(line.replace(/^[•\-→]\s*/,''));
        }
      }
      if(cur) mods.push(cur);
      return mods.filter(m=>m.title || m.items.length);
    }
    function scopeItems(){
      const items=[
        'Adecuación del contenido, ejemplos y ejercicios a la necesidad planteada por el cliente.',
        'Impartición por un especialista con experiencia técnica y práctica en el tema.',
        'Desarrollo de ejercicios, casos o actividades de aplicación durante la capacitación.',
        'Material de apoyo para consulta y seguimiento de los participantes.'
      ];
      if(txt(p.accreditation)) items.push(`Entrega de los documentos de acreditación indicados en la propuesta (${txt(p.accreditation)}).`);
      return items;
    }
    function commercialConsiderations(){
      const participantLabel = txt(p.participants);
      let raw=lines(p.considerations || standardConsiderationsServer(p));
      // If the UI only sends the single participant field, don't leave the
      // legacy "_ a _ participantes" placeholder in the Word export.
      if (participantLabel) {
        raw = raw.map(x => /Los precios están dados para un grupo de\s+_\s+a\s+_\s+participantes/i.test(x)
          ? `Los precios están dados para un grupo de ${participantLabel}.`
          : x);
      }
      const filtered=raw.filter(x=>!/(equipo profesional involucrado|material del curso|se entrega\s+dc-3|certificado de participaci[oó]n)/i.test(x));
      return filtered.length?filtered:raw;
    }

    let hero;
    if(template==='C') {
      const coverChildren=[];
      if(coverInfo){
        const dim=fitImage(coverInfo,250,165);
        coverChildren.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:0},children:[
          new ImageRun({data:coverInfo.data,type:coverInfo.type,transformation:dim})
        ]}));
      } else {
        coverChildren.push(paragraph('ESPACIO PARA IMAGEN',{size:18,bold:true,color:'6F6654',alignment:AlignmentType.CENTER,after:45}));
        coverChildren.push(paragraph('La imagen cargada se acomoda automáticamente.',{size:14.5,color:'7D7463',alignment:AlignmentType.CENTER,after:0}));
      }
      const left=[];
      if(logoData) left.push(new Paragraph({alignment:AlignmentType.LEFT,spacing:{after:110},children:[new ImageRun({data:logoData,type:'png',transformation:{width:54,height:54}})]}));
      left.push(paragraph('PROPUESTA DE CAPACITACIÓN',{size:15.5,bold:true,color:'D7B35A',after:70,allCaps:true}));
      left.push(paragraph(p.title || 'Propuesta de servicio',{size:30,bold:true,color:'FFFFFF',after:0,line:315}));
      hero=table([row([
        cell(left,{width:52,fill:theme.dark,top:175,bottom:175,left:210,right:150}),
        cell(coverChildren,{width:48,fill:'F4E8CF',top:150,bottom:150,left:120,right:120,borders:lightBorders})
      ])],[5200,4800]);
    } else {
      const kicker = template==='B' ? 'DEX MÉXICO / PROPUESTA COMERCIAL' : 'PROPUESTA COMERCIAL DE CAPACITACIÓN';
      const kickerColor = template==='B' ? '8DE3CF' : '7DE0CB';
      const heroLeft=[
        paragraph(kicker,{size:16,bold:true,color:kickerColor,after:80,allCaps:true}),
        paragraph(p.title || 'Propuesta de servicio',{size:31,bold:true,color:'FFFFFF',after:0,line:320})
      ];
      const heroRight=[];
      if(logoData) heroRight.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:0},children:[new ImageRun({data:logoData,type:'png',transformation:{width:68,height:68}})]}));
      else heroRight.push(paragraph('DEX',{size:24,bold:true,color:'FFFFFF',alignment:AlignmentType.CENTER,after:0}));
      hero = table([row([
        cell(heroLeft,{width:78,fill:theme.dark,top:220,bottom:220,left:230,right:150}),
        cell(heroRight,{width:22,fill:theme.dark,top:180,bottom:180,left:80,right:120})
      ])],[7800,2200]);
    }

    const metaValues=[
      ['MODALIDAD',txt(p.modality)||'—'],['DURACIÓN',txt(p.durationTotal)||'—'],['PARTICIPANTES',txt(p.participants)||'—'],['ACREDITACIÓN',txt(p.accreditation)||'—']
    ];
    const meta = table([row(metaValues.map(([k,v])=>cell([
      paragraph(k,{size:14.5,bold:true,color:theme.muted,alignment:AlignmentType.CENTER,after:35,allCaps:true}),
      paragraph(v,{size:18,bold:true,color:theme.ink,alignment:AlignmentType.CENTER,after:0})
    ],{width:25,fill:'FFFFFF',top:105,bottom:105,borders:lightBorders})))],[2500,2500,2500,2500]);

    const infoLeft=[];
    infoLeft.push(heading(template==='C'?'OBJETIVO':'OBJETIVO GENERAL',{size:18}));
    infoLeft.push(justified(objectiveGeneral(p.objectives)||'—',{size:20}));
    infoLeft.push(heading('DIRIGIDO A',{size:18,before:80}));
    infoLeft.push(justified(p.audience||'—',{size:20,after:0}));
    const infoRight=[heading('FUNCIÓN / BENEFICIO',{size:18}),justified(p.benefit||'—',{size:20,after:0})];
    const infoTable=table([row([
      cell(infoLeft,{width:55,fill:'FFFFFF',top:130,bottom:130,left:0,right:160}),
      cell(infoRight,{width:45,fill:theme.soft,top:150,bottom:150,left:165,right:165,borders:lightBorders})
    ])],[5500,4500]);

    const modernCard=(titleText,body)=>cell([
      heading(titleText,{size:17.5,after:55}),
      justified(body||'—',{size:18.2,after:0,line:258})
    ],{width:50,fill:theme.soft,top:125,bottom:125,left:145,right:145,borders:lightBorders});
    const modernGrid=table([
      row([modernCard('OBJETIVO GENERAL',objectiveGeneral(p.objectives)),modernCard('FUNCIÓN / BENEFICIO',p.benefit)]),
      row([modernCard('DIRIGIDO A',p.audience),modernCard('PRESENTACIÓN',p.presentation)])
    ],[5000,5000]);

    const scopeCells=scopeItems();
    const scopeParas=[heading('ALCANCE Y ENTREGABLES DEL SERVICIO',{size:18,after:60})];
    scopeCells.forEach(x=>scopeParas.push(bullet(x,{size:18.5,after:35})));
    const scopeBox=table([row([cell(scopeParas,{fill:theme.soft,top:135,bottom:125,left:160,right:160,borders:lightBorders})])],[10000]);

    const modules=parseTemario(p.temario);
    const moduleRows=[];
    const moduleCell=(m,idx,wide=false)=>{
      const num=String(idx+1).padStart(2,'0');
      if(template==='A') {
        const headFill = idx%2===0 ? theme.dark : '1499A3';
        const head=table([row([
          cell([paragraph(num,{size:15.5,bold:true,color:'FFFFFF',alignment:AlignmentType.CENTER,after:0})],{width:15,fill:headFill,top:70,bottom:70,left:40,right:40}),
          cell([paragraph(m.title,{size:17.8,bold:true,color:'FFFFFF',after:0})],{width:85,fill:headFill,top:70,bottom:70,left:90,right:90})
        ])],[1500,8500]);
        const body=[];
        m.items.forEach(it=>body.push(bullet(it,{size:17.2,after:25,line:236})));
        return cell([head,...body],{width:wide?100:50,fill:'FFFFFF',top:0,bottom:100,left:0,right:0,borders:lightBorders});
      }
      const kids=[
        paragraph(num,{size:16,bold:true,color:theme.accent,after:55,alignment:template==='C'?AlignmentType.CENTER:AlignmentType.LEFT}),
        paragraph(m.title,{size:18.5,bold:true,color:theme.ink,after:60})
      ];
      m.items.forEach(it=>kids.push(bullet(it,{size:17.2,after:25,line:236})));
      return cell(kids,{width:wide?100:50,fill:theme.soft,top:120,bottom:120,left:135,right:135,borders:lightBorders});
    };
    // Rebuild single odd module rows with a true colspan to preserve full width in Word.
    const normalizedModuleRows=[];
    for(let i=0;i<modules.length;i+=2){
      const pair=modules.slice(i,i+2);
      if(pair.length===1){
        const m=pair[0], idx=i, num=String(idx+1).padStart(2,'0');
        if(template==='A') {
          const headFill=idx%2===0?theme.dark:'1499A3';
          const head=table([row([
            cell([paragraph(num,{size:15.5,bold:true,color:'FFFFFF',alignment:AlignmentType.CENTER,after:0})],{width:15,fill:headFill,top:70,bottom:70,left:40,right:40}),
            cell([paragraph(m.title,{size:17.8,bold:true,color:'FFFFFF',after:0})],{width:85,fill:headFill,top:70,bottom:70,left:90,right:90})
          ])],[1500,8500]);
          const body=[];m.items.forEach(it=>body.push(bullet(it,{size:17.2,after:25,line:236})));
          normalizedModuleRows.push(row([cell([head,...body],{columnSpan:2,fill:'FFFFFF',top:0,bottom:100,left:0,right:0,borders:lightBorders})]));
        } else {
          const kids=[paragraph(num,{size:16,bold:true,color:theme.accent,after:55}),paragraph(m.title,{size:18.5,bold:true,color:theme.ink,after:60})];
          m.items.forEach(it=>kids.push(bullet(it,{size:17.2,after:25,line:236})));
          normalizedModuleRows.push(row([cell(kids,{columnSpan:2,fill:theme.soft,top:120,bottom:120,left:135,right:135,borders:lightBorders})]));
        }
      } else {
        normalizedModuleRows.push(row([moduleCell(pair[0],i,false),moduleCell(pair[1],i+1,false)]));
      }
    }
    const modulesTable=table(normalizedModuleRows,[5000,5000]);

    const investRows=[];
    (p.concepts||[]).forEach(c=>investRows.push(row([
      cell([paragraph(c.service||p.title||'Servicio DEX',{size:18,bold:true,color:'FFFFFF',after:35}),paragraph(c.duration||p.durationTotal||'',{size:16,color:'FFFFFF',after:0})],{width:46,fill:theme.dark,top:120,bottom:120,left:150,right:130}),
      cell([paragraph('Subtotal',{size:15,color:'D9ECE6',after:30}),paragraph(`IVA ${Number(p.iva??16)}%`,{size:15,color:'D9ECE6',after:30}),paragraph('Total con IVA',{size:20,bold:true,color:'FFFFFF',after:0})],{width:24,fill:theme.dark,top:120,bottom:120,left:100,right:70}),
      cell([paragraph(moneyText(totals.afterDiscount),{size:17,bold:true,color:'FFFFFF',alignment:AlignmentType.RIGHT,after:30}),paragraph(moneyText(totals.iva),{size:17,bold:true,color:'FFFFFF',alignment:AlignmentType.RIGHT,after:30}),paragraph(moneyText(totals.total),{size:23,bold:true,color:'FFFFFF',alignment:AlignmentType.RIGHT,after:0})],{width:30,fill:theme.dark,top:120,bottom:120,left:70,right:150})
    ])));
    if(!investRows.length) investRows.push(row([cell(paragraph('Sin concepto de inversión capturado.',{size:18,color:'FFFFFF'}),{columnSpan:3,fill:theme.dark})]));
    const investTable=table(investRows,[4600,2400,3000]);

    const considerationParas=[heading('CONSIDERACIONES COMERCIALES',{size:19,after:70})];
    commercialConsiderations().forEach(x=>considerationParas.push(bullet(x,{size:18.5,after:55,line:252})));
    if(txt(p.notes)){
      considerationParas.push(heading('NOTAS DE LA PROPUESTA',{size:18,before:100,after:55}));
      considerationParas.push(justified(p.notes,{size:18.5,after:0}));
    }
    const considerationBox=table([row([cell(considerationParas,{fill:'F8FAF9',top:150,bottom:145,left:160,right:160,borders:lightBorders})])],[10000]);

    const contactBox=table([
      row([cell([
        paragraph('CONTACTO COMERCIAL DEX',{size:15,bold:true,color:'8DE3CF',after:45,allCaps:true}),
        paragraph('Hablemos de tu proyecto',{size:24,bold:true,color:'FFFFFF',after:45}),
        paragraph('Estamos listos para revisar fechas, modalidad y alcance.',{size:17,color:'E2F3ED',after:0})
      ],{columnSpan:2,fill:theme.dark,top:140,bottom:110,left:160,right:160})]),
      row([
        cell([paragraph('WHATSAPP',{size:13.5,bold:true,color:'8DE3CF',after:25}),paragraph('+52 477 294 4676',{size:17,bold:true,color:'FFFFFF',after:0})],{width:50,fill:theme.dark,top:80,bottom:90,left:160,right:100}),
        cell([paragraph('TELÉFONO',{size:13.5,bold:true,color:'8DE3CF',after:25}),paragraph('+52 477 510 5426',{size:17,bold:true,color:'FFFFFF',after:0})],{width:50,fill:theme.dark,top:80,bottom:90,left:100,right:160})
      ]),
      row([
        cell([paragraph('CORREO',{size:13.5,bold:true,color:'8DE3CF',after:25}),paragraph('ventas@dexmexico.com',{size:17,bold:true,color:'FFFFFF',after:0})],{width:50,fill:theme.dark,top:80,bottom:100,left:160,right:100}),
        cell([paragraph('WEB',{size:13.5,bold:true,color:'8DE3CF',after:25}),paragraph('www.dexmexico.com',{size:17,bold:true,color:'FFFFFF',after:0})],{width:50,fill:theme.dark,top:80,bottom:100,left:100,right:160})
      ])
    ],[5000,5000]);

    const pageBreak=()=>new Paragraph({children:[new PageBreak()]});
    const children=[];
    children.push(hero,paragraph('',{size:2,after:70}),meta,paragraph('',{size:2,after:135}));
    if(template==='B') {
      children.push(modernGrid,paragraph('',{size:2,after:100}),scopeBox,pageBreak());
    } else {
      if(txt(p.presentation)) children.push(justified(p.presentation,{size:20.5,after:125,line:288}));
      children.push(infoTable,paragraph('',{size:2,after:100}),scopeBox,pageBreak());
    }
    children.push(heading('CONTENIDO PROGRAMÁTICO',{size:21,after:85}),modulesTable,paragraph('',{size:2,after:110}),investTable,pageBreak());
    children.push(considerationBox,paragraph('',{size:2,after:125}),contactBox);

    const footerTable = new Table({
      width:{size:CONTENT_WIDTH_DXA,type:WidthType.DXA},
      layout:TableLayoutType.FIXED,
      columnWidths:[CONTENT_WIDTH_DXA],
      borders:cellBorders,
      rows:[new TableRow({children:[new TableCell({
        shading:{fill:theme.accent},
        borders:cellBorders,
        margins:{top:70,bottom:70,left:130,right:130},
        children:[new Paragraph({
          alignment:AlignmentType.CENTER,
          spacing:{before:0,after:0},
          children:[new TextRun({text:'DEX MÉXICO · KNOWLEDGE & DEVELOPMENT    |    www.dexmexico.com',font:FONT,size:15,bold:true,color:'FFFFFF'})]
        })]
      })]})]
    });

    const doc = new Document({
      styles:{default:{document:{run:{font:FONT,size:20,color:theme.ink},paragraph:{spacing:{after:80,line:276}}}}},
      sections:[{
        properties:{
          page:{size:{width:12240,height:15840},margin:{top:520,right:560,bottom:760,left:560,header:240,footer:240}}
        },
        footers:{default:new Footer({children:[footerTable]})},
        children
      }]
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="Propuesta_DEX_${template}_${Date.now()}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'No fue posible generar el Word.'});
  }
});
app.get('*', (_req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, () => console.log(`Cotizador DEX 4.11 en puerto ${PORT}`));
