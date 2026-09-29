-- =============================================================================
-- painelAIO — 02_triggers_rpc.sql
-- Autoria automática, histórico, regras de etapa/momento e funções chamadas
-- pelo painel (RPC). Rode depois do 01_schema.sql. Pode rodar de novo.
-- =============================================================================

-- ---------- helpers ----------------------------------------------------------

-- Nº da operação Caixa: só dígitos antes do DV, sem zeros à esquerda
-- ("1098106-85" -> "1098106"; "0396120-18" -> "396120").
create or replace function norm_operacao(t text) returns text
language sql immutable as $$
  select nullif(ltrim(regexp_replace(split_part(coalesce(t, ''), '-', 1), '\D', '', 'g'), '0'), '')
$$;

-- Nº do instrumento: só dígitos antes de "/" ("985333/2025" -> "985333").
create or replace function norm_instrumento(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(split_part(coalesce(t, ''), '/', 1), '\D', '', 'g'), '')
$$;

-- Chamada feita pelos scripts (service_role) ou pelo SQL Editor.
create or replace function is_servico() returns bool
language sql stable as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin')
$$;

-- Quem está agindo: e-mail do login; nos scripts, o autor informado ou "sistema".
create or replace function fn_autor() returns text
language sql stable as $$
  select coalesce(nullif(auth.jwt() ->> 'email', ''),
                  nullif(current_setting('app.autor', true), ''),
                  'sistema')
$$;

create or replace function is_membro() returns bool
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfil
                 where lower(email) = lower(auth.jwt() ->> 'email') and ativo)
$$;

create or replace function is_admin() returns bool
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfil
                 where lower(email) = lower(auth.jwt() ->> 'email') and ativo and papel = 'admin')
$$;

-- ---------- contrato ---------------------------------------------------------

create or replace function trg_contrato_biu() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := fn_autor();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := fn_autor();
  new.nr_instrumento := norm_instrumento(new.nr_instrumento);
  new.nr_operacao    := norm_operacao(new.nr_operacao);
  new.uf             := nullif(upper(left(trim(coalesce(new.uf, '')), 2)), '');
  new.busca := norm_txt(concat_ws(' ', new.nr_instrumento, new.nr_operacao, new.nr_proposta,
                                  new.processo_sei, new.proponente, new.municipio, new.uf,
                                  new.descricao, new.tci));
  return new;
end $$;

-- Ao criar/alterar um contrato, liga os itens das listas da Caixa que ainda não casaram.
create or replace function trg_contrato_aiu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update caixa_lista_item
     set contrato_id = new.id
   where contrato_id is null
     and ((new.nr_instrumento is not null and nr_instrumento = new.nr_instrumento)
       or (new.nr_operacao    is not null and nr_operacao    = new.nr_operacao));
  return null;
end $$;

drop trigger if exists contrato_biu on contrato;
create trigger contrato_biu before insert or update on contrato
  for each row execute function trg_contrato_biu();
drop trigger if exists contrato_aiu on contrato;
create trigger contrato_aiu after insert or update of nr_instrumento, nr_operacao on contrato
  for each row execute function trg_contrato_aiu();

-- ---------- referencia (dados do MCID) --------------------------------------

create or replace function trg_referencia_biu() returns trigger
language plpgsql as $$
begin
  new.nr_instrumento := norm_instrumento(new.nr_instrumento);
  new.nr_operacao    := norm_operacao(new.nr_operacao);
  new.atualizado_em  := now();
  new.busca := norm_txt(concat_ws(' ', new.nr_instrumento, new.nr_operacao, new.nr_proposta, new.processo_sei,
                                  new.proponente, new.municipio, new.uf, new.objeto, new.cod_tci, new.tci));
  return new;
end $$;

drop trigger if exists referencia_biu on referencia;
create trigger referencia_biu before insert or update on referencia
  for each row execute function trg_referencia_biu();

-- ---------- itens das listas da Caixa ----------------------------------------

