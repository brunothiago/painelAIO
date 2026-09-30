// painelAIO — entrada: login, abas, filtros, KPIs, gargalo, lista agrupada, quadro, atividade.
import { criarApi } from './api.js';
import { E, DESVIOS, PRINCIPAIS, filtrar, nomePessoa, numeroBuscado, pilulaMomento, rotuloAio, tagTipo, tagsCaixa } from './estado.js';
import { $, $$, debounce, fmtBRLCurto, fmtData, fmtDataHora, fmtEtapas, html, msgErro, render, toast } from './util.js';
import { abrirDetalhe, detalheAberto, atualizarDetalhe } from './detalhe.js';
import { abrirNovo } from './novo.js';
import { renderCaixa, initCaixa } from './caixa.js';
import { exportarCSV, exportarXLSX } from './exportar.js';
import { VERSAO, abrirVersoes } from './versoes.js';

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function iniciar() {
  try {
    E.api = await criarApi();
  } catch (e) {
    render('#carregando', html`<div class="login-card"><h1>Painel AIO</h1><p class="erro">${msgErro(e)}</p></div>`);
    return;
  }
  const email = await E.api.sessao();
  if (email) return entrarNoApp(email);
  mostrarLogin();
}

function mostrarLogin() {
  $('#carregando').classList.add('oculto');
  $('#app').classList.add('oculto');
  $('#tela-login').classList.remove('oculto');
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, btn = f.querySelector('button');
  btn.disabled = true; $('#login-erro').textContent = '';
  try {
    await E.api.entrar(f.email.value, f.senha.value);
    await entrarNoApp(await E.api.sessao());
  } catch (e) {
    $('#login-erro').textContent = msgErro(e);
  } finally { btn.disabled = false; }
});

