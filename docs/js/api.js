// Camada de dados. Duas implementações com a mesma interface:
//  - supabase: o painel de verdade (login, leitura/gravação, tempo real)
//  - mock (?mock=1): pré-visualização local com seed/mock.json, alterações só na memória
import { CONFIG } from './config.js';
import { diasEntre, hojeISO, norm } from './util.js';

export async function criarApi() {
  const q = new URLSearchParams(location.search);
  return q.has('mock') ? criarMock(q.get('mock')) : criarSupabase();
}

const limpaTermo = (t) => norm(t).replace(/[%,()*\\]/g, ' ').split(/\s+/).filter(Boolean);

// =============================================================================
// Supabase
// =============================================================================
async function criarSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('SEU-PROJETO')) {
    throw new Error('Painel ainda não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY em docs/js/config.js.');
  }
  const { createClient } = await import(CONFIG.SUPABASE_JS);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  let canal = null;

  return {
    modo: 'supabase',
    async sessao() { const { data } = await sb.auth.getSession(); return data.session?.user?.email || null; },
    async entrar(email, senha) { ok(await sb.auth.signInWithPassword({ email: email.trim(), password: senha })); },
    async sair() { if (canal) sb.removeChannel(canal); await sb.auth.signOut(); },
    async trocarSenha(nova) { ok(await sb.auth.updateUser({ password: nova })); },

    async carregar() {
      const [momentos, perfis, aios, sync] = await Promise.all([
        sb.from('momento').select('*').order('ordem').then(ok),
        sb.from('perfil').select('*').order('nome').then(ok),
        sb.from('v_aio_painel').select('*').order('id').limit(5000).then(ok),
        sb.from('sync_log').select('*').order('em', { ascending: false }).limit(20).then(ok),
      ]);
      return { momentos, perfis, aios, sync };
    },
    historico: (aioId) => sb.from('aio_historico').select('*').eq('aio_id', aioId).order('em', { ascending: false }).then(ok),
    caixaDoContrato: (contratoId) => sb.from('caixa_lista_item')
      .select('*, caixa_lista(tabela, recebida_em, convalidacao, titulo)').eq('contrato_id', contratoId).order('id').then(ok),
    atividade: (lim = 150) => sb.from('v_atividade').select('*').order('em', { ascending: false }).limit(lim).then(ok),
    listas: () => sb.from('v_caixa_listas').select('*').order('recebida_em', { ascending: false }).order('tabela').then(ok),
    fila: () => sb.from('v_caixa_sem_cadastro').select('*').order('recebida_em', { ascending: false }).limit(1000).then(ok),
    contratosChaves: () => sb.from('contrato').select('id, nr_instrumento, nr_operacao').limit(10000).then(ok),

    async buscar(termo) {
      const palavras = limpaTermo(termo);
      if (!palavras.length) return { contratos: [], referencias: [], fila: [] };
      let qc = sb.from('contrato').select('*, aio(id, etapas, momento, excluido_em)').limit(15);
      let qr = sb.from('referencia').select('*').limit(15);
      palavras.forEach((p) => { qc = qc.ilike('busca', `%${p}%`); qr = qr.ilike('busca', `%${p}%`); });
      const p0 = palavras[0];
      const qf = sb.from('v_caixa_sem_cadastro').select('*').limit(15)
        .or(`nr_instrumento.ilike.*${p0}*,nr_operacao.ilike.*${p0}*,recebedor.ilike.*${p0}*`);
      const [contratos, referencias, fila] = await Promise.all([qc.then(ok), qr.then(ok), qf.then(ok)]);
      contratos.forEach((c) => { c.aio = (c.aio || []).filter((a) => !a.excluido_em); });
      return { contratos, referencias, fila };
    },

    criarAio: (payload) => sb.rpc('criar_aio', { p: payload }).then(ok),
    mudarMomento: (id, momento, data, obs, versao) =>
      sb.rpc('mudar_momento', { p_aio: id, p_momento: momento, p_data: data, p_obs: obs || null, p_versao: versao }).then(ok),
    async salvarAio(id, versao, campos) {
      const r = ok(await sb.from('aio').update(campos).eq('id', id).eq('versao', versao).select('id'));
      if (!r.length) throw new Error('Este AIO foi alterado por outra pessoa. Recarregue e tente de novo.');
    },
    async salvarContrato(id, campos) { ok(await sb.from('contrato').update(campos).eq('id', id).select('id')); },
    async excluirAio(id, versao) { return this.salvarAio(id, versao, { excluido_em: new Date().toISOString() }); },
    importarLista: (payload) => sb.rpc('importar_lista_caixa', { p: payload }).then(ok),

    ouvir(aoMudar, aoStatus) {
      canal = sb.channel('painelaio')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'aio' }, (e) => aoMudar('aio', e))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'contrato' }, (e) => aoMudar('contrato', e))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'caixa_lista' }, (e) => aoMudar('caixa_lista', e))
        .subscribe((status) => aoStatus(status === 'SUBSCRIBED'));
    },
  };
}

