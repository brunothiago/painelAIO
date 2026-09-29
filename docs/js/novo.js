// "Novo AIO": buscar o instrumento nos dados já conhecidos e iniciar o cadastro
// com os campos pré-preenchidos.
import { E, DESVIOS, PRINCIPAIS, nomePessoa, pilulaMomento } from './estado.js';
import { $, $$, debounce, fmtData, fmtEtapas, hojeISO, html, msgErro, parseEtapas, raw, render, toast } from './util.js';
import { abrirDetalhe } from './detalhe.js';

const raiz = () => $('#modal-raiz');
const fechar = () => render(raiz(), '');

/** pre: undefined | {contratoDe: linhaAio} | {fila: itemDaFila} */
export function abrirNovo(pre) {
  if (pre?.contratoDe) {
    const a = pre.contratoDe;
    return formulario({ origem: 'contrato', contrato_id: a.contrato_id, contrato: contratoDaLinha(a), sugestao: { tipo: a.tipo } });
  }
  if (pre?.fila) return formulario(daFila(pre.fila));
  busca();
}

function moldura(titulo, corpo) {
  render(raiz(), html`<div class="modal" id="modal-novo"><div class="modal-card">
    <div class="modal-cab"><h2>${titulo}</h2><button class="fechar" type="button" data-fechar aria-label="Fechar">×</button></div>
    <div class="modal-corpo">${corpo}</div></div></div>`);
  $$('#modal-novo [data-fechar]').forEach((b) => b.addEventListener('click', fechar));
  $('#modal-novo').addEventListener('click', (e) => { if (e.target.id === 'modal-novo') fechar(); });
}

// ---------------------------------------------------------------------------
// Passo 1: busca
// ---------------------------------------------------------------------------
function busca() {
  moldura('Novo AIO — encontre o instrumento', html`
    <label class="campo"><span>Nº do instrumento, operação, processo SEI, município ou proponente</span>
      <input type="search" id="nv-busca" placeholder="ex.: 966606 · 1098311 · Porto Alegre" autocomplete="off"></label>
    <div id="nv-res" class="resultados"><p class="muted pequeno">Digite pelo menos 3 caracteres. A busca olha os AIOs já cadastrados,
      a base do MCID (SACI/TransfereGov) e as listas da Caixa.</p></div>
    <div class="acoes-linha" style="margin-top:14px"><button class="lnk" id="nv-manual" type="button">Não achei: cadastrar manualmente</button></div>`);
  const inp = $('#nv-busca');
  inp.focus();
  $('#nv-manual').addEventListener('click', () => formulario({ origem: 'manual', contrato: { nr_instrumento: /^\d+$/.test(inp.value.trim()) ? inp.value.trim() : '' }, sugestao: {} }));
  let seq = 0;
  inp.addEventListener('input', debounce(async () => {
    const t = inp.value.trim();
    if (t.length < 3) return;
    const meu = ++seq;
    render('#nv-res', html`<p class="muted pequeno">Buscando…</p>`);
    try {
      const r = await E.api.buscar(t);
      if (meu === seq) mostrarResultados(r);
    } catch (e) { render('#nv-res', html`<p class="erro">${msgErro(e)}</p>`); }
  }, 300));
}