async function entrarNoApp(email) {
  E.usuario = email;
  lerHash();
  try {
    await recarregar();
  } catch (e) {
    toast(msgErro(e), 'erro');
    if (/sessão expirou|JWT/i.test(msgErro(e))) { await E.api.sair(); return mostrarLogin(); }
  }
  const perfil = E.pessoa[email.toLowerCase()];
  if (!perfil || !perfil.ativo) {
    $('#carregando').classList.add('oculto');
    $('#tela-login').classList.remove('oculto');
    $('#login-erro').textContent = `Acesso não liberado para ${email}. Peça ao administrador para incluir seu e-mail.`;
    await E.api.sair();
    return;
  }
  E.admin = perfil.papel === 'admin';
  $('#carregando').classList.add('oculto');
  $('#tela-login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  $('#btn-usuario').textContent = `${perfil.nome || email}${E.admin ? ' · admin' : ''} ▾`;
  $('#btn-versao').textContent = `Versão ${VERSAO}${E.api.modo === 'mock' ? ' · prévia' : ''}`;
  preencherSelects();
  aplicarFiltrosNaTela();
  mudarAba(E.aba);
  E.api.ouvir(aoMudarNoBanco, (on) => {
    const v = $('#vivo');
    v.className = `vivo ${on ? 'on' : 'off'}`;
    v.querySelector('span').textContent = E.api.modo === 'mock' ? 'prévia local' : on ? 'ao vivo' : 'reconectando…';
    if (!on && E.api.modo !== 'mock') iniciarPolling();
  });
  const q = new URLSearchParams(location.search);
  if (q.get('aio')) abrirDetalhe(+q.get('aio'));
}

let pollTimer = null;
function iniciarPolling() {  // se o tempo real estiver bloqueado na rede, atualiza a cada 60 s
  if (pollTimer) return;
  pollTimer = setInterval(() => recarregar().catch(() => {}), 60000);
}

const recarregarDebounced = debounce(() => recarregar().catch((e) => toast(msgErro(e), 'erro')), 800);
function aoMudarNoBanco(tabela, ev) {
  if (tabela === 'aio' && detalheAberto() === ev.new?.id && ev.new?.updated_by !== E.usuario) {
    toast(`${nomePessoa(ev.new.updated_by)} alterou este AIO agora.`);
  }
  recarregarDebounced();
}

async function recarregar() {
  const d = await E.api.carregar();
  E.momentos = d.momentos;
  E.mom = Object.fromEntries(d.momentos.map((m) => [m.codigo, m]));
  E.perfis = d.perfis;
  E.pessoa = Object.fromEntries(d.perfis.map((p) => [p.email.toLowerCase(), p]));
  E.aios = d.aios;
  E.sync = d.sync || [];
  E.api.fila().then((f) => { E.fila = f; $('#cont-fila').textContent = f.length || ''; if (E.aba === 'caixa') renderCaixa(); }).catch(() => {});
  if (!$('#app').classList.contains('oculto')) {
    renderTudo();
    atualizarDetalhe();
  }
}
E.recarregar = recarregar;
E.abrirAio = (id) => abrirDetalhe(id);
E.novoAio = (pre) => abrirNovo(pre);

// ---------------------------------------------------------------------------
// Cabeçalho, abas, menu
// ---------------------------------------------------------------------------
$('#btn-usuario').addEventListener('click', (e) => { e.stopPropagation(); $('#menu-usuario').classList.toggle('oculto'); });
document.addEventListener('click', () => $('#menu-usuario').classList.add('oculto'));
$('#menu-usuario').addEventListener('click', async (e) => {
  const acao = e.target.dataset.acao;
  if (acao === 'sair') { await E.api.sair(); location.reload(); }
  if (acao === 'senha') abrirTrocaSenha();
});
$('#btn-versao').addEventListener('click', abrirVersoes);
$('#btn-novo').addEventListener('click', () => abrirNovo());
$$('#abas .aba').forEach((b) => b.addEventListener('click', () => mudarAba(b.dataset.aba)));

function mudarAba(aba) {
  E.aba = aba;
  $$('#abas .aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  ['painel', 'quadro', 'caixa', 'atividade'].forEach((a) => $(`#aba-${a}`).classList.toggle('oculto', a !== aba));
  $('#bloco-filtros').classList.toggle('oculto', !['painel', 'quadro'].includes(aba));
  escreverHash();
  renderTudo();
}

function abrirTrocaSenha() {
  const raiz = $('#modal-raiz');
  render(raiz, html`<div class="modal"><form class="modal-card" style="max-width:420px" id="form-senha">
    <div class="modal-cab"><h2>Trocar senha</h2><button class="fechar" type="button" data-fechar>×</button></div>
    <div class="modal-corpo">
      <label class="campo"><span>Nova senha (mínimo 8 caracteres)</span><input type="password" name="s1" minlength="8" required autocomplete="new-password"></label>
      <label class="campo"><span>Repita a nova senha</span><input type="password" name="s2" minlength="8" required autocomplete="new-password"></label>
      <div class="erro" id="senha-erro"></div>
      <button class="btn" type="submit">Salvar senha</button>
    </div></form></div>`);
  raiz.querySelector('[data-fechar]').onclick = () => render(raiz, '');
  raiz.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.s1.value !== f.s2.value) { $('#senha-erro').textContent = 'As senhas não conferem.'; return; }
    try { await E.api.trocarSenha(f.s1.value); render(raiz, ''); toast('Senha alterada.', 'ok'); }
    catch (e) { $('#senha-erro').textContent = msgErro(e); }
  };
}

// ---------------------------------------------------------------------------
// Filtros (guardados no endereço, para compartilhar a visão)
// ---------------------------------------------------------------------------
function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = E.filtros;
  E.aba = p.get('aba') || 'painel';
  f.texto = p.get('q') || '';
  f.momentos = (p.get('m') || '').split(',').filter(Boolean);
  f.resp = p.get('resp') || ''; f.sec = p.get('sec') || ''; f.tipo = p.get('tipo') || '';
  f.conv = p.get('conv') || ''; f.estr = p.get('estr') || '';
  f.atr = p.get('atr') === '1'; f.meus = p.get('meus') === '1'; f.concl = p.get('concl') === '1';
  E.ordem = p.get('ordem') || 'dias';
}
function escreverHash() {
  const f = E.filtros, p = new URLSearchParams();
  if (E.aba !== 'painel') p.set('aba', E.aba);
  if (f.texto) p.set('q', f.texto);
  if (f.momentos.length) p.set('m', f.momentos.join(','));
  ['resp', 'sec', 'tipo', 'conv', 'estr'].forEach((k) => f[k] && p.set(k, f[k]));
  ['atr', 'meus', 'concl'].forEach((k) => f[k] && p.set(k, '1'));
  if (E.ordem !== 'dias') p.set('ordem', E.ordem);
  history.replaceState(null, '', `${location.pathname}${location.search}${p.toString() ? '#' + p : ''}`);
}

