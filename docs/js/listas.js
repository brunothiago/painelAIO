// Listas fixas dos campos de escolha (evitam erro de digitação).
// Grafia de secretaria e modalidade = a do SACI, para o que a equipe preenche
// casar com o que vem da tabela referencia. sql/07_padronizar.sql acerta o que
// já estava gravado; mudou uma lista aqui, confira lá também.
//
// Lista "aberta": tem a opção "Outro (digitar)…" para casos novos.
// Lista fechada: valor antigo fora da lista continua aparecendo (marcado) até alguém trocar.
import { $$, html, norm, raw } from './util.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export const LISTAS = {
  uf: { ops: UFS },
  secretaria: { ops: ['SNSA', 'SNP', 'SNH', 'SEMOB'] },
  modalidade: {
    grupos: {
      SNSA: ['Abastecimento de água - Rural', 'Abastecimento de água - Urbano', 'Esgotamento sanitário', 'Drenagem Urbana', 'Resíduos Sólidos'],
      SNP: ['Contenção de Encostas', 'Regularização Fundiária', 'Urbanização de Favelas', 'Assessoria Técnica HIS'],
      SEMOB: ['Médias e Grandes Cidades'],
      SNH: ['MCMV FNHIS', 'MCMV FNHIS SUB50'],
    },
    // grafias antigas da planilha
    apelidos: { contencao: 'Contenção de Encostas', drenagem: 'Drenagem Urbana', urbanizacao: 'Urbanização de Favelas', esgoto: 'Esgotamento sanitário' },
  },
  fase_pac: { ops: ['Novo PAC Seleção 2024', 'Novo PAC Seleção 2025', 'Novo PAC Migrado', 'Novo PAC MCMV', 'PAC 2', 'PAC 1'] },
  status_sei: { ops: ['Assinado', 'Para conferência'], aberta: true },
  localizacao_sei: {
    ops: ['CGPAC-MCID', 'CMON-MCID', 'GAB-SE-MCID', 'SNSA', 'SNP', 'SNH', 'SEMOB', 'Não possui andamentos abertos'],
    aberta: true,
  },
};

// Referência da solicitação: valores que conferem, ligados por " = " (ex.: "Global Repasse = SPA Repasse").
export const REF_PARTES = ['Global Investimento Total', 'Global Repasse', 'SPA Global', 'SPA Repasse', 'Licitação Global', 'Licitação Repasse'];
const REF_SEM = 'sem referência';
const REF_APELIDOS = { 'spa gllobal': 'SPA Global' };

// Formatos fixos (o navegador não deixa salvar fora do padrão).
export const FORMATOS = {
  processo_sei: { padrao: '\\d{5}\\.\\d{6}/\\d{4}-\\d{2}', dica: 'Formato 80000.012345/2026-12 (pode digitar só os números)', ex: '80000.012345/2026-12' },
  nr_instrumento: { padrao: '\\d+(/\\d{4})?', dica: 'Só números', ex: '968619' },
  nr_operacao: { padrao: '[\\d.]+(-\\d+)?', dica: 'Só números', ex: '1098106' },
};

const OUTRO = '__outro';
const chave = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
const opcoes = (def) => def.ops || Object.values(def.grupos).flat();

/** Valor na grafia da lista (ignora maiúsculas, acentos, hífens e apelidos); null se não casar. */
export function canon(lista, v) {
  if (v === null || v === undefined || v === '') return null;
  const def = LISTAS[lista], k = chave(v);
  return opcoes(def).find((o) => chave(o) === k) || def.apelidos?.[k] || null;
}

/** Valor para gravar: a grafia da lista ou, se não casar, o texto como veio. */
export const padronizar = (lista, v) => canon(lista, v) ?? (v || null);

function optsHtml(arr, sel) {
  return arr.map((o) => html`<option value="${o}" ${o === sel ? raw('selected') : ''}>${o}</option>`);
}

/** <select> da lista (mais a caixa "Outro" nas listas abertas). `nome` = name do campo no form.
 *  estrito: valor fora da lista não vira opção, só aparece como aviso (cadastro novo). */
