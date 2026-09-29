// Gaveta de detalhe do AIO: momento (com histórico), edição com trava otimista,
// contrato, listas da Caixa, dados do MCID e etapas do mesmo contrato.
import { E, DESVIOS, PRINCIPAIS, nomePessoa, pilulaMomento, tagTipo } from './estado.js';
import { $, $$, copiar, fmtBRL, fmtData, fmtDataHora, fmtEtapas, hojeISO, html, msgErro, parseEtapas, raw, render, toast } from './util.js';

let atual = null;      // id do AIO aberto
let sujo = false;      // formulário com alteração não salva
let versaoVista = null;

export const detalheAberto = () => atual;

const CAMPOS_AIO = [
  { k: 'tipo', rot: 'Tipo', t: 'sel', ops: [['', '—'], ['EMISSAO', 'Emissão'], ['CONVALIDACAO', 'Convalidação']] },
  { k: 'etapas', rot: 'Etapa(s) — "Única" ou "2 e 4"', t: 'etapas' },
  { k: 'responsavel', rot: 'Responsável', t: 'pessoa' },
  { k: 'processo_sei', rot: 'Processo SEI', t: 'txt' },
  { k: 'valor_solicitado', rot: 'Valor solicitado (R$)', t: 'num' },
  { k: 'referencia_solicitacao', rot: 'Referência da solicitação', t: 'txt' },
  { k: 'dt_solicitacao_caixa', rot: 'Solicitação da Caixa', t: 'data' },
  { k: 'dt_entrada_cgpac', rot: 'Entrada na CGPAC', t: 'data' },
  { k: 'dt_saida_cgpac', rot: 'Saída da CGPAC', t: 'data' },
  { k: 'dt_assinatura', rot: 'Assinatura', t: 'data' },
  { k: 'dt_conclusao', rot: 'Conclusão (AIO concedida)', t: 'data' },
  { k: 'localizacao_sei', rot: 'Localização no SEI', t: 'txt' },
  { k: 'status_sei', rot: 'Status no SEI', t: 'txt' },
  { k: 'os_emitida', rot: 'O.S. emitida até 03/07/2026', t: 'bool' },
  { k: 'tgov', rot: 'No TransfereGov', t: 'bool' },
  { k: 'aio_automatica_tgov', rot: 'AIO automática no TGOV', t: 'bool' },
  { k: 'aio_automatica_caixa', rot: 'AIO automática na Caixa', t: 'bool' },
  { k: 'problemas', rot: 'Tem problema', t: 'bool' },
  { k: 'etapa_descricao', rot: 'Descrição da etapa', t: 'txt', largo: true },
  { k: 'ressalvas', rot: 'Ressalvas e/ou pendências', t: 'area', largo: true },
  { k: 'obs', rot: 'Observações', t: 'area', largo: true },
];
const CAMPOS_CONTRATO = [
  { k: 'processo_sei', rot: 'Processo SEI', t: 'txt' },
  { k: 'proponente', rot: 'Proponente', t: 'txt' },
  { k: 'municipio', rot: 'Município', t: 'txt' },
  { k: 'uf', rot: 'UF', t: 'txt' },
  { k: 'secretaria', rot: 'Secretaria', t: 'txt' },
  { k: 'modalidade', rot: 'Modalidade', t: 'txt' },
  { k: 'fase_pac', rot: 'Fase do PAC', t: 'txt' },
  { k: 'em_etapas', rot: 'Contrato executado em etapas', t: 'bool' },
  { k: 'descricao', rot: 'Descrição do objeto', t: 'area', largo: true },
];