function preencherSelects() {
  const resp = [...new Set(E.aios.map((a) => a.responsavel).filter(Boolean))]
    .sort((a, b) => nomePessoa(a).localeCompare(nomePessoa(b)));
  render('#f-resp', html`<option value="">Todos os responsáveis</option>${resp.map((r) => html`<option value="${r}">${nomePessoa(r)}</option>`)}`);
  const secs = [...new Set(E.aios.map((a) => a.secretaria).filter(Boolean))].sort();
  render('#f-sec', html`<option value="">Todas as secretarias</option>${secs.map((s) => html`<option>${s}</option>`)}`);
}

function aplicarFiltrosNaTela() {
  const f = E.filtros;
  $('#f-texto').value = f.texto;
  $('#f-resp').value = f.resp; $('#f-sec').value = f.sec; $('#f-tipo').value = f.tipo;
  $('#f-conv').value = f.conv; $('#f-estr').value = f.estr; $('#ordem').value = E.ordem;
  $('#f-atr').classList.toggle('ativo', f.atr);
  $('#f-meus').classList.toggle('ativo', f.meus);
  $('#f-concl').classList.toggle('ativo', f.concl);
}

function aoFiltrar() { escreverHash(); renderTudo(); }
$('#f-texto').addEventListener('input', debounce((e) => { E.filtros.texto = e.target.value; aoFiltrar(); }, 200));
$('#f-texto').addEventListener('keydown', (e) => {   // Enter com "12" ou "#12" abre o AIO nº 12
  if (e.key !== 'Enter') return;
  const n = numeroBuscado(e.target.value);
  const a = n !== null && E.aios.find((x) => x.numero === n);
  if (a) abrirDetalhe(a.id); else if (n !== null) toast(`Não há AIO nº ${n}.`);
});
[['#f-resp', 'resp'], ['#f-sec', 'sec'], ['#f-tipo', 'tipo'], ['#f-conv', 'conv'], ['#f-estr', 'estr']].forEach(([sel, k]) =>
  $(sel).addEventListener('change', (e) => { E.filtros[k] = e.target.value; aoFiltrar(); }));
[['#f-atr', 'atr'], ['#f-meus', 'meus'], ['#f-concl', 'concl']].forEach(([sel, k]) =>
  $(sel).addEventListener('click', (e) => { E.filtros[k] = !E.filtros[k]; e.target.classList.toggle('ativo', E.filtros[k]); aoFiltrar(); }));
$('#f-limpar').addEventListener('click', () => {
  E.filtros = { texto: '', momentos: [], resp: '', sec: '', tipo: '', conv: '', estr: '', atr: false, meus: false, concl: false };
  aplicarFiltrosNaTela(); aoFiltrar();
});
$('#ordem').addEventListener('change', (e) => { E.ordem = e.target.value; aoFiltrar(); });
$('#btn-csv').addEventListener('click', () => exportarCSV(filtrar()));
$('#btn-xlsx').addEventListener('click', () => exportarXLSX(filtrar()));

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderTudo() {
  if (!E.momentos.length) return;
  if (E.aba === 'painel' || E.aba === 'quadro') { renderKpis(); renderGargalo(); }
  if (E.aba === 'painel') renderLista();
  if (E.aba === 'quadro') renderQuadro();
  if (E.aba === 'caixa') renderCaixa();
  if (E.aba === 'atividade') renderAtividade();
  renderRodape();
}

const NA_CGPAC = ['RECEBIDO', 'EM_ANALISE', 'PENDENCIA_CGPAC'];
const NO_GABSE = ['TRAMITADO_GABSE', 'ASSINADO'];

function renderKpis() {
  const l = filtrar();
  const ativos = l.filter((a) => !a.is_final);
  const conv = l.filter((a) => a.presente_convalidacao).length;
  const pct = l.length ? Math.round((conv / l.length) * 100) : 0;
  const valor = ativos.reduce((s, a) => s + (+a.valor_solicitado || 0), 0);
  const n = (f) => l.filter(f).length;
  render('#kpis', html`
    <div class="stat"><div class="n">${ativos.length} <small>/ ${l.length}</small></div><div class="l">Em andamento / total</div></div>
    <div class="stat and"><div class="n">${n((a) => NA_CGPAC.includes(a.momento))}</div><div class="l">Na CGPAC</div></div>
    <div class="stat escuro"><div class="n">${n((a) => NO_GABSE.includes(a.momento))}</div><div class="l">No GAB-SE</div></div>
    <div class="stat ok"><div class="n">${n((a) => a.momento === 'CONCLUIDO')}</div><div class="l">Concluídos</div></div>
    <div class="stat desv"><div class="n">${n((a) => a.is_desvio && !a.is_final)}</div><div class="l">Em desvio</div></div>
    <div class="stat atr"><div class="n">${n((a) => a.atrasado)}</div><div class="l">Atrasados (acima do prazo)</div></div>
    <div class="stat ok"><div class="n">${pct}% <small>(${conv})</small></div><div class="l">Na lista de convalidação</div></div>
    <div class="stat"><div class="n">${n((a) => a.tipo === 'EMISSAO')} <small>× ${n((a) => a.tipo === 'CONVALIDACAO')}</small></div><div class="l">Emissão × convalidação</div></div>
    <div class="stat"><div class="n" style="font-size:1.35rem">${fmtBRLCurto(valor)}</div><div class="l">Valor em andamento</div></div>`);
}

