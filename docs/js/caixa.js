// Aba "Listas da Caixa": importar .xlsx do e-mail, fila de itens sem cadastro e listas importadas.
// O leitor segue o mesmo mapa (caixa_mapa.json) e a mesma lógica de python/caixa.py.
import { CONFIG } from './config.js';
import { E, nomePessoa } from './estado.js';
import { $, $$, fmtBRL, fmtData, fmtDataHora, html, msgErro, norm, parseEtapas, raw, render, sha256Hex, toast } from './util.js';

const NAO_CONVALIDACAO = ['T3', 'T4'];
let previa = null;   // {arquivo, sha, blocos}

export function initCaixa() {
  $('#arq-caixa').addEventListener('change', async (ev) => {
    const arq = ev.target.files[0];
    if (!arq) return;
    render('#previa-caixa', html`<p class="muted" style="margin-top:10px">Lendo ${arq.name}…</p>`);
    try {
      const buf = await arq.arrayBuffer();
      const [mapa, XLSX] = await Promise.all([carregarMapa(), carregarSheetJS()]);
      const blocos = lerListas(XLSX.read(buf, { type: 'array' }), XLSX, mapa);
      if (!blocos.length) throw new Error('Não achei nenhuma tabela com a coluna "Operação" neste arquivo.');
      const chaves = await E.api.contratosChaves();
      const instrs = new Set(chaves.map((c) => c.nr_instrumento).filter(Boolean));
      const opers = new Set(chaves.map((c) => c.nr_operacao).filter(Boolean));
      let anterior = null;
      blocos.forEach((b) => {
        b.recebida_em = b.recebida_em || anterior;
        anterior = b.recebida_em;
        b.convalidacao = !NAO_CONVALIDACAO.includes(b.tabela);
        b.importar = true;
        b.casam = b.itens.filter((i) => instrs.has(i.nr_instrumento) || opers.has(i.nr_operacao)).length;
      });
      previa = { arquivo: arq.name, sha: await sha256Hex(buf), blocos };
      desenharPrevia();
    } catch (e) {
      render('#previa-caixa', html`<p class="erro" style="margin-top:10px">${msgErro(e)}</p>`);
    }
  });
}