create or replace function trg_caixa_item_bi() returns trigger
language plpgsql as $$
begin
  new.nr_instrumento := norm_instrumento(new.nr_instrumento);
  new.nr_operacao    := norm_operacao(new.nr_operacao);
  new.uf             := nullif(upper(left(trim(coalesce(new.uf, '')), 2)), '');
  if new.contrato_id is null and new.nr_instrumento is not null then
    select id into new.contrato_id from contrato where nr_instrumento = new.nr_instrumento;
  end if;
  if new.contrato_id is null and new.nr_operacao is not null then
    select id into new.contrato_id from contrato where nr_operacao = new.nr_operacao;
  end if;
  return new;
end $$;

drop trigger if exists caixa_item_bi on caixa_lista_item;
create trigger caixa_item_bi before insert on caixa_lista_item
  for each row execute function trg_caixa_item_bi();

-- ---------- aio: regras ------------------------------------------------------

create or replace function trg_aio_biu() returns trigger
language plpgsql as $$
declare
  v_m        momento;
  v_conflito bigint;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := fn_autor();
    new.versao     := 1;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.versao     := old.versao + 1;
    if new.excluido_em is distinct from old.excluido_em and not (is_admin() or is_servico()) then
      raise exception 'Só administradores podem excluir ou restaurar um AIO.';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := fn_autor();
  new.etapas := coalesce((select array_agg(distinct e order by e) from unnest(new.etapas) e), '{}');

  select * into v_m from momento where codigo = new.momento;

  if tg_op = 'INSERT' or new.momento is distinct from old.momento
     or new.momento_desde is distinct from old.momento_desde then
    if new.momento_desde > current_date then
      raise exception 'A data do momento não pode ser futura.';
    end if;
    if v_m.is_desvio and not is_servico()
       and coalesce(nullif(current_setting('app.obs', true), ''), '') = '' then
      raise exception 'Informe uma observação para o momento "%".', v_m.nome;
    end if;
  end if;

  -- Não pode haver dois AIOs em andamento para a mesma etapa do mesmo contrato.
  if new.excluido_em is null and not v_m.is_final then
    select o.id into v_conflito
      from aio o join momento om on om.codigo = o.momento
     where o.contrato_id = new.contrato_id
       and o.id <> coalesce(new.id, -1)
       and o.excluido_em is null
       and not om.is_final
       and ((cardinality(o.etapas) = 0 and cardinality(new.etapas) = 0) or o.etapas && new.etapas)
     limit 1;
    if v_conflito is not null then
      raise exception 'Já existe um AIO em andamento para esta etapa deste contrato (AIO nº %).', v_conflito;
    end if;
  end if;
  return new;
end $$;

-- ---------- aio: histórico ---------------------------------------------------

create or replace function trg_aio_aiu() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_obs  text := nullif(current_setting('app.obs', true), '');
  v_diff jsonb;
  v_ign  text[] := array['versao', 'updated_at', 'updated_by', 'created_at', 'created_by',
                         'momento', 'momento_desde', 'excluido_em'];
begin
  if tg_op = 'INSERT' then
    insert into aio_historico (aio_id, por, acao, momento_para, data_momento, obs)
    values (new.id, new.created_by, 'criado', new.momento, new.momento_desde, v_obs);
    return null;
  end if;

  if new.excluido_em is distinct from old.excluido_em then
    insert into aio_historico (aio_id, por, acao, obs)
    values (new.id, new.updated_by,
            case when new.excluido_em is null then 'restaurado' else 'excluido' end, v_obs);
  end if;

  if new.momento is distinct from old.momento or new.momento_desde is distinct from old.momento_desde then
    insert into aio_historico (aio_id, por, acao, momento_de, momento_para, data_momento, obs)
    values (new.id, new.updated_by, 'momento', old.momento, new.momento, new.momento_desde, v_obs);
    -- as datas-marco que a mudança de momento preenche não entram como "edição"
    v_ign := v_ign || array['dt_solicitacao_caixa', 'dt_entrada_cgpac', 'dt_saida_cgpac',
                            'dt_assinatura', 'dt_conclusao'];
  end if;

  select jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)) into v_diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value
     and not (n.key = any (v_ign));

  if v_diff is not null then
    insert into aio_historico (aio_id, por, acao, diff)
    values (new.id, new.updated_by, 'edicao', v_diff);
  end if;
  return null;