function renderGargalo() {
  const l = filtrar(E.aios, true);
  const grupos = [PRINCIPAIS(), DESVIOS()];
  const max = Math.max(1, ...E.momentos.map((m) => l.filter((a) => a.momento === m.codigo).length));
  const barra = (m) => {
    const itens = l.filter((a) => a.momento === m.codigo);
    const media = itens.length && !m.is_final ? Math.round(itens.reduce((s, a) => s + (a.dias_no_momento || 0), 0) / itens.length) : null;
    const h = Math.max(3, Math.round((itens.length / max) * 70));
    const sel = E.filtros.momentos.includes(m.codigo);
    return html`<button class="gbar ${sel ? 'sel' : ''}" data-m="${m.codigo}" type="button" title="${m.nome}">
      <span class="gv">${itens.length}</span><span class="barra" style="height:${h}px;background:${m.cor}"></span>
      <span class="gl">${m.nome}</span><span class="gm">${media !== null ? `${media} d` : ''}</span></button>`;
  };
  render('#gargalo', html`${grupos[0].map(barra)}<span class="gsep"></span>${grupos[1].map(barra)}`);
  $$('#gargalo .gbar').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.m, f = E.filtros;
    f.momentos = f.momentos.includes(m) ? f.momentos.filter((x) => x !== m) : [...f.momentos, m];
    aoFiltrar();
  }));
}

function ordenar(l) {
  const c = {
    dias: (a, b) => (b.is_final - a.is_final) * -1 || (b.dias_no_momento ?? -1) - (a.dias_no_momento ?? -1),
    momento: (a, b) => a.momento_ordem - b.momento_ordem || (b.dias_no_momento ?? 0) - (a.dias_no_momento ?? 0),
    numero: (a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9),
    instrumento: (a, b) => String(a.nr_instrumento).localeCompare(String(b.nr_instrumento), 'pt', { numeric: true }),
    recentes: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)),
    valor: (a, b) => (+b.valor_solicitado || 0) - (+a.valor_solicitado || 0),
  }[E.ordem];
  return [...l].sort(c);
}

function linhaAio(a, filho = false) {
  const dias = a.is_final ? '' : a.dias_no_momento != null ? `há ${a.dias_no_momento} dia${a.dias_no_momento === 1 ? '' : 's'}` : '';
  return html`<div class="lrow ${filho ? 'filho' : ''}" data-aio="${a.id}">
    <div class="c-num" title="${rotuloAio(a)}">${a.numero ?? '—'}</div>
    <div class="c-inst">${filho ? html`<span class="muted">↳ </span>` : html`<b>${a.nr_instrumento || a.nr_operacao || '—'}</b>`}
      ${!filho && a.link_saci ? html` <a class="saci" href="${a.link_saci}" target="_blank" rel="noopener" data-stop>SACI</a>` : ''}
      ${a.problemas ? html` <span class="tag prob" title="${a.ressalvas || ''}">!</span>` : ''}</div>
    <div class="c-obj">${filho ? html`<div class="desc">${a.etapa_descricao || a.descricao || ''}</div>`
      : html`<div class="mun">${a.municipio || '—'}${a.uf ? `/${a.uf}` : ''} <span class="muted pequeno">${a.secretaria || ''}</span></div><div class="desc" title="${a.descricao || ''}">${a.descricao || a.proponente || ''}</div>`}</div>
    <div class="c-etp">${a.etapas?.length ? html`<span class="tag etp">Etapa ${fmtEtapas(a.etapas)}</span>`
      : a.em_etapas ? html`<span class="tag etp" title="Contrato em etapas sem a etapa informada">Etapa ?</span>` : html`<span class="muted pequeno">Única</span>`}</div>
    <div class="c-tipo">${tagTipo(a.tipo)}</div>
    <div class="c-mom">${pilulaMomento(a.momento)}<span class="dias ${a.atrasado ? 'atr' : ''}">${dias}${a.atrasado ? ` · prazo ${a.sla_dias} d` : ''}</span></div>
    <div class="c-resp pequeno">${nomePessoa(a.responsavel)}</div>
    <div class="c-cx">${tagsCaixa(a)}</div>
    <div class="c-val num">${fmtBRLCurto(+a.valor_solicitado || 0)}</div>
  </div>`;
}