function campo(c, v) {
  const nome = `name="${c.k}"`;
  const val = v ?? '';
  let inp;
  if (c.t === 'sel') inp = html`<select ${raw(nome)}>${c.ops.map(([o, r]) => html`<option value="${o}" ${o === (v ?? '') ? raw('selected') : ''}>${r}</option>`)}</select>`;
  else if (c.t === 'bool') inp = html`<select ${raw(nome)}><option value="">—</option><option value="true" ${v === true ? raw('selected') : ''}>Sim</option><option value="false" ${v === false ? raw('selected') : ''}>Não</option></select>`;
  else if (c.t === 'pessoa') {
    const lista = [...E.perfis.filter((p) => p.ativo)];
    if (v && !lista.some((p) => p.email === v)) lista.push({ email: v, nome: nomePessoa(v) });
    inp = html`<select ${raw(nome)}><option value="">—</option>${lista.map((p) => html`<option value="${p.email}" ${p.email === v ? raw('selected') : ''}>${p.nome || p.email}</option>`)}</select>`;
  } else if (c.t === 'area') inp = html`<textarea ${raw(nome)}>${val}</textarea>`;
  else if (c.t === 'data') inp = html`<input type="date" ${raw(nome)} value="${val ? String(val).slice(0, 10) : ''}" max="${hojeISO()}">`;
  else if (c.t === 'num') inp = html`<input type="number" step="0.01" min="0" ${raw(nome)} value="${val}">`;
  else if (c.t === 'etapas') inp = html`<input type="text" ${raw(nome)} value="${fmtEtapas(v)}">`;
  else inp = html`<input type="text" ${raw(nome)} value="${val}">`;
  return html`<label class="campo" ${c.largo ? raw('style="grid-column:1/-1"') : ''}><span>${c.rot}</span>${inp}</label>`;
}

function lerForm(form, campos) {
  const out = {};
  campos.forEach((c) => {
    const el = form.elements[c.k];
    if (!el) return;
    let v = el.value.trim();
    if (c.t === 'bool') v = v === '' ? null : v === 'true';
    else if (c.t === 'num') v = v === '' ? null : +v;
    else if (c.t === 'etapas') v = parseEtapas(v);
    else if (v === '') v = null;
    out[c.k] = v;
  });
  return out;
}
const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------------------

export function abrirDetalhe(id) {
  atual = id; sujo = false;
  const u = new URL(location.href); u.searchParams.set('aio', id); history.replaceState(null, '', u);
  desenhar();
}

function fechar() {
  if (sujo) {
    const b = $('#gav-aviso-fechar');
    if (b && b.classList.contains('oculto')) { b.classList.remove('oculto'); return; }
  }
  atual = null; sujo = false;
  const u = new URL(location.href); u.searchParams.delete('aio'); history.replaceState(null, '', u);
  render('#gaveta-raiz', '');
}

/** Chamado depois de cada recarga (inclusive pelo tempo real). */
export function atualizarDetalhe() {
  if (!atual) return;
  const a = E.aios.find((x) => x.id === atual);
  if (!a) { toast('Este AIO não está mais disponível.'); fechar(); return; }
  if (a.versao === versaoVista) return;
  if (sujo) { $('#gav-conflito')?.classList.remove('oculto'); return; }
  desenhar();
}