function mostrarResultados({ contratos, referencias, fila }) {
  const jaTem = new Set(contratos.map((c) => c.nr_instrumento).filter(Boolean));
  const refs = referencias.filter((r) => !jaTem.has(r.nr_instrumento));
  const filaL = fila.filter((f) => !f.contrato_id || !jaTem.has(f.nr_instrumento));
  if (!contratos.length && !refs.length && !filaL.length) {
    render('#nv-res', html`<p class="muted">Nada encontrado. Confira o número ou cadastre manualmente.</p>`);
    return;
  }
  render('#nv-res', html`
    ${contratos.length ? html`<div class="res-grupo"><h5>Já cadastrados no painel (novo AIO de outra etapa)</h5>
      ${contratos.map((c, i) => html`<button class="res" data-c="${i}" type="button"><span><b>${c.nr_instrumento || c.nr_operacao}</b> · ${c.municipio || ''}${c.uf ? `/${c.uf}` : ''}
        <span class="muted pequeno">${(c.descricao || c.proponente || '').slice(0, 90)}</span></span>
        <span class="pequeno">${c.aio.length} AIO${c.aio.length === 1 ? '' : 's'}: ${c.aio.map((a) => `etapa ${fmtEtapas(a.etapas)}`).join(', ')}</span></button>`)}</div>` : ''}
    ${filaL.length ? html`<div class="res-grupo"><h5>Nas listas da Caixa, ainda sem cadastro</h5>
      ${filaL.map((f, i) => html`<button class="res" data-f="${i}" type="button"><span><b>${f.nr_instrumento || f.nr_operacao}</b> · ${f.recebedor || ''}${f.uf ? `/${f.uf}` : ''}
        <span class="muted pequeno">${f.etapa_texto || ''}</span></span><span class="pequeno">${f.tabela} · ${fmtData(f.recebida_em)}</span></button>`)}</div>` : ''}
    ${refs.length ? html`<div class="res-grupo"><h5>Base do MCID (SACI · TransfereGov)</h5>
      ${refs.map((r, i) => html`<button class="res" data-r="${i}" type="button"><span><b>${r.nr_instrumento}</b> · ${r.municipio || ''}${r.uf ? `/${r.uf}` : ''}
        <span class="muted pequeno">${(r.objeto || r.proponente || '').slice(0, 90)}</span></span>
        <span class="pequeno">${r.fase_pac || ''} ${r.dt_emissao_aio_tgov ? `· AIO TGOV ${fmtData(r.dt_emissao_aio_tgov)}` : ''}</span></button>`)}</div>` : ''}`);
  $$('#nv-res [data-c]').forEach((b) => b.addEventListener('click', () => {
    const c = contratos[+b.dataset.c];
    formulario({ origem: 'contrato', contrato_id: c.id, contrato: c, sugestao: {} });
  }));
  $$('#nv-res [data-f]').forEach((b) => b.addEventListener('click', () => formulario(daFila(filaL[+b.dataset.f], referencias))));
  $$('#nv-res [data-r]').forEach((b) => b.addEventListener('click', () => formulario(daReferencia(refs[+b.dataset.r]))));
}

// ---------------------------------------------------------------------------
// Pré-preenchimento
// ---------------------------------------------------------------------------
function contratoDaLinha(a) {
  return { nr_instrumento: a.nr_instrumento, nr_operacao: a.nr_operacao, processo_sei: a.processo_sei, proponente: a.proponente,
    municipio: a.municipio, uf: a.uf, descricao: a.descricao, secretaria: a.secretaria, modalidade: a.modalidade, em_etapas: a.em_etapas };
}

function daReferencia(r) {
  return {
    origem: 'mcid',
    contrato: { nr_instrumento: r.nr_instrumento, nr_operacao: r.nr_operacao, nr_proposta: r.nr_proposta, processo_sei: r.processo_sei,
      proponente: r.proponente, municipio: r.municipio, uf: r.uf, descricao: r.objeto, secretaria: r.secretaria, modalidade: r.modalidade,
      fase_pac: r.fase_pac, cod_tci: r.cod_tci, tci: r.tci },
    sugestao: {
      tipo: r.dt_emissao_aio_tgov ? 'CONVALIDACAO' : 'EMISSAO',
      motivoTipo: r.dt_emissao_aio_tgov ? `AIO emitida no TransfereGov em ${fmtData(r.dt_emissao_aio_tgov)}` : 'Sem AIO emitida no TransfereGov',
      valor_solicitado: r.valor_repasse, dt_solicitacao_caixa: r.dt_aio_recebido_email,
    },
  };
}

function daFila(f, referencias = []) {
  const r = referencias.find((x) => x.nr_instrumento === f.nr_instrumento);
  const base = r ? daReferencia(r) : { contrato: {}, sugestao: {} };
  const conv = ['T1', 'T2', 'T5'].includes(f.tabela);
  return {
    origem: 'caixa',
    contrato_id: f.contrato_id || null,
    contrato: { ...base.contrato, nr_instrumento: f.nr_instrumento || base.contrato.nr_instrumento, nr_operacao: f.nr_operacao || base.contrato.nr_operacao,
      nr_proposta: f.nr_proposta || base.contrato.nr_proposta, proponente: base.contrato.proponente || f.recebedor, uf: base.contrato.uf || f.uf,
      em_etapas: f.etapa_num != null || base.contrato.em_etapas },
    sugestao: {
      ...base.sugestao,
      etapas: f.etapa_num != null ? [f.etapa_num] : [],
      etapa_descricao: f.etapa_texto,
      tipo: conv ? 'CONVALIDACAO' : base.sugestao.tipo || 'EMISSAO',
      motivoTipo: conv ? `Está na ${f.tabela} da Caixa (${fmtData(f.recebida_em)})` : base.sugestao.motivoTipo,
      valor_solicitado: f.valor ?? base.sugestao.valor_solicitado,
      dt_solicitacao_caixa: f.dt_envio || base.sugestao.dt_solicitacao_caixa,
    },
  };
}