function renderLista() {
  const l = ordenar(filtrar());
  const grupos = new Map();
  l.forEach((a) => { if (!grupos.has(a.contrato_id)) grupos.set(a.contrato_id, []); grupos.get(a.contrato_id).push(a); });
  const nContr = grupos.size;
  const nEtapas = [...grupos.keys()].filter((cid) => grupos.get(cid)[0].em_etapas || E.aios.filter((a) => a.contrato_id === cid).length > 1).length;
  render('#info-lista', html`<b>${l.length}</b> AIO${l.length === 1 ? '' : 's'} em <b>${nContr}</b> contrato${nContr === 1 ? '' : 's'} (${nEtapas} em etapas)`);
  if (!l.length) { render('#lista', html`<div class="vazio">Nenhum AIO com esses filtros.</div>`); return; }

  // todos os AIOs do contrato (mesmo fora do filtro) para mostrar o conjunto de etapas
  const todosDoContrato = (cid) => E.aios.filter((a) => a.contrato_id === cid).sort((x, y) => (x.etapas[0] ?? 0) - (y.etapas[0] ?? 0));
  const partes = [html`<div class="lcab"><div>Nº</div><div>Instrumento</div><div>Município · objeto</div><div>Etapa</div><div>Tipo</div><div>Momento</div><div>Responsável</div><div>Caixa</div><div style="text-align:right">Valor</div></div>`];
  for (const [cid, g] of grupos) {
    const a0 = g[0];
    const todos = todosDoContrato(cid);
    if (todos.length === 1) { partes.push(linhaAio(a0)); continue; }
    const aberto = E.abertos.has(cid) || !!E.filtros.texto;
    const total = todos.reduce((s, a) => s + (+a.valor_solicitado || 0), 0);
    const maxDias = Math.max(...g.filter((a) => !a.is_final).map((a) => a.dias_no_momento || 0), 0);
    partes.push(html`<div class="lrow pai ${aberto ? 'aberto' : ''}" data-contrato="${cid}">
      <div class="c-num" title="AIOs deste contrato">${todos.map((a) => a.numero ?? '—').join(', ')}</div>
      <div class="c-inst"><span class="seta">▶</span><b>${a0.nr_instrumento || a0.nr_operacao}</b>
        ${a0.link_saci ? html` <a class="saci" href="${a0.link_saci}" target="_blank" rel="noopener" data-stop>SACI</a>` : ''}</div>
      <div class="c-obj"><div class="mun">${a0.municipio || '—'}${a0.uf ? `/${a0.uf}` : ''} <span class="muted pequeno">${a0.secretaria || ''}</span></div>
        <div class="desc" title="${a0.descricao || ''}">${a0.descricao || a0.proponente || ''}</div></div>
      <div class="c-etp"><span class="tag etp">${todos.length} AIO${todos.length === 1 ? '' : 's'}</span></div>
      <div class="c-tipo"><span class="muted pequeno">em etapas</span></div>
      <div class="c-mom"><div class="minis">${todos.map((a) => html`<span class="mini" style="background:${E.mom[a.momento]?.cor}" title="Etapa ${fmtEtapas(a.etapas)}: ${E.mom[a.momento]?.nome}"></span>`)}</div>
        <span class="dias">${maxDias ? `mais antigo há ${maxDias} dias` : ''}</span></div>
      <div class="c-resp pequeno">${[...new Set(todos.map((a) => nomePessoa(a.responsavel)))].join(', ')}</div>
      <div class="c-cx">${tagsCaixa({ presente_convalidacao: todos.some((a) => a.presente_convalidacao), presente_caixa: todos.some((a) => a.presente_caixa), caixa_listas: a0.caixa_listas })}</div>
      <div class="c-val num">${fmtBRLCurto(total)}</div></div>`);
    if (aberto) (E.filtros.texto ? todos : g).forEach((a) => partes.push(linhaAio(a, true)));
  }
  render('#lista', html`${partes}`);
  $$('#lista [data-stop]').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
  $$('#lista .lrow[data-aio]').forEach((el) => el.addEventListener('click', () => abrirDetalhe(+el.dataset.aio)));
  $$('#lista .lrow[data-contrato]').forEach((el) => el.addEventListener('click', () => {
    const cid = +el.dataset.contrato;
    E.abertos.has(cid) ? E.abertos.delete(cid) : E.abertos.add(cid);
    renderLista();
  }));
}