end $$;

drop trigger if exists aio_biu on aio;
create trigger aio_biu before insert or update on aio
  for each row execute function trg_aio_biu();
drop trigger if exists aio_aiu on aio;
create trigger aio_aiu after insert or update on aio
  for each row execute function trg_aio_aiu();

-- ---------- RPC: mudar o momento de um AIO -----------------------------------

create or replace function mudar_momento(p_aio bigint, p_momento text, p_data date,
                                         p_obs text default null, p_versao int default null)
returns aio
language plpgsql as $$
declare
  v    aio;
  v_dt date := coalesce(p_data, current_date);
begin
  if not (is_membro() or is_servico()) then
    raise exception 'Acesso não liberado.';
  end if;
  perform set_config('app.obs', coalesce(p_obs, ''), true);

  update aio set
    momento              = p_momento,
    momento_desde        = v_dt,
    dt_solicitacao_caixa = case when p_momento = 'SOLICITADO' then coalesce(dt_solicitacao_caixa, v_dt) else dt_solicitacao_caixa end,
    dt_entrada_cgpac     = case when p_momento = 'RECEBIDO' then coalesce(dt_entrada_cgpac, v_dt) else dt_entrada_cgpac end,
    dt_saida_cgpac       = case when p_momento in ('TRAMITADO_GABSE', 'DEVOLVIDO_SF') then coalesce(dt_saida_cgpac, v_dt) else dt_saida_cgpac end,
    dt_assinatura        = case when p_momento = 'ASSINADO' then coalesce(dt_assinatura, v_dt) else dt_assinatura end,
    dt_conclusao         = case when p_momento = 'CONCLUIDO' then coalesce(dt_conclusao, v_dt) else dt_conclusao end
  where id = p_aio
    and excluido_em is null
    and (p_versao is null or versao = p_versao)
  returning * into v;

  if not found then
    raise exception 'Este AIO foi alterado por outra pessoa. Recarregue e tente de novo.' using errcode = 'PT409';
  end if;
  perform set_config('app.obs', '', true);
  return v;
end $$;

-- ---------- RPC: criar AIO (e o contrato, se ainda não existir) --------------
-- p = {contrato_id?, contrato:{nr_instrumento, nr_operacao, ...}, aio:{etapas:[..], tipo, momento, ...},
--      obs_momento?, autor? (só scripts)}

create or replace function criar_aio(p jsonb) returns bigint
language plpgsql as $$
declare
  c          jsonb  := coalesce(p -> 'contrato', '{}');
  a          jsonb  := coalesce(p -> 'aio', '{}');
  v_contrato bigint := nullif(p ->> 'contrato_id', '')::bigint;
  v_instr    text   := norm_instrumento(c ->> 'nr_instrumento');
  v_oper     text   := norm_operacao(c ->> 'nr_operacao');
  v_id       bigint;