async function desenhar() {
  const a = E.aios.find((x) => x.id === atual);
  if (!a) { toast('AIO não encontrado.', 'erro'); return; }
  versaoVista = a.versao;
  const irmaos = E.aios.filter((x) => x.contrato_id === a.contrato_id && x.id !== a.id);
  render('#gaveta-raiz', html`<div class="veu" data-fechar></div>
  <aside class="gaveta" role="dialog" aria-label="Detalhe do AIO">
    <div class="gav-cab">
      <div class="linha1">
        <div>
          <h2>${a.nr_instrumento || a.nr_operacao || 'Sem nº'} ${a.etapas?.length ? `· Etapa ${fmtEtapas(a.etapas)}` : '· Etapa única'}</h2>
          <div class="sub">${a.municipio || '—'}${a.uf ? `/${a.uf}` : ''} · ${a.proponente || ''}</div>
          <div class="acoes-linha" style="margin-top:6px">
            ${tagTipo(a.tipo)}
            ${a.em_etapas ? html`<span class="tag etp">Contrato em etapas</span>` : ''}
            ${a.link_saci ? html`<a class="saci" href="${a.link_saci}" target="_blank" rel="noopener">SACI ↗</a>` : ''}
            ${a.nr_instrumento ? html`<button class="lnk pequeno" data-copiar="${a.nr_instrumento}" type="button">copiar instrumento</button>` : ''}
            ${a.processo_sei ? html`<button class="lnk pequeno" data-copiar="${a.processo_sei}" type="button">copiar SEI ${a.processo_sei}</button>` : ''}
          </div>
        </div>
        <button class="fechar" data-fechar type="button" aria-label="Fechar">×</button>
      </div>
      <div id="gav-conflito" class="aviso erro oculto" style="margin-top:8px">Outra pessoa alterou este AIO enquanto você editava.
        <button class="lnk" id="gav-recarregar" type="button">Descartar minhas alterações e recarregar</button></div>
      <div id="gav-aviso-fechar" class="aviso oculto" style="margin-top:8px">Há alterações não salvas.
        <button class="lnk" id="gav-descartar" type="button">Fechar sem salvar</button></div>
    </div>
    <div class="gav-corpo">
      <section class="sec" id="sec-momento"></section>
      <section class="sec">
        <h4>Dados do AIO <span class="muted pequeno">versão ${a.versao} · alterado por ${nomePessoa(a.updated_by)} em ${fmtDataHora(a.updated_at)}</span></h4>
        <form id="form-aio"><div class="grade">${CAMPOS_AIO.map((c) => campo(c, a[c.k]))}</div>
          <div class="acoes-linha"><button class="btn" type="submit" id="btn-salvar" disabled>Salvar alterações</button>
          <span class="muted pequeno" id="salvar-info"></span></div></form>
      </section>
      <section class="sec"><h4>Na Caixa</h4><div id="det-caixa"><p class="muted pequeno">Carregando…</p></div></section>
      <section class="sec"><h4>Dados do MCID (SACI · TransfereGov) <span class="muted pequeno">${a.ref_atualizado_em ? `atualizado em ${fmtDataHora(a.ref_atualizado_em)}` : ''}</span></h4>
        <div class="kv">
          <div><span>TCI</span>${a.tci || a.cod_tci || '—'}</div>
          <div><span>Operação Caixa</span>${a.nr_operacao || '—'}</div>
          <div><span>No TransfereGov</span>${a.ref_tgov === true ? 'Sim' : a.ref_tgov === false ? 'Não' : '—'}</div>
          <div><span>AIO no TGOV</span>${a.situacao_aio_tgov || '—'} ${a.dt_emissao_aio_tgov ? `(${fmtData(a.dt_emissao_aio_tgov)})` : ''}</div>
          <div><span>Execução física</span>${a.exec_fisica_pct != null ? `${(+a.exec_fisica_pct).toLocaleString('pt-BR')} %` : '—'}</div>
          <div><span>Saldo em conta</span>${fmtBRL(a.saldo_conta, true)}</div>
          <div><span>Último desbloqueio</span>${fmtData(a.dt_ultimo_desbloqueio)}</div>
          <div><span>E-mail GEPAC07 recebido</span>${fmtData(a.dt_aio_recebido_email)}</div>
          <div><span>Valor de repasse</span>${fmtBRL(a.ref_valor_repasse)}</div>
        </div>
      </section>
      <section class="sec">
        <h4>Contrato ${irmaos.length ? html`<span class="tag etp">${irmaos.length + 1} AIOs neste contrato</span>` : ''}</h4>
        ${irmaos.length ? html`<div style="margin-bottom:12px">${irmaos.sort((x, y) => (x.etapas[0] ?? 0) - (y.etapas[0] ?? 0)).map((x) => html`
          <button class="res" data-ir="${x.id}" type="button"><span><b>Etapa ${fmtEtapas(x.etapas)}</b> · ${x.tipo === 'EMISSAO' ? 'Emissão' : x.tipo === 'CONVALIDACAO' ? 'Convalidação' : ''} · ${fmtBRL(x.valor_solicitado)}</span>${pilulaMomento(x.momento)}</button>`)}</div>` : ''}
        <form id="form-contrato"><div class="grade">${CAMPOS_CONTRATO.map((c) => campo(c, a[c.k]))}</div>
          <button class="btn sec" type="submit" id="btn-salvar-contrato" disabled>Salvar contrato</button></form>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn sec" type="button" id="btn-nova-etapa">+ Novo AIO para outra etapa deste contrato</button></div>
      </section>
      <section class="sec"><h4>Histórico</h4><div id="det-hist"><p class="muted pequeno">Carregando…</p></div></section>
      ${E.admin ? html`<section class="sec"><h4>Administração</h4>
        <div class="acoes-linha"><button class="btn perigo" id="btn-excluir" type="button">Excluir este AIO</button>
        <span id="excluir-conf" class="oculto">Tem certeza? O AIO some do painel (fica no histórico).
          <button class="btn perigo" id="btn-excluir-sim" type="button">Sim, excluir</button></span></div></section>` : ''}
    </div>
  </aside>`);

  $$('#gaveta-raiz [data-fechar]').forEach((b) => b.addEventListener('click', fechar));
  $$('#gaveta-raiz [data-copiar]').forEach((b) => b.addEventListener('click', () => copiar(b.dataset.copiar)));
  $$('#gaveta-raiz [data-ir]').forEach((b) => b.addEventListener('click', () => abrirDetalhe(+b.dataset.ir)));
  $('#gav-recarregar').addEventListener('click', () => { sujo = false; desenhar(); });
  $('#gav-descartar').addEventListener('click', () => { sujo = false; fechar(); });
  $('#btn-nova-etapa').addEventListener('click', () => E.novoAio({ contratoDe: a }));
  document.onkeydown = (e) => { if (e.key === 'Escape' && atual && !$('#modal-raiz').innerHTML) fechar(); };

  // edição do AIO
  const f = $('#form-aio');
  f.addEventListener('input', () => {
    const mud = lerForm(f, CAMPOS_AIO);
    const n = Object.keys(mud).filter((k) => !igual(mud[k], a[k])).length;
    sujo = n > 0;
    $('#btn-salvar').disabled = !sujo;
    $('#salvar-info').textContent = sujo ? `${n} campo${n > 1 ? 's' : ''} alterado${n > 1 ? 's' : ''}` : '';
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const mud = lerForm(f, CAMPOS_AIO);
    const campos = Object.fromEntries(Object.entries(mud).filter(([k, v]) => !igual(v, a[k])));
    if (!Object.keys(campos).length) return;
    $('#btn-salvar').disabled = true;
    try {
      await E.api.salvarAio(a.id, a.versao, campos);
      sujo = false; toast('AIO salvo.', 'ok');
      await E.recarregar(); desenhar();
    } catch (e) { toast(msgErro(e), 'erro'); $('#btn-salvar').disabled = false; }
  });

  // edição do contrato
  const fc = $('#form-contrato');
  fc.addEventListener('input', () => {
    const mud = lerForm(fc, CAMPOS_CONTRATO);
    $('#btn-salvar-contrato').disabled = !Object.keys(mud).some((k) => !igual(mud[k], a[k]));
  });
  fc.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const mud = lerForm(fc, CAMPOS_CONTRATO);
    const campos = Object.fromEntries(Object.entries(mud).filter(([k, v]) => !igual(v, a[k])));
    try { await E.api.salvarContrato(a.contrato_id, campos); toast('Contrato salvo.', 'ok'); await E.recarregar(); desenhar(); }
    catch (e) { toast(msgErro(e), 'erro'); }
  });

  if (E.admin) {
    $('#btn-excluir').addEventListener('click', () => $('#excluir-conf').classList.remove('oculto'));
    $('#btn-excluir-sim').addEventListener('click', async () => {
      try { await E.api.excluirAio(a.id, a.versao); toast('AIO excluído.'); atual = null; render('#gaveta-raiz', ''); await E.recarregar(); }
      catch (e) { toast(msgErro(e), 'erro'); }
    });
  }

  const [hist, itens] = await Promise.all([
    E.api.historico(a.id).catch(() => []),
    E.api.caixaDoContrato(a.contrato_id).catch(() => []),
  ]);
  if (atual !== a.id) return;
  desenharMomento(a, hist);
  desenharHistorico(hist);
  desenharCaixa(a, itens);
}