function renderQuadro() {
  const l = ordenar(filtrar());
  const col = (titulo, cor, itens) => html`<div class="coluna"><h4 style="border-color:${cor}"><span>${titulo}</span><span>${itens.length}</span></h4>
    ${itens.map((a) => html`<div class="kcard" data-aio="${a.id}">
      <div><span class="nro">${a.numero ?? '—'}</span><b>${a.nr_instrumento || a.nr_operacao}</b> ${a.etapas?.length ? html`<span class="tag etp">Etapa ${fmtEtapas(a.etapas)}</span>` : ''} ${tagTipo(a.tipo)}</div>
      <div>${a.municipio || ''}${a.uf ? `/${a.uf}` : ''}</div>
      ${a.is_desvio ? html`<div>${pilulaMomento(a.momento)}</div>` : ''}
      <div class="pequeno ${a.atrasado ? 'erro' : 'muted'}" style="margin:2px 0 0">${a.is_final ? fmtData(a.momento_desde) : `há ${a.dias_no_momento} dias`} · ${nomePessoa(a.responsavel)}</div>
    </div>`)}</div>`;
  const cols = PRINCIPAIS().map((m) => col(m.nome, m.cor, l.filter((a) => a.momento === m.codigo)));
  cols.push(col('Desvios', '#D46A00', l.filter((a) => a.is_desvio)));
  render('#quadro', html`${cols}`);
  $$('#quadro .kcard').forEach((el) => el.addEventListener('click', () => abrirDetalhe(+el.dataset.aio)));
}

const ACOES = { criado: 'cadastrou', momento: 'mudou o momento', edicao: 'editou', excluido: 'excluiu', restaurado: 'restaurou' };
async function renderAtividade() {
  render('#atividade', html`<p class="muted">Carregando…</p>`);
  try {
    const itens = await E.api.atividade(200);
    if (!itens.length) { render('#atividade', html`<p class="muted">Nenhuma alteração ainda.</p>`); return; }
    render('#atividade', html`<div class="tab-scroll"><table class="tab"><thead><tr><th>Quando</th><th>Quem</th><th>AIO</th><th>O quê</th></tr></thead><tbody>
      ${itens.map((h) => html`<tr data-aio="${h.aio_id}" style="cursor:pointer">
        <td class="num">${fmtDataHora(h.em)}</td><td>${nomePessoa(h.por)}</td>
        <td>${h.numero ? html`<span class="nro">${h.numero}</span>` : ''}<b>${h.nr_instrumento || '—'}</b> ${h.etapas?.length ? `etapa ${fmtEtapas(h.etapas)}` : ''}<div class="muted pequeno">${h.municipio || ''}${h.uf ? `/${h.uf}` : ''}</div></td>
        <td>${ACOES[h.acao] || h.acao}${h.acao === 'momento' || h.acao === 'criado' ? html` → ${pilulaMomento(h.momento_para)} <span class="muted pequeno">${fmtData(h.data_momento)}</span>` : ''}
          ${h.acao === 'edicao' && h.diff ? html`<div class="muted pequeno">${Object.keys(h.diff).join(', ')}</div>` : ''}
          ${h.obs ? html`<div class="muted pequeno">“${h.obs}”</div>` : ''}</td></tr>`)}
    </tbody></table></div>`);
    $$('#atividade tr[data-aio]').forEach((tr) => tr.addEventListener('click', () => abrirDetalhe(+tr.dataset.aio)));
  } catch (e) { render('#atividade', html`<p class="erro">${msgErro(e)}</p>`); }
}

function renderRodape() {
  const ult = (script) => E.sync.find((s) => s.script === script && s.ok);
  const ref = ult('03_sync_referencia');
  render('#rodape', html`Painel AIO · MCID/SE/DMP/CGPAC ·
    ${ref ? html`dados do SACI/TransfereGov atualizados em ${fmtDataHora(ref.em)}` : 'dados do SACI/TransfereGov ainda não sincronizados'}
    ${E.api?.modo === 'mock' ? html` · <b>prévia local: alterações não são gravadas</b>` : ''}`);
}

initCaixa();
iniciar();