function desenharPrevia() {
  const b = previa.blocos;
  render('#previa-caixa', html`<div style="margin-top:12px">
    <p class="pequeno" style="margin-bottom:8px">Confira cada tabela: a <b>data do e-mail</b> e se ela conta como <b>lista de convalidação</b>
      (a T3 "sem TGOV" e a T4 "executados por etapas" normalmente não contam).</p>
    <div class="tab-scroll"><table class="tab"><thead><tr><th>Importar</th><th>Tabela</th><th>Título</th><th>Data do e-mail</th><th>Convalidação?</th><th class="num">Itens</th><th class="num">Casam com cadastro</th></tr></thead><tbody>
    ${b.map((x, i) => html`<tr>
      <td><input type="checkbox" data-i="${i}" data-k="importar" ${x.importar ? raw('checked') : ''}></td>
      <td><input class="inp" style="width:70px" data-i="${i}" data-k="tabela" value="${x.tabela}"></td>
      <td>${x.titulo || '—'}<div class="muted pequeno">aba ${x.aba}, cabeçalho na linha ${x.linha}</div></td>
      <td><input class="inp" type="date" data-i="${i}" data-k="recebida_em" value="${x.recebida_em || ''}" required></td>
      <td><input type="checkbox" data-i="${i}" data-k="convalidacao" ${x.convalidacao ? raw('checked') : ''}></td>
      <td class="num">${x.itens.length}</td><td class="num">${x.casam}</td></tr>`)}
    </tbody></table></div>
    <div class="acoes-linha" style="margin-top:10px"><button class="btn" id="btn-importar" type="button">Importar listas marcadas</button>
      <button class="btn sec" id="btn-cancelar-imp" type="button">Cancelar</button><span class="erro" id="imp-erro"></span></div></div>`);
  $$('#previa-caixa [data-i]').forEach((el) => el.addEventListener('change', () => {
    const x = previa.blocos[+el.dataset.i];
    x[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim().toUpperCase();
    if (el.dataset.k === 'recebida_em') x.recebida_em = el.value;
  }));
  $('#btn-cancelar-imp').addEventListener('click', () => { previa = null; $('#arq-caixa').value = ''; render('#previa-caixa', ''); });
  $('#btn-importar').addEventListener('click', importar);
}

async function importar() {
  const marcados = previa.blocos.filter((b) => b.importar);
  if (marcados.some((b) => !b.recebida_em)) { $('#imp-erro').textContent = 'Preencha a data do e-mail de todas as tabelas marcadas.'; return; }
  $('#btn-importar').disabled = true;
  const msgs = [];
  for (const b of marcados) {
    try {
      const r = await E.api.importarLista({ recebida_em: b.recebida_em, tabela: b.tabela, titulo: b.titulo, arquivo_nome: previa.arquivo,
        arquivo_sha256: previa.sha, convalidacao: b.convalidacao, itens: b.itens.map(({ linha, ...i }) => i) });
      msgs.push(r.duplicada ? `${b.tabela}: já tinha sido importada` : `${b.tabela}: ${r.itens} itens (${r.casados} casados)`);
    } catch (e) { msgs.push(`${b.tabela}: erro — ${msgErro(e)}`); }
  }
  toast(msgs.join(' · '), msgs.some((m) => m.includes('erro')) ? 'erro' : 'ok');
  previa = null; $('#arq-caixa').value = ''; render('#previa-caixa', '');
  await E.recarregar();
  renderCaixa();
}

export async function renderCaixa() {
  const fila = E.fila || [];
  render('#fila-info', `${fila.length} item(ns) · mais recentes primeiro`);
  render('#fila', fila.length ? html`<div class="tab-scroll"><table class="tab"><thead><tr><th>Lista</th><th>Instrumento</th><th>Operação</th><th>Etapa</th><th>Recebedor</th><th>Situação / obs.</th><th class="num">Valor</th><th></th></tr></thead><tbody>
    ${fila.map((f, i) => html`<tr><td><b>${f.tabela}</b><div class="muted pequeno">${fmtData(f.recebida_em)}</div></td>
      <td><b>${f.nr_instrumento || '—'}</b></td><td>${f.nr_operacao || '—'}</td><td>${f.etapa_texto || 'Única'}</td>
      <td>${f.recebedor || ''}${f.uf ? `/${f.uf}` : ''}</td>
      <td>${f.situacao || ''}${f.obs_mcid ? html`<div class="muted pequeno">${f.obs_mcid}</div>` : ''}${f.passou_cgpac ? html`<div class="muted pequeno">Passou CGPAC: ${f.passou_cgpac}</div>` : ''}</td>
      <td class="num">${f.valor != null ? fmtBRL(f.valor) : ''}</td>
      <td><button class="btn sec" data-fila="${i}" type="button">Iniciar cadastro</button></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">Todos os itens das listas importadas já têm AIO cadastrado.</p>`);
  $$('#fila [data-fila]').forEach((b) => b.addEventListener('click', () => E.novoAio({ fila: fila[+b.dataset.fila] })));

  try {
    const listas = await E.api.listas();
    render('#listas', listas.length ? html`<div class="tab-scroll"><table class="tab"><thead><tr><th>E-mail</th><th>Tabela</th><th>Título</th><th>Convalidação</th><th class="num">Itens</th><th class="num">Casados</th><th>Importada</th></tr></thead><tbody>
      ${listas.map((l) => html`<tr><td class="num">${fmtData(l.recebida_em)}</td><td><b>${l.tabela}</b></td><td>${l.titulo || ''}<div class="muted pequeno">${l.arquivo_nome || ''}</div></td>
        <td>${l.convalidacao ? html`<span class="tag conv">sim</span>` : html`<span class="tag nao">não</span>`}</td>
        <td class="num">${l.itens ?? l.qtd_itens}</td><td class="num">${l.casados ?? ''}</td>
        <td class="pequeno">${fmtDataHora(l.importada_em)}<div class="muted">${nomePessoa(l.importada_por)}</div></td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">Nenhuma lista importada ainda.</p>`);
  } catch (e) { render('#listas', html`<p class="erro">${msgErro(e)}</p>`); }
}

// ---------------------------------------------------------------------------
// Leitor do .xlsx (espelho de python/caixa.py)
// ---------------------------------------------------------------------------
let _mapa = null;
async function carregarMapa() {
  if (!_mapa) _mapa = await (await fetch('js/caixa_mapa.json')).json();
  return _mapa;
}
function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = CONFIG.SHEETJS;
    s.onload = () => ok(window.XLSX);
    s.onerror = () => falha(new Error('Não consegui carregar o leitor de Excel (SheetJS). Verifique a internet.'));
    document.head.appendChild(s);
  });
}