// ---------------------------------------------------------------------------
// Passo 2: formulário
// ---------------------------------------------------------------------------
const CAMPOS_CONTRATO = [
  ['nr_instrumento', 'Nº do instrumento (TransfereGov)'], ['nr_operacao', 'Nº da operação (Caixa)'], ['processo_sei', 'Processo SEI'],
  ['proponente', 'Proponente'], ['municipio', 'Município'], ['uf', 'UF'], ['secretaria', 'Secretaria'], ['modalidade', 'Modalidade'],
];

function formulario(pre) {
  const existente = !!pre.contrato_id;
  const doContrato = existente ? E.aios.filter((a) => a.contrato_id === pre.contrato_id) : [];
  const c = doContrato.length ? { ...pre.contrato, ...contratoDaLinha(doContrato[0]) } : pre.contrato || {};
  const s = pre.sugestao || {};
  const princ = PRINCIPAIS();
  moldura(existente ? 'Novo AIO — outra etapa de contrato já cadastrado' : 'Novo AIO — conferir e cadastrar', html`
    <form id="nv-form">
      <section class="sec" style="margin-bottom:12px">
        <h4>Contrato <span class="muted pequeno">${{ contrato: 'já cadastrado', mcid: 'dados do SACI/TransfereGov', caixa: 'dados da lista da Caixa', manual: 'preenchimento manual' }[pre.origem]}</span></h4>
        ${existente ? html`<div class="kv">
            <div><span>Instrumento</span>${c.nr_instrumento || '—'}</div><div><span>Operação</span>${c.nr_operacao || '—'}</div>
            <div><span>Município</span>${c.municipio || '—'}${c.uf ? `/${c.uf}` : ''}</div><div><span>Proponente</span>${c.proponente || '—'}</div>
            <div style="grid-column:1/-1"><span>Objeto</span>${c.descricao || '—'}</div></div>
          ${doContrato.length ? html`<p class="pequeno" style="margin-top:10px">AIOs já cadastrados: ${doContrato.map((a) => html`<span style="margin-right:8px">etapa ${fmtEtapas(a.etapas)} ${pilulaMomento(a.momento)}</span>`)}</p>` : ''}`
        : html`<div class="grade">${CAMPOS_CONTRATO.map(([k, rot]) => html`<label class="campo"><span>${rot}</span><input type="text" name="c_${k}" value="${c[k] ?? ''}"></label>`)}
            <label class="campo" style="grid-column:1/-1"><span>Descrição do objeto</span><textarea name="c_descricao">${c.descricao || ''}</textarea></label></div>`}
      </section>
      <section class="sec">
        <h4>AIO</h4>
        <div class="grade">
          <label class="campo"><span>Etapa(s) — "Única" ou nº, ex. "2 e 4"</span><input type="text" name="etapas" value="${fmtEtapas(s.etapas || [])}" required></label>
          <label class="campo"><span>Tipo</span><select name="tipo">
            <option value="EMISSAO" ${s.tipo === 'EMISSAO' ? raw('selected') : ''}>Emissão de AIO</option>
            <option value="CONVALIDACAO" ${s.tipo === 'CONVALIDACAO' ? raw('selected') : ''}>Convalidação</option>
            <option value="" ${!s.tipo ? raw('selected') : ''}>Ainda não sei</option></select>
            ${s.motivoTipo ? html`<small class="muted">sugestão: ${s.motivoTipo}</small>` : ''}</label>
          <label class="campo"><span>Responsável</span><select name="responsavel">${E.perfis.filter((p) => p.ativo).map((p) => html`<option value="${p.email}" ${p.email.toLowerCase() === (E.usuario || '').toLowerCase() ? raw('selected') : ''}>${p.nome || p.email}</option>`)}</select></label>
          <label class="campo"><span>Valor solicitado (R$)</span><input type="number" step="0.01" min="0" name="valor_solicitado" value="${s.valor_solicitado ?? ''}"></label>
          <label class="campo"><span>Solicitação da Caixa</span><input type="date" name="dt_solicitacao_caixa" value="${s.dt_solicitacao_caixa ? String(s.dt_solicitacao_caixa).slice(0, 10) : ''}" max="${hojeISO()}"></label>
          ${existente ? html`<label class="campo"><span>Processo SEI (se diferente)</span><input type="text" name="processo_sei" value=""></label>` : ''}
          <label class="campo" style="grid-column:1/-1"><span>Descrição da etapa</span><input type="text" name="etapa_descricao" value="${s.etapa_descricao || ''}"></label>
          <label class="campo"><span>Momento inicial</span><select name="momento">
            <optgroup label="Fluxo">${princ.map((m) => html`<option value="${m.codigo}" ${m.codigo === 'RECEBIDO' ? raw('selected') : ''}>${m.nome}</option>`)}</optgroup>
            <optgroup label="Desvios">${DESVIOS().map((m) => html`<option value="${m.codigo}">${m.nome}</option>`)}</optgroup></select></label>
          <label class="campo"><span>Desde</span><input type="date" name="momento_desde" value="${hojeISO()}" max="${hojeISO()}" required></label>
          <label class="campo" style="grid-column:1/-1"><span id="nv-obs-rot">Observação (opcional)</span><input type="text" name="obs_momento" maxlength="500"></label>
        </div>
        <div id="nv-aviso"></div>
      </section>
      <div class="acoes-linha" style="margin-top:14px">
        <button class="btn grande" type="submit">Cadastrar AIO</button>
        <button class="btn sec" type="button" id="nv-voltar">Voltar à busca</button>
      </div>
      <div class="erro" id="nv-erro"></div>
    </form>`);

  const f = $('#nv-form');
  $('#nv-voltar').addEventListener('click', busca);
  const checar = () => {
    const desvio = E.mom[f.momento.value]?.is_desvio;
    $('#nv-obs-rot').textContent = desvio ? 'Observação (obrigatória para desvio)' : 'Observação (opcional)';
    f.obs_momento.required = !!desvio;
    const etapas = parseEtapas(f.etapas.value);
    const instr = existente ? c.nr_instrumento : f.c_nr_instrumento?.value.trim();
    const mesmos = existente ? doContrato : E.aios.filter((a) => instr && a.nr_instrumento === instr);
    const conflito = mesmos.filter((a) => !a.is_final && ((!a.etapas.length && !etapas.length) || a.etapas.some((e) => etapas.includes(e))));
    render('#nv-aviso', conflito.length
      ? html`<div class="aviso erro" style="margin-top:8px">Já existe AIO em andamento para esta etapa: ${conflito.map((a) => html`<button class="lnk" data-ir="${a.id}" type="button">etapa ${fmtEtapas(a.etapas)} (${E.mom[a.momento]?.nome})</button> `)}</div>`
      : !existente && mesmos.length ? html`<div class="aviso" style="margin-top:8px">Este instrumento já tem ${mesmos.length} AIO(s) cadastrado(s); o novo entra no mesmo contrato.</div>` : '');
    $$('#nv-aviso [data-ir]').forEach((b) => b.addEventListener('click', () => { fechar(); abrirDetalhe(+b.dataset.ir); }));
  };
  f.addEventListener('input', checar); f.addEventListener('change', checar); checar();

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; $('#nv-erro').textContent = '';
    const val = (n) => (f.elements[n]?.value ?? '').trim() || null;
    const etapas = parseEtapas(f.etapas.value);
    const contrato = existente ? {} : Object.fromEntries([...CAMPOS_CONTRATO.map(([k]) => [k, val(`c_${k}`)]), ['descricao', val('c_descricao')],
      ['nr_proposta', c.nr_proposta || null], ['fase_pac', c.fase_pac || null], ['cod_tci', c.cod_tci || null], ['tci', c.tci || null],
      ['em_etapas', etapas.length > 0 || !!c.em_etapas]]);
    if (!existente && !contrato.nr_instrumento && !contrato.nr_operacao) {
      $('#nv-erro').textContent = 'Informe o nº do instrumento ou da operação.'; btn.disabled = false; return;
    }
    const payload = {
      contrato_id: pre.contrato_id || null,
      contrato,
      aio: {
        etapas, etapa_descricao: val('etapa_descricao'), tipo: val('tipo'), momento: f.momento.value, momento_desde: f.momento_desde.value,
        responsavel: val('responsavel'), valor_solicitado: f.valor_solicitado.value === '' ? null : +f.valor_solicitado.value,
        dt_solicitacao_caixa: val('dt_solicitacao_caixa'), processo_sei: val('processo_sei'),
        dt_entrada_cgpac: f.momento.value === 'RECEBIDO' ? f.momento_desde.value : null,
      },
      obs_momento: val('obs_momento'),
    };
    try {
      const id = await E.api.criarAio(payload);
      fechar();
      toast(`AIO cadastrado para ${nomePessoa(payload.aio.responsavel)}.`, 'ok');
      await E.recarregar();
      abrirDetalhe(id);
    } catch (e) { $('#nv-erro').textContent = msgErro(e); btn.disabled = false; }
  });
}