function desenharMomento(a, hist) {
  const princ = PRINCIPAIS();
  // no desvio, a trilha mostra o último momento do fluxo principal por onde o AIO passou
  let ref = a.momento;
  if (a.is_desvio) {
    const ult = hist.find((h) => h.momento_para && !E.mom[h.momento_para]?.is_desvio);
    ref = ult?.momento_para || (hist.find((h) => h.momento_de && !E.mom[h.momento_de]?.is_desvio)?.momento_de) || princ[0].codigo;
  }
  const idx = princ.findIndex((m) => m.codigo === ref);
  const prox = !a.is_desvio && idx >= 0 && idx < princ.length - 1 ? princ[idx + 1] : null;
  render('#sec-momento', html`
    <h4>Momento ${pilulaMomento(a.momento)}</h4>
    ${a.is_desvio ? html`<div class="aviso desvio-atual">Em desvio há ${a.dias_no_momento} dias (desde ${fmtData(a.momento_desde)}). A trilha mostra onde o AIO estava no fluxo.</div>` : ''}
    <div class="passos">${princ.map((m, i) => {
      const cls = i < idx || (i === idx && m.is_final) ? 'feito' : i === idx ? `atual ${a.atrasado ? 'atr' : ''}` : '';
      return html`<div class="passo ${cls}"><div class="bola">${i < idx || (i === idx && m.is_final) ? '✓' : i + 1}</div><div class="nm">${m.nome}</div></div>`;
    })}</div>
    <p class="pequeno muted" style="margin-bottom:10px">Neste momento desde <b>${fmtData(a.momento_desde)}</b>${a.is_final ? '' : html` · há <b class="${a.atrasado ? 'erro' : ''}">${a.dias_no_momento} dias</b>${a.sla_dias ? ` (prazo ${a.sla_dias} dias)` : ''}`}</p>
    <form id="form-momento" class="grade" style="align-items:end">
      <label class="campo"><span>Novo momento</span><select name="momento">
        <optgroup label="Fluxo">${princ.map((m) => html`<option value="${m.codigo}" ${m.codigo === (prox?.codigo || a.momento) ? raw('selected') : ''}>${m.nome}</option>`)}</optgroup>
        <optgroup label="Desvios">${DESVIOS().map((m) => html`<option value="${m.codigo}">${m.nome}</option>`)}</optgroup></select></label>
      <label class="campo"><span>Data</span><input type="date" name="data" value="${hojeISO()}" max="${hojeISO()}" required></label>
      <label class="campo" style="grid-column:1/-1"><span id="obs-rot">Observação (opcional)</span><input type="text" name="obs" maxlength="500" placeholder="ex.: nº do documento SEI, motivo da pendência…"></label>
      <div class="acoes-linha" style="grid-column:1/-1"><button class="btn" type="submit">Registrar momento</button>
        ${prox ? html`<span class="muted pequeno">sugestão: próximo passo do fluxo</span>` : ''}</div>
    </form>`);
  const fm = $('#form-momento');
  const ajustaObs = () => {
    const desvio = E.mom[fm.momento.value]?.is_desvio;
    $('#obs-rot').textContent = desvio ? 'Observação (obrigatória para desvio)' : 'Observação (opcional)';
    fm.obs.required = !!desvio;
  };
  fm.momento.addEventListener('change', ajustaObs); ajustaObs();
  fm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = fm.querySelector('button'); btn.disabled = true;
    try {
      await E.api.mudarMomento(a.id, fm.momento.value, fm.data.value, fm.obs.value.trim(), a.versao);
      toast(`Momento registrado: ${E.mom[fm.momento.value].nome}`, 'ok');
      sujo = false; await E.recarregar(); desenhar();
    } catch (e) { toast(msgErro(e), 'erro'); btn.disabled = false; }
  });
}

