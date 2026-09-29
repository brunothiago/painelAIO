-- =============================================================================
-- painelAIO — 01_schema.sql
-- Tabelas do painel de controle de AIO. Cole no Supabase › SQL Editor › Run.
-- Pode rodar de novo sem perder dados (create ... if not exists).
-- =============================================================================

-- Normaliza texto para busca: minúsculas e sem acento (sem depender de extensão).
create or replace function norm_txt(t text) returns text
language sql immutable as $$
  select lower(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;

-- Catálogo de momentos (fluxo principal + desvios). Editável pela aba Admin.
create table if not exists momento (
  codigo     text primary key,
  ordem      int  not null,
  nome       text not null,
  cor        text not null,
  is_desvio  bool not null default false,
  is_final   bool not null default false,
  sla_dias   int                              -- dias no momento antes de "atrasado"; null = sem prazo
);

-- Quem pode entrar no painel (liga com auth.users pelo e-mail).
create table if not exists perfil (
  email  text primary key,
  login  text unique,
  nome   text,
  papel  text not null default 'analista' check (papel in ('analista', 'admin')),
  ativo  bool not null default true
);

-- Contrato / instrumento: nível de agrupamento dos AIOs.
create table if not exists contrato (
  id              bigint generated always as identity primary key,
  nr_instrumento  text,                       -- TransfereGov (ex. 968619)
  nr_operacao     text,                       -- Caixa, só dígitos antes do DV (ex. 1098106)
  nr_proposta     text,
  siarg           text,
  processo_sei    text,
  proponente      text,
  municipio       text,
  uf              char(2),
  descricao       text,
  secretaria      text,
  modalidade      text,
  fase_pac        text,
  em_etapas       bool not null default false,
  cod_tci         text,
  tci             text,
  busca           text,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
create unique index if not exists contrato_instrumento_uk on contrato (nr_instrumento) where nr_instrumento is not null;
create unique index if not exists contrato_operacao_uk    on contrato (nr_operacao)    where nr_operacao    is not null;

-- AIO: um pedido de uma ou mais etapas de um contrato.
create table if not exists aio (
  id                      bigint generated always as identity primary key,
  contrato_id             bigint not null references contrato (id),
  etapas                  int[] not null default '{}',   -- {} = etapa única; {2,4} = "2 e 4"
  etapa_descricao         text,
  tipo                    text check (tipo in ('EMISSAO', 'CONVALIDACAO')),
  momento                 text not null default 'SOLICITADO' references momento (codigo),
  momento_desde           date not null default current_date,
  responsavel             text,                          -- e-mail do analista
  processo_sei            text,
  valor_solicitado        numeric(15, 2),
  dt_solicitacao_caixa    date,
  dt_entrada_cgpac        date,
  dt_saida_cgpac          date,
  dt_assinatura           date,
  dt_conclusao            date,
  referencia_solicitacao  text,
  os_emitida              bool,
  tgov                    bool,
  aio_automatica_tgov     bool,
  aio_automatica_caixa    bool,
  problemas               bool not null default false,
  ressalvas               text,
  localizacao_sei         text,
  status_sei              text,
  obs                     text,
  versao                  int not null default 1,        -- trava otimista
  excluido_em             timestamptz,                   -- exclusão lógica (só admin)
  created_at              timestamptz not null default now(),
  created_by              text,
  updated_at              timestamptz not null default now(),
  updated_by              text
);
create index if not exists aio_contrato_ix on aio (contrato_id);
create index if not exists aio_momento_ix  on aio (momento);

-- Histórico: só recebe linhas (gravado por trigger).
create table if not exists aio_historico (
  id            bigint generated always as identity primary key,
  aio_id        bigint not null references aio (id),
  em            timestamptz not null default now(),
  por           text not null,
  acao          text not null check (acao in ('criado', 'momento', 'edicao', 'excluido', 'restaurado')),
  momento_de    text,
  momento_para  text,
  data_momento  date,
  obs           text,
  diff          jsonb
);
create index if not exists aio_historico_ix on aio_historico (aio_id, em desc);

-- Listas enviadas pela Caixa por e-mail (uma por tabela de cada e-mail).
create table if not exists caixa_lista (
  id              bigint generated always as identity primary key,
  recebida_em     date not null,
  tabela          text not null,              -- T1, T2, T3, T4, T5 ...
  titulo          text,
  arquivo_nome    text,
  arquivo_sha256  text,
  importada_em    timestamptz not null default now(),
  importada_por   text,
  qtd_itens       int,
  convalidacao    bool not null default true,   -- lista de convalidação? (T3 sem TGOV e T4 etapas: não)
  unique (arquivo_sha256, tabela)
);
alter table caixa_lista add column if not exists convalidacao bool not null default true;

create table if not exists caixa_lista_item (
  id               bigint generated always as identity primary key,
  lista_id         bigint not null references caixa_lista (id) on delete cascade,
  nr_operacao      text,
  nr_instrumento   text,
  nr_proposta      text,
  siarg            text,
  recebedor        text,
  uf               char(2),
  etapa_num        int,
  etapa_texto      text,
  tipologia        text,
  valor            numeric(15, 2),
  dt_envio         date,
  dt_autorizacao   date,
  dt_pendencia     date,
  dt_devolucao     date,
  situacao         text,
  execucao_etapas  bool,
  passou_cgpac     text,
  obs_mcid         text,
  raw              jsonb not null default '{}',
  contrato_id      bigint references contrato (id)
);
create index if not exists caixa_item_lista_ix on caixa_lista_item (lista_id);
create index if not exists caixa_item_instr_ix on caixa_lista_item (nr_instrumento);
create index if not exists caixa_item_oper_ix  on caixa_lista_item (nr_operacao);
create index if not exists caixa_item_contr_ix on caixa_lista_item (contrato_id);

-- Foto dos dados do MCID (preenchida pelos scripts; só leitura no painel).
create table if not exists referencia (
  nr_instrumento         text primary key,
  nr_operacao            text,
  nr_proposta            text,
  processo_sei           text,
  proponente             text,
  municipio              text,
  uf                     char(2),
  objeto                 text,
  programa               text,
  secretaria             text,
  modalidade             text,
  valor_repasse          numeric(15, 2),
  tgov                   bool,
  aio_automatica_tgov    bool,
  dt_emissao_aio_tgov    date,
  situacao_aio_tgov      text,
  fase_pac               text,
  cod_tci                text,
  tci                    text,
  exec_fisica_pct        numeric(7, 4),       -- em % (0 a 100)
  dt_ultimo_desbloqueio  date,
  saldo_conta            numeric(15, 2),
  dt_aio_recebido_email  date,
  fontes                 text[],
  busca                  text,
  atualizado_em          timestamptz not null default now()
);

alter table referencia add column if not exists situacao_aio_tgov text;
alter table referencia add column if not exists fase_pac text;

create table if not exists sync_log (
  id       bigint generated always as identity primary key,
  em       timestamptz not null default now(),
  script   text,
  direcao  text,
  linhas   int,
  ok       bool,
  detalhe  jsonb
);
