// Estado compartilhado entre as telas do painel.
import { corClara, html, norm } from './util.js';

export const E = {
  api: null,
  usuario: null,          // e-mail logado
  admin: false,
  momentos: [],
  mom: {},                // codigo -> momento
  perfis: [],
  pessoa: {},             // email -> perfil
  aios: [],               // linhas de v_aio_painel
  sync: [],
  fila: [],
  aba: 'painel',
  filtros: { texto: '', momentos: [], resp: '', sec: '', tipo: '', conv: '', estr: '', atr: false, meus: false, concl: false },
  ordem: 'dias',
  abertos: new Set(),     // contratos expandidos na lista
  recarregar: async () => {},
  abrirAio: () => {},
  novoAio: () => {},
};

/** "AIO nº 12" (ou "AIO s/nº" antes da numeração). */
export const rotuloAio = (a) => (a?.numero ? `AIO nº ${a.numero}` : 'AIO s/nº');

/** "12", "#12", "nº 12", "aio 12" -> 12 ; outra coisa -> null */
export function numeroBuscado(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{1,3})$/);
  if (!m) m = t.match(/^(?:#|n[ºo°.]?\s*|aio\s*(?:n[ºo°.]?\s*)?)(\d{1,5})$/i);
  return m ? +m[1] : null;
}

export const PRINCIPAIS = () => E.momentos.filter((m) => !m.is_desvio);
export const DESVIOS = () => E.momentos.filter((m) => m.is_desvio);

export function nomePessoa(email) {
  if (!email) return '—';
  const p = E.pessoa[String(email).toLowerCase()];
  if (p?.nome) return p.nome;
  return String(email).split('@')[0];
}

export function pilulaMomento(codigo, extra = '') {
  const m = E.mom[codigo] || { nome: codigo, cor: '#8A96A8' };
  return html`<span class="mom ${corClara(m.cor) ? 'claro' : ''}" style="background:${m.cor}" title="${m.nome}">${m.nome}${extra}</span>`;
}

export function tagsCaixa(a) {
  return html`${a.presente_convalidacao ? html`<span class="tag conv" title="${a.caixa_listas || ''}">Convalidação</span>`
    : a.presente_caixa ? html`<span class="tag lst" title="${a.caixa_listas || ''}">Lista Caixa</span>`
    : html`<span class="tag nao">Fora das listas</span>`}`;
}

export function tagTipo(t) {
  if (t === 'EMISSAO') return html`<span class="tag emi">Emissão</span>`;
  if (t === 'CONVALIDACAO') return html`<span class="tag cvd">Convalidação</span>`;
  return html`<span class="muted pequeno">—</span>`;
}

/** Texto de busca de um AIO (instrumento, operação, SEI, município, proponente, descrição). */
export function textoBusca(a) {
  return norm([a.numero ? `#${a.numero}` : '', a.nr_instrumento, a.nr_operacao, a.nr_proposta, a.processo_sei, a.municipio, a.uf, a.proponente,
    a.descricao, a.tci, a.cod_tci, a.ressalvas, a.obs, nomePessoa(a.responsavel)].join(' '));
}

export function filtrar(lista = E.aios, ignorarMomento = false) {
  const f = E.filtros;
  const num = numeroBuscado(f.texto);
  const palavras = num !== null ? [] : norm(f.texto).split(/\s+/).filter(Boolean);
  return lista.filter((a) => {
    if (num !== null && a.numero !== num) return false;
    if (!ignorarMomento && f.momentos.length && !f.momentos.includes(a.momento)) return false;
    if (f.resp && (a.responsavel || '') !== f.resp) return false;
    if (f.sec && (a.secretaria || '') !== f.sec) return false;
    if (f.tipo === '-' ? a.tipo : f.tipo && a.tipo !== f.tipo) return false;
    if (f.conv === 'sim' && !a.presente_convalidacao) return false;
    if (f.conv === 'nao' && a.presente_convalidacao) return false;
    if (f.estr === 'unica' && a.em_etapas) return false;
    if (f.estr === 'etapas' && !a.em_etapas) return false;
    if (f.atr && !a.atrasado) return false;
    if (f.meus && (a.responsavel || '').toLowerCase() !== (E.usuario || '').toLowerCase()) return false;
    if (f.concl && a.is_final) return false;
    if (palavras.length) {
      const t = a._busca || (a._busca = textoBusca(a));
      if (!palavras.every((p) => t.includes(p))) return false;
    }
    return true;
  });
}