const VAZIOS = new Set(['', '-', 'na', 'n/a', '#value!', '#n/a', '#ref!', 'none', 'null']);
const texto = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return VAZIOS.has(s.toLowerCase()) ? null : s;
};
const normCab = (v) => norm(v).replace(/\s+/g, ' ').replace(/\?+$/, '').trim();
const normInstr = (v) => { const d = String(v ?? '').split('/')[0].replace(/\D/g, ''); return d || null; };
const normOper = (v) => { const d = String(v ?? '').split('-')[0].replace(/\D/g, '').replace(/^0+/, ''); return d || null; };
function asData(v, XLSX) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 40000 || v > 60000) return null;
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function asNum(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/ /g, ' ').trim();
  if (VAZIOS.has(s.toLowerCase())) return null;
  s = s.replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function simNao(v) {
  const s = norm(v);
  if (!s || VAZIOS.has(s)) return null;
  if (s.startsWith('sim') || ['s', 'x', 'yes', 'true'].includes(s)) return true;
  if (s.startsWith('nao') || ['n', 'no', 'false'].includes(s)) return false;
  return null;
}
function tituloTabela(c) {
  const s = texto(c);
  if (!s) return null;
  const m = s.match(/^\s*tabela\s+(\d+)/i);
  if (!m) return null;
  const d = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return { tabela: `T${m[1]}`, titulo: String(c).split('\n')[0].trim(), recebida_em: d ? `${d[3]}-${d[2]}-${d[1]}` : null };
}

function lerListas(wb, XLSX, mapa) {
  const sin = {};
  Object.entries(mapa.campos).forEach(([campo, lista]) => lista.forEach((s) => { sin[s] = campo; }));
  const conv = (campo, v) => {
    const t = mapa.tipos[campo];
    if (t === 'numero') return asNum(v);
    if (t === 'data') return asData(v, XLSX);
    if (t === 'simnao') return simNao(v);
    return texto(v);
  };
  const blocos = [];
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: true });
    let titulo = null;
    for (let i = 0; i < linhas.length; i++) {
      const row = linhas[i] || [];
      for (const c of row) { const t = tituloTabela(c); if (t) { titulo = t; break; } }
      const cabs = row.map((c) => (c === null ? '' : normCab(c)));
      if (!(cabs.includes(mapa.cabecalho_obrigatorio) && cabs.filter((c) => sin[c]).length >= 3)) continue;
      const colCampo = {};
      row.forEach((c, j) => { const campo = c !== null && sin[normCab(c)]; if (campo && !Object.values(colCampo).includes(campo)) colCampo[j] = campo; });
      const bloco = { ...(titulo || { tabela: 'OUTRA', titulo: null, recebida_em: null }), aba: nome, linha: i + 1, itens: [] };
      i++;
      while (i < linhas.length && (linhas[i] || []).some((v) => v !== null && v !== '')) {
        const dados = linhas[i];
        if (dados.some((c) => tituloTabela(c))) break;
        const item = { raw: {} };
        dados.forEach((v, j) => {
          if (v === null || v === '') return;
          item.raw[texto(row[j]) || `col${j + 1}`] = v;
          const campo = colCampo[j];
          if (campo === 'etapa') { const e = parseEtapas(v); item.etapa_num = e.length ? e[0] : null; item.etapa_texto = texto(v); }
          else if (campo === 'nr_instrumento') item.nr_instrumento = normInstr(v);
          else if (campo === 'nr_operacao') item.nr_operacao = normOper(v);
          else if (campo) item[campo] = conv(campo, v);
        });
        if (item.nr_instrumento || item.nr_operacao) { item.linha = i + 1; bloco.itens.push(item); }
        i++;
      }
      i--;
      blocos.push(bloco);
      titulo = null;
    }
  }
  return blocos;
}
