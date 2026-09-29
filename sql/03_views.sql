-- =============================================================================
-- painelAIO — 03_views.sql
-- Visões lidas pelo painel. security_invoker = as regras de acesso (RLS) das
-- tabelas valem também aqui. Pode rodar de novo.
-- =============================================================================

-- Uma linha por AIO ativo, com contrato, momento, dados MCID e presença nas listas da Caixa.
drop view if exists v_aio_painel;
create view v_aio_painel with (security_invoker = on) as
select
  a.id, a.contrato_id, a.etapas, a.etapa_descricao, a.tipo, a.momento, a.momento_desde, a.responsavel,
  coalesce(a.processo_sei, c.processo_sei) as processo_sei,
  a.valor_solicitado, a.dt_solicitacao_caixa, a.dt_entrada_cgpac, a.dt_saida_cgpac,
  a.dt_assinatura, a.dt_conclusao, a.referencia_solicitacao, a.os_emitida, a.tgov,
  a.aio_automatica_tgov, a.aio_automatica_caixa, a.problemas, a.ressalvas, a.localizacao_sei,
  a.status_sei, a.obs, a.versao, a.created_at, a.created_by, a.updated_at, a.updated_by,
  c.nr_instrumento,
  coalesce(c.nr_operacao, r.nr_operacao)  as nr_operacao,
  coalesce(c.nr_proposta, r.nr_proposta)  as nr_proposta,
  c.siarg,
  -- o que a equipe preencheu vale; o que faltar vem do SACI (tabela referencia)
  coalesce(c.proponente, r.proponente)    as proponente,
  coalesce(c.municipio, r.municipio)      as municipio,
  coalesce(c.uf, r.uf)                    as uf,
  coalesce(c.descricao, r.objeto)         as descricao,
  coalesce(c.secretaria, r.secretaria)    as secretaria,
  coalesce(c.modalidade, r.modalidade)    as modalidade,
  coalesce(c.fase_pac, r.fase_pac)        as fase_pac,
  c.em_etapas,
  coalesce(c.cod_tci, r.cod_tci) as cod_tci,
  coalesce(c.tci, r.tci)         as tci,
  m.nome as momento_nome, m.ordem as momento_ordem, m.cor as momento_cor,
  m.is_desvio, m.is_final, m.sla_dias,
  (current_date - a.momento_desde)                                   as dias_no_momento,
  (coalesce(a.dt_conclusao, current_date) - a.dt_solicitacao_caixa)  as dias_mcid,
  (coalesce(a.dt_saida_cgpac, current_date) - a.dt_entrada_cgpac)    as dias_cgpac,
  (not m.is_final and m.sla_dias is not null
     and (current_date - a.momento_desde) > m.sla_dias)             as atrasado,
  coalesce(cx.n_itens, 0) > 0 as presente_caixa,
  coalesce(cx.n_conv, 0) > 0  as presente_convalidacao,
  cx.listas                   as caixa_listas,
  cx.ultima_data              as caixa_ultima_data,
  cx.ultima_situacao          as caixa_situacao,
  cx.ultima_obs               as caixa_obs,
  r.tgov                      as ref_tgov,
  r.aio_automatica_tgov       as ref_aio_automatica_tgov,
  r.dt_emissao_aio_tgov, r.situacao_aio_tgov, r.exec_fisica_pct, r.dt_ultimo_desbloqueio, r.saldo_conta,
  r.dt_aio_recebido_email, r.valor_repasse as ref_valor_repasse, r.programa as ref_programa,
  r.atualizado_em             as ref_atualizado_em,
  case when coalesce(c.cod_tci, r.cod_tci) is not null
       then 'https://saci.cidades.gov.br/contratos/' || coalesce(c.cod_tci, r.cod_tci) end as link_saci
from aio a
join contrato c on c.id = a.contrato_id
join momento  m on m.codigo = a.momento
left join referencia r on r.nr_instrumento = c.nr_instrumento
left join lateral (
  select count(*) as n_itens,
         count(*) filter (where l.convalidacao) as n_conv,
         string_agg(distinct l.tabela || ' ' || to_char(l.recebida_em, 'DD/MM'), ', ') as listas,
         max(l.recebida_em) as ultima_data,
         (array_agg(i.situacao order by l.recebida_em desc, i.id desc)
            filter (where i.situacao is not null))[1] as ultima_situacao,
         (array_agg(i.obs_mcid order by l.recebida_em desc, i.id desc)
            filter (where i.obs_mcid is not null))[1] as ultima_obs
    from caixa_lista_item i
    join caixa_lista l on l.id = i.lista_id
   where i.contrato_id = a.contrato_id
     and (i.etapa_num is null or cardinality(a.etapas) = 0 or i.etapa_num = any (a.etapas))
) cx on true
where a.excluido_em is null;

-- Itens das listas da Caixa sem AIO cadastrado (fila para "Iniciar cadastro").
-- Mantém só o registro mais recente de cada instrumento/etapa.
drop view if exists v_caixa_sem_cadastro;
create view v_caixa_sem_cadastro with (security_invoker = on) as
select distinct on (coalesce(i.nr_instrumento, i.nr_operacao), coalesce(i.etapa_num, 0))
  i.id, i.lista_id, l.tabela, l.recebida_em, l.titulo,
  i.nr_operacao, i.nr_instrumento, i.nr_proposta, i.siarg, i.recebedor, i.uf,
  i.etapa_num, i.etapa_texto, i.tipologia, i.valor, i.dt_envio, i.dt_autorizacao,
  i.situacao, i.passou_cgpac, i.obs_mcid, i.contrato_id
from caixa_lista_item i
join caixa_lista l on l.id = i.lista_id
where not exists (
  select 1 from aio a
   where a.contrato_id = i.contrato_id
     and a.excluido_em is null
     and (i.etapa_num is null or cardinality(a.etapas) = 0 or i.etapa_num = any (a.etapas)))
order by coalesce(i.nr_instrumento, i.nr_operacao), coalesce(i.etapa_num, 0), l.recebida_em desc, i.id desc;

-- Resumo das listas importadas (aba Caixa).
drop view if exists v_caixa_listas;
create view v_caixa_listas with (security_invoker = on) as
select l.*,
       (select count(*) from caixa_lista_item i where i.lista_id = l.id)                             as itens,
       (select count(*) from caixa_lista_item i where i.lista_id = l.id and i.contrato_id is not null) as casados
from caixa_lista l;

-- Feed de atividade (histórico com a identificação do contrato).
drop view if exists v_atividade;
create view v_atividade with (security_invoker = on) as
select h.*, a.contrato_id, a.etapas, c.nr_instrumento, c.municipio, c.uf
from aio_historico h
join aio a      on a.id = h.aio_id
join contrato c on c.id = a.contrato_id;