begin
  if not (is_membro() or is_servico()) then
    raise exception 'Acesso não liberado.';
  end if;
  if is_servico() and nullif(p ->> 'autor', '') is not null then
    perform set_config('app.autor', p ->> 'autor', true);
  end if;
  perform set_config('app.obs', coalesce(p ->> 'obs_momento', ''), true);

  if v_contrato is null and v_instr is not null then
    select id into v_contrato from contrato where nr_instrumento = v_instr;
  end if;
  if v_contrato is null and v_oper is not null then
    select id into v_contrato from contrato where nr_operacao = v_oper;
  end if;

  if v_contrato is null then
    if v_instr is null and v_oper is null then
      raise exception 'Informe o nº do instrumento ou da operação.';
    end if;
    insert into contrato (nr_instrumento, nr_operacao, nr_proposta, siarg, processo_sei, proponente,
                          municipio, uf, descricao, secretaria, modalidade, fase_pac, em_etapas, cod_tci, tci)
    values (v_instr, v_oper, nullif(c ->> 'nr_proposta', ''), nullif(c ->> 'siarg', ''),
            nullif(c ->> 'processo_sei', ''), nullif(c ->> 'proponente', ''), nullif(c ->> 'municipio', ''),
            nullif(c ->> 'uf', ''), nullif(c ->> 'descricao', ''), nullif(c ->> 'secretaria', ''),
            nullif(c ->> 'modalidade', ''), nullif(c ->> 'fase_pac', ''),
            coalesce(nullif(c ->> 'em_etapas', '')::bool, false),
            nullif(c ->> 'cod_tci', ''), nullif(c ->> 'tci', ''))
    returning id into v_contrato;
  else
    -- contrato já existe: só completa o que estiver vazio
    update contrato set
      nr_operacao  = coalesce(nr_operacao,  v_oper),
      nr_proposta  = coalesce(nr_proposta,  nullif(c ->> 'nr_proposta', '')),
      siarg        = coalesce(siarg,        nullif(c ->> 'siarg', '')),
      processo_sei = coalesce(processo_sei, nullif(c ->> 'processo_sei', '')),
      proponente   = coalesce(proponente,   nullif(c ->> 'proponente', '')),
      municipio    = coalesce(municipio,    nullif(c ->> 'municipio', '')),
      uf           = coalesce(uf,           nullif(c ->> 'uf', '')),
      descricao    = coalesce(descricao,    nullif(c ->> 'descricao', '')),
      secretaria   = coalesce(secretaria,   nullif(c ->> 'secretaria', '')),
      modalidade   = coalesce(modalidade,   nullif(c ->> 'modalidade', '')),
      fase_pac     = coalesce(fase_pac,     nullif(c ->> 'fase_pac', '')),
      cod_tci      = coalesce(cod_tci,      nullif(c ->> 'cod_tci', '')),
      tci          = coalesce(tci,          nullif(c ->> 'tci', '')),
      em_etapas    = em_etapas or coalesce(nullif(c ->> 'em_etapas', '')::bool, false)
            or coalesce(jsonb_array_length(a -> 'etapas'), 0) > 0
    where id = v_contrato;
  end if;

  insert into aio (contrato_id, etapas, etapa_descricao, tipo, momento, momento_desde, responsavel,
                   processo_sei, valor_solicitado, dt_solicitacao_caixa, dt_entrada_cgpac, dt_saida_cgpac,
                   dt_assinatura, dt_conclusao, referencia_solicitacao, os_emitida, tgov,
                   aio_automatica_tgov, aio_automatica_caixa, problemas, ressalvas, localizacao_sei,
                   status_sei, obs)
  values (
    v_contrato,
    coalesce((select array_agg(x::int) from jsonb_array_elements_text(a -> 'etapas') x), '{}'),
    nullif(a ->> 'etapa_descricao', ''),
    nullif(a ->> 'tipo', ''),
    coalesce(nullif(a ->> 'momento', ''), 'SOLICITADO'),
    coalesce(nullif(a ->> 'momento_desde', '')::date, current_date),
    coalesce(nullif(a ->> 'responsavel', ''), auth.jwt() ->> 'email'),
    coalesce(nullif(a ->> 'processo_sei', ''), nullif(c ->> 'processo_sei', '')),
    nullif(a ->> 'valor_solicitado', '')::numeric,
    nullif(a ->> 'dt_solicitacao_caixa', '')::date,
    nullif(a ->> 'dt_entrada_cgpac', '')::date,
    nullif(a ->> 'dt_saida_cgpac', '')::date,
    nullif(a ->> 'dt_assinatura', '')::date,
    nullif(a ->> 'dt_conclusao', '')::date,
    nullif(a ->> 'referencia_solicitacao', ''),
    nullif(a ->> 'os_emitida', '')::bool,
    nullif(a ->> 'tgov', '')::bool,
    nullif(a ->> 'aio_automatica_tgov', '')::bool,
    nullif(a ->> 'aio_automatica_caixa', '')::bool,
    coalesce(nullif(a ->> 'problemas', '')::bool, false),
    nullif(a ->> 'ressalvas', ''),
    nullif(a ->> 'localizacao_sei', ''),
    nullif(a ->> 'status_sei', ''),
    nullif(a ->> 'obs', '')
  )
  returning id into v_id;

  perform set_config('app.obs', '', true);
  return v_id;