const ROT_CAMPO = Object.fromEntries([...CAMPOS_AIO, ...CAMPOS_CONTRATO].map((c) => [c.k, c.rot.split(' — ')[0]]));
function fmtValorDiff(v) {
  if (v === null || v === undefined || v === '') return '∅';
  if (Array.isArray(v)) return fmtEtapas(v);
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return fmtData(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
function desenharHistorico(hist) {
  if (!hist.length) { render('#det-hist', html`<p class="muted pequeno">Sem registros.</p>`); return; }
  render('#det-hist', html`<ul class="hist">${hist.map((h) => html`<li class="${h.acao}">
    <div class="quando">${fmtDataHora(h.em)} · ${nomePessoa(h.por)}</div>
    ${h.acao === 'criado' ? html`<div>Cadastrado em ${pilulaMomento(h.momento_para)} <span class="muted pequeno">(${fmtData(h.data_momento)})</span></div>` : ''}
    ${h.acao === 'momento' ? html`<div>${h.momento_de ? html`${pilulaMomento(h.momento_de)} → ` : ''}${pilulaMomento(h.momento_para)} <span class="muted pequeno">em ${fmtData(h.data_momento)}</span></div>` : ''}
    ${h.acao === 'edicao' ? html`<div>Editou ${Object.keys(h.diff || {}).map((k) => ROT_CAMPO[k] || k).join(', ')}</div>
      <div class="diff">${Object.entries(h.diff || {}).map(([k, [de, para]]) => html`<div>${ROT_CAMPO[k] || k}: ${fmtValorDiff(de)} → ${fmtValorDiff(para)}</div>`)}</div>` : ''}
    ${h.acao === 'excluido' ? html`<div>Excluiu o AIO</div>` : ''}
    ${h.acao === 'restaurado' ? html`<div>Restaurou o AIO</div>` : ''}
    ${h.obs ? html`<div class="diff">“${h.obs}”</div>` : ''}
  </li>`)}</ul>`);
}

function desenharCaixa(a, itens) {
  const doAio = itens.filter((i) => i.etapa_num == null || !a.etapas?.length || a.etapas.includes(i.etapa_num));
  if (!doAio.length) {
    render('#det-caixa', html`<p class="pequeno">Este instrumento <b>não aparece</b> em nenhuma lista da Caixa importada no painel.</p>`);
    return;
  }
  render('#det-caixa', html`
    <p class="pequeno" style="margin-bottom:8px">${a.presente_convalidacao
      ? html`<span class="tag conv">Na lista de convalidação</span>` : html`<span class="tag lst">Só em lista que não é de convalidação</span>`}</p>
    <div class="tab-scroll"><table class="tab"><thead><tr><th>Lista</th><th>E-mail</th><th>Etapa</th><th>Situação / observações</th><th>Passou CGPAC</th></tr></thead><tbody>
    ${doAio.map((i) => html`<tr><td><b>${i.caixa_lista?.tabela}</b> ${i.caixa_lista?.convalidacao ? html`<span class="tag conv">conv.</span>` : ''}<div class="muted pequeno">${i.caixa_lista?.titulo || ''}</div></td>
      <td class="num">${fmtData(i.caixa_lista?.recebida_em)}</td><td>${i.etapa_texto || '—'}</td>
      <td>${i.situacao || ''}${i.obs_mcid ? html`<div class="muted pequeno">${i.obs_mcid}</div>` : ''}${i.dt_autorizacao ? html`<div class="pequeno">Autorização: ${fmtData(i.dt_autorizacao)}</div>` : ''}</td>
      <td>${i.passou_cgpac || '—'}</td></tr>`)}</tbody></table></div>`);
}