// =============================================================================
// Mock (pré-visualização local, sem backend)
// =============================================================================
async function criarMock(arquivo) {
  const url = arquivo && arquivo !== '1' ? arquivo : '../seed/mock.json';
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Modo prévia: não achei ${url}. Rode python/05_gerar_mock.py.`);
  const db = await resp.json();
  const eu = 'previa@local';
  if (!db.perfis.some((p) => p.email === eu)) db.perfis.push({ email: eu, login: 'previa', nome: 'Você (prévia)', papel: 'admin', ativo: true });
  const momMap = () => Object.fromEntries(db.momentos.map((m) => [m.codigo, m]));
  let proxId = Math.max(0, ...db.aios.map((a) => a.id)) + 1;
  let proxHist = Math.max(0, ...db.historico.map((h) => h.id)) + 1;

  function recalc(a) {
    const m = momMap()[a.momento];
    Object.assign(a, {
      momento_nome: m.nome, momento_ordem: m.ordem, momento_cor: m.cor, is_desvio: m.is_desvio,
      is_final: m.is_final, sla_dias: m.sla_dias, dias_no_momento: diasEntre(a.momento_desde),
    });
    a.atrasado = !m.is_final && m.sla_dias != null && a.dias_no_momento > m.sla_dias;
    return a;
  }
  const hist = (aio_id, acao, extra = {}) =>
    db.historico.unshift({ id: proxHist++, aio_id, em: new Date().toISOString(), por: eu, acao, ...extra });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const casa = (texto, palavras) => palavras.every((p) => norm(texto).includes(p));

  return {
    modo: 'mock',
    async sessao() { return eu; },
    async entrar() {}, async sair() { location.href = location.pathname; }, async trocarSenha() {},
    async carregar() {
      db.aios.forEach(recalc);
      return clone({ momentos: db.momentos, perfis: db.perfis, aios: db.aios.filter((a) => !a.excluido_em), sync: db.sync || [] });
    },
    async historico(id) { return clone(db.historico.filter((h) => h.aio_id === id)); },
    async caixaDoContrato(cid) { return clone(db.itens.filter((i) => i.contrato_id === cid)); },
    async atividade() {
      return clone(db.historico.slice(0, 150).map((h) => {
        const a = db.aios.find((x) => x.id === h.aio_id) || {};
        return { ...h, contrato_id: a.contrato_id, etapas: a.etapas, nr_instrumento: a.nr_instrumento, municipio: a.municipio, uf: a.uf };
      }));
    },
    async listas() { return clone(db.listas); },
    async fila() { return clone(db.fila); },
    async contratosChaves() {
      const vistos = new Map();
      db.aios.forEach((a) => vistos.set(a.contrato_id, { id: a.contrato_id, nr_instrumento: a.nr_instrumento, nr_operacao: a.nr_operacao }));
      return [...vistos.values()];
    },
    async buscar(termo) {
      const p = limpaTermo(termo);
      const porContrato = new Map();
      db.aios.filter((a) => casa([a.nr_instrumento, a.nr_operacao, a.processo_sei, a.proponente, a.municipio, a.uf, a.descricao].join(' '), p))
        .forEach((a) => {
          const c = porContrato.get(a.contrato_id) || { id: a.contrato_id, nr_instrumento: a.nr_instrumento, nr_operacao: a.nr_operacao,
            processo_sei: a.processo_sei, proponente: a.proponente, municipio: a.municipio, uf: a.uf, descricao: a.descricao,
            secretaria: a.secretaria, modalidade: a.modalidade, em_etapas: a.em_etapas, aio: [] };
          c.aio.push({ id: a.id, etapas: a.etapas, momento: a.momento });
          porContrato.set(a.contrato_id, c);
        });
      const referencias = db.referencias.filter((r) => casa([r.nr_instrumento, r.nr_operacao, r.proponente, r.municipio, r.uf, r.objeto, r.cod_tci].join(' '), p)).slice(0, 15);
      const fila = db.fila.filter((f) => casa([f.nr_instrumento, f.nr_operacao, f.recebedor].join(' '), p.slice(0, 1))).slice(0, 15);
      return clone({ contratos: [...porContrato.values()].slice(0, 15), referencias, fila });
    },
    async criarAio(p) {
      const c = p.contrato || {};
      const base = db.aios.find((a) => (p.contrato_id && a.contrato_id === p.contrato_id) || (c.nr_instrumento && a.nr_instrumento === c.nr_instrumento));
      const cid = base ? base.contrato_id : 100000 + proxId;
      const a = p.aio || {};
      const novo = {
        ...(base ? { nr_instrumento: base.nr_instrumento, nr_operacao: base.nr_operacao, proponente: base.proponente, municipio: base.municipio,
          uf: base.uf, descricao: base.descricao, secretaria: base.secretaria, modalidade: base.modalidade, em_etapas: base.em_etapas || (a.etapas || []).length > 0,
          cod_tci: base.cod_tci, link_saci: base.link_saci } : { ...c, em_etapas: !!c.em_etapas || (a.etapas || []).length > 0 }),
        ...a, id: proxId++, contrato_id: cid, etapas: a.etapas || [], momento: a.momento || 'SOLICITADO',
        momento_desde: a.momento_desde || hojeISO(), responsavel: a.responsavel || eu, versao: 1,
        presente_caixa: false, presente_convalidacao: false, created_by: eu, updated_by: eu,
      };
      db.aios.push(recalc(novo));
      if (novo.em_etapas) db.aios.filter((x) => x.contrato_id === cid).forEach((x) => { x.em_etapas = true; });
      hist(novo.id, 'criado', { momento_para: novo.momento, data_momento: novo.momento_desde, obs: p.obs_momento || null });
      return novo.id;
    },
    async mudarMomento(id, momento, data, obs, versao) {
      const a = db.aios.find((x) => x.id === id);
      if (a.versao !== versao) throw new Error('Este AIO foi alterado por outra pessoa. Recarregue e tente de novo.');
      if (momMap()[momento].is_desvio && !obs) throw new Error(`Informe uma observação para o momento "${momMap()[momento].nome}".`);
      if (data > hojeISO()) throw new Error('A data do momento não pode ser futura.');
      hist(id, 'momento', { momento_de: a.momento, momento_para: momento, data_momento: data, obs });
      const marco = { RECEBIDO: 'dt_entrada_cgpac', TRAMITADO_GABSE: 'dt_saida_cgpac', DEVOLVIDO_SF: 'dt_saida_cgpac', ASSINADO: 'dt_assinatura', CONCLUIDO: 'dt_conclusao' }[momento];
      if (marco && !a[marco]) a[marco] = data;
      Object.assign(a, { momento, momento_desde: data, versao: a.versao + 1, updated_by: eu });
      recalc(a);
    },
    async salvarAio(id, versao, campos) {
      const a = db.aios.find((x) => x.id === id);
      if (a.versao !== versao) throw new Error('Este AIO foi alterado por outra pessoa. Recarregue e tente de novo.');
      const diff = {};
      Object.entries(campos).forEach(([k, v]) => { if (JSON.stringify(a[k]) !== JSON.stringify(v)) diff[k] = [a[k] ?? null, v]; });
      Object.assign(a, campos, { versao: a.versao + 1, updated_by: eu });
      if (campos.excluido_em) hist(id, 'excluido');
      else if (Object.keys(diff).length) hist(id, 'edicao', { diff });
    },
    async salvarContrato(cid, campos) { db.aios.filter((a) => a.contrato_id === cid).forEach((a) => Object.assign(a, campos)); },
    async excluirAio(id, versao) { return this.salvarAio(id, versao, { excluido_em: new Date().toISOString() }); },
    async importarLista(p) {
      if (db.listas.some((l) => l.arquivo_sha256 === p.arquivo_sha256 && l.tabela === p.tabela)) return { duplicada: true };
      const chaves = await this.contratosChaves();
      const casados = p.itens.filter((i) => chaves.some((c) => (i.nr_instrumento && c.nr_instrumento === i.nr_instrumento) || (i.nr_operacao && c.nr_operacao === i.nr_operacao))).length;
      db.listas.unshift({ id: Date.now(), recebida_em: p.recebida_em, tabela: p.tabela, titulo: p.titulo, arquivo_nome: p.arquivo_nome,
        arquivo_sha256: p.arquivo_sha256, convalidacao: p.convalidacao, importada_em: new Date().toISOString(), importada_por: eu,
        qtd_itens: p.itens.length, itens: p.itens.length, casados });
      return { duplicada: false, itens: p.itens.length, casados };
    },
    ouvir(_m, aoStatus) { aoStatus(true); },
  };
}