end $$;

-- ---------- RPC: importar uma lista da Caixa ---------------------------------
-- p = {recebida_em, tabela, titulo, arquivo_nome, arquivo_sha256, convalidacao, itens:[{nr_operacao, ..., raw}], autor?}

create or replace function importar_lista_caixa(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lista   bigint;
  v_n       int;
  v_casados int;
begin
  if not (is_membro() or is_servico()) then
    raise exception 'Acesso não liberado.';
  end if;
  if is_servico() and nullif(p ->> 'autor', '') is not null then
    perform set_config('app.autor', p ->> 'autor', true);
  end if;

  select id into v_lista from caixa_lista
   where arquivo_sha256 = p ->> 'arquivo_sha256' and tabela = p ->> 'tabela';
  if v_lista is not null then
    return jsonb_build_object('duplicada', true, 'lista_id', v_lista);
  end if;

  insert into caixa_lista (recebida_em, tabela, titulo, arquivo_nome, arquivo_sha256, importada_por, qtd_itens,
                           convalidacao)
  values ((p ->> 'recebida_em')::date, p ->> 'tabela', nullif(p ->> 'titulo', ''),
          nullif(p ->> 'arquivo_nome', ''), nullif(p ->> 'arquivo_sha256', ''), fn_autor(),
          coalesce(jsonb_array_length(p -> 'itens'), 0),
          coalesce(nullif(p ->> 'convalidacao', '')::bool, true))
  returning id into v_lista;

  insert into caixa_lista_item (lista_id, nr_operacao, nr_instrumento, nr_proposta, siarg, recebedor, uf,
                                etapa_num, etapa_texto, tipologia, valor, dt_envio, dt_autorizacao,
                                dt_pendencia, dt_devolucao, situacao, execucao_etapas, passou_cgpac,
                                obs_mcid, raw)
  select v_lista,
         nullif(i ->> 'nr_operacao', ''), nullif(i ->> 'nr_instrumento', ''),
         nullif(i ->> 'nr_proposta', ''), nullif(i ->> 'siarg', ''), nullif(i ->> 'recebedor', ''),
         nullif(i ->> 'uf', ''), nullif(i ->> 'etapa_num', '')::int, nullif(i ->> 'etapa_texto', ''),
         nullif(i ->> 'tipologia', ''), nullif(i ->> 'valor', '')::numeric,
         nullif(i ->> 'dt_envio', '')::date, nullif(i ->> 'dt_autorizacao', '')::date,
         nullif(i ->> 'dt_pendencia', '')::date, nullif(i ->> 'dt_devolucao', '')::date,
         nullif(i ->> 'situacao', ''), nullif(i ->> 'execucao_etapas', '')::bool,
         nullif(i ->> 'passou_cgpac', ''), nullif(i ->> 'obs_mcid', ''), coalesce(i -> 'raw', '{}')
    from jsonb_array_elements(p -> 'itens') i;
  get diagnostics v_n = row_count;

  select count(*) filter (where contrato_id is not null) into v_casados
    from caixa_lista_item where lista_id = v_lista;

  return jsonb_build_object('duplicada', false, 'lista_id', v_lista, 'itens', v_n, 'casados', v_casados);
end $$;
