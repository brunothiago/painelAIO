// Utilitários do painelAIO. Todo texto que vem do banco passa por esc() —
// use o template `html` (escapa sozinho) em vez de montar HTML com + ou ${}.

const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => MAPA_ESC[m]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

function fmtVal(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmtVal).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

/** Template que escapa as interpolações. Resultado: objeto Raw (use .s ou String()). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += fmtVal(vals[i]); });
  return new Raw(out);
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
export function render(el, conteudo) { (typeof el === 'string' ? $(el) : el).innerHTML = String(conteudo); }

// ---------- texto / números / datas ----------
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const BRL2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR');
export const fmtBRL = (v, centavos = false) => (v === null || v === undefined || v === '' ? '—' : (centavos ? BRL2 : BRL).format(+v));
export const fmtNum = (v) => (v === null || v === undefined ? '—' : NUM.format(v));
export function fmtBRLCurto(v) {
  if (!v) return 'R$ 0';
  const a = Math.abs(v);
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return fmtBRL(v);
}

/** '2026-07-03' ou ISO completo -> '03/07/2026' */
export function fmtData(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
export function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return fmtData(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function diasEntre(isoA, isoB = hojeISO()) {
  if (!isoA) return null;
  const a = Date.UTC(...isoA.slice(0, 10).split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  const b = Date.UTC(...isoB.slice(0, 10).split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  return Math.round((b - a) / 86400000);
}

// ---------- etapas ----------
/** 'Única' / '' -> [] ; '2 e 4' -> [2,4] ; 'Etapa 1 – Feo' -> [1] */
export function parseEtapas(txt) {
  const s = String(txt ?? '').trim();
  if (!s || /^(etapa\s+)?[uú]nica$/i.test(s)) return [];
  const antes = s.split(/\s+[–—-]\s*|\s*[–—]\s*/)[0];
  return [...new Set((antes.match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
}
export const fmtEtapas = (arr) => (!arr || !arr.length ? 'Única' : arr.join(' e '));

// ---------- cores ----------
/** Texto escuro sobre cores claras (ex.: amarelo). */
export function corClara(hex) {
  const m = String(hex || '').replace('#', '').match(/.{2}/g);
  if (!m) return false;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

// ---------- miscelânea ----------
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function toast(msg, tipo = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 3500);
}

export async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast(`Copiado: ${txt}`); }
  catch { toast('Não foi possível copiar', 'erro'); }
}

export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function carimbo() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Mensagem de erro amigável a partir de erro do Supabase/PostgREST. */
export function msgErro(e) {
  const m = e?.message || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (/JWT expired|invalid jwt/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/permission denied|row-level security/i.test(m)) return 'Você não tem permissão para esta ação.';
  return m;
}