export function campoLista(nome, lista, v, { vazio = '—', estrito = false } = {}) {
  const def = LISTAS[lista];
  const c = canon(lista, v);
  const fora = v && !c;
  const outro = fora && def.aberta;
  const corpo = def.grupos
    ? Object.entries(def.grupos).map(([g, ops]) => html`<optgroup label="${g}">${optsHtml(ops, c)}</optgroup>`)
    : optsHtml(def.ops, c);
  return html`<select name="${nome}" data-lista="${nome}">
      <option value="">${vazio}</option>
      ${fora && !def.aberta && !estrito ? html`<option value="${v}" selected>${v} (fora da lista)</option>` : ''}
      ${corpo}
      ${def.aberta ? html`<option value="${OUTRO}" ${outro ? raw('selected') : ''}>Outro (digitar)…</option>` : ''}
    </select>
    ${def.aberta ? html`<input type="text" name="${nome}__txt" value="${outro ? v : ''}" placeholder="Digite o valor"
      class="${outro ? '' : 'oculto'}" ${outro ? raw('required') : ''}>` : ''}
    ${fora && !def.aberta && estrito ? html`<small class="muted">Na origem veio “${v}”: escolha o item certo na lista.</small>` : ''}`;
}

export function lerLista(form, nome) {
  const el = form.elements[nome];
  if (!el) return undefined;
  if (el.value === OUTRO) return form.elements[`${nome}__txt`]?.value.trim() || null;
  return el.value || null;
}

/** Caixas de marcar da referência da solicitação; partes fora da lista vão para "Outros". */
export function campoRef(nome, v) {
  const partes = String(v ?? '').split(/\s*=\s*/).map((p) => p.trim()).filter(Boolean);
  const marcadas = new Set(), extras = [];
  let sem = false;
  partes.forEach((p) => {
    const k = chave(p);
    if (k === chave(REF_SEM)) { sem = true; return; }
    const c = REF_PARTES.find((o) => chave(o) === k) || REF_APELIDOS[k];
    if (c) marcadas.add(c); else extras.push(p);
  });
  return html`<div class="marcas" data-ref="${nome}">
      ${REF_PARTES.map((o) => html`<label><input type="checkbox" name="${nome}__p" value="${o}" ${marcadas.has(o) ? raw('checked') : ''}> ${o}</label>`)}
      <label><input type="checkbox" name="${nome}__sem" ${sem ? raw('checked') : ''}> Sem referência</label>
    </div>
    <input type="text" name="${nome}__txt" value="${extras.join(' = ')}" placeholder="Outros (só se não estiver acima)">`;
}

export function lerRef(form, nome) {
  if (!form.elements[`${nome}__txt`]) return undefined;
  if (form.elements[`${nome}__sem`]?.checked) return 'sem referência';
  const marc = $$(`input[name="${nome}__p"]:checked`, form).map((i) => i.value);
  const partes = [...REF_PARTES.filter((o) => marc.includes(o)), form.elements[`${nome}__txt`].value.trim()].filter(Boolean);
  return partes.join(' = ') || null;
}

/** Atributos de formato (pattern/title) para <input>. */
export function attrFormato(k) {
  const f = FORMATOS[k];
  return f ? html`pattern="${f.padrao}" title="${f.dica}" placeholder="ex.: ${f.ex}"` : '';
}

/** Liga o comportamento das listas de um form: "Outro" mostra a caixa de texto;
 *  "Sem referência" desmarca o resto; processo SEI com 17 dígitos ganha pontuação. */
export function ligarListas(form) {
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.lista) {
      const txt = form.elements[`${t.name}__txt`];
      if (txt) {
        const ab = t.value === OUTRO;
        txt.classList.toggle('oculto', !ab); txt.required = ab;
        if (ab) txt.focus(); else txt.value = '';
      }
    }
    const caixa = t.closest('[data-ref]');
    if (caixa && t.checked) {
      const sem = t.name.endsWith('__sem');
      $$('input[type=checkbox]', caixa).forEach((i) => { if (i !== t && i.name.endsWith('__sem') !== sem) i.checked = false; });
    }
    if (t.dataset.lista || caixa) form.dispatchEvent(new Event('input'));   // recontar alterações
  });
  form.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!/(^|_)processo_sei$/.test(t.name || '')) return;
    const d = t.value.replace(/\D/g, '');
    if (d.length === 17) {
      t.value = `${d.slice(0, 5)}.${d.slice(5, 11)}/${d.slice(11, 15)}-${d.slice(15)}`;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
