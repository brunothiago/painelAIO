#!/usr/bin/env python3
"""
Copia o cadastro do painelAIO (Supabase) para o banco MCID, em tabelas próprias
no schema se_cgpac (não mexe em aio_solicitacoes):

    se_cgpac.painelaio_contrato      se_cgpac.painelaio_caixa_lista
    se_cgpac.painelaio_aio           se_cgpac.painelaio_caixa_item
    se_cgpac.painelaio_historico     se_cgpac.painelaio_sync_log

Serve de cópia institucional (e backup) e permite cruzar o controle de AIO com
as outras bases do MCID em SQL. O histórico só recebe linhas novas.

Também cria a visão materializada se_cgpac.painelaio_tgov_aio: AIO emitida, situação e
saldo do TransfereGov, só dos convênios da carteira SACI. Serve para quem não tem acesso
ao mcid_transferegov (ex.: pedro.araujo) também sincronizar: o 03_sync_referencia.py dele
lê a visão. Quem tem acesso lê direto e, com --commit, atualiza a visão (só o dono consegue).

Uso (precisa da VPN):
    python3 python/04_espelhar_mcid.py --criar-tabelas   # 1ª vez: cria as tabelas e a visão no se_cgpac
    python3 python/04_espelhar_mcid.py                   # dry-run: mostra o que mudaria
    python3 python/04_espelhar_mcid.py --commit          # grava
    python3 python/04_espelhar_mcid.py --liberar pedro.araujo   # dono: deixa outro usuário rodar a sincronização
"""

import argparse
import json
import re

from comum import SupabaseREST, get_mcid_connection, schema_mcid

# tabela no Supabase -> (tabela no MCID, colunas com tipo, só-acrescenta?)
TABELAS = {
    "contrato": ("painelaio_contrato", """
        id bigint primary key, nr_instrumento text, nr_operacao text, nr_proposta text, siarg text,
        processo_sei text, proponente text, municipio text, uf text, descricao text, secretaria text,
        modalidade text, fase_pac text, em_etapas boolean, cod_tci text, tci text,
        created_at timestamptz, created_by text, updated_at timestamptz, updated_by text""", False),
    "aio": ("painelaio_aio", """
        id bigint primary key, numero int, contrato_id bigint, etapas int[], etapa_descricao text, tipo text,
        momento text, momento_desde date, responsavel text, processo_sei text, valor_solicitado numeric(15,2),
        dt_solicitacao_caixa date, dt_entrada_cgpac date, dt_saida_cgpac date, dt_assinatura date,
        dt_conclusao date, referencia_solicitacao text, os_emitida boolean, tgov boolean,
        aio_automatica_tgov boolean, aio_automatica_caixa boolean, problemas boolean, ressalvas text,
        localizacao_sei text, status_sei text, obs text, versao int, excluido_em timestamptz,
        created_at timestamptz, created_by text, updated_at timestamptz, updated_by text""", False),
    "aio_historico": ("painelaio_historico", """
        id bigint primary key, aio_id bigint, em timestamptz, por text, acao text, momento_de text,
        momento_para text, data_momento date, obs text, diff jsonb""", True),
    "caixa_lista": ("painelaio_caixa_lista", """
        id bigint primary key, recebida_em date, tabela text, titulo text, arquivo_nome text,
        arquivo_sha256 text, importada_em timestamptz, importada_por text, qtd_itens int,
        convalidacao boolean""", False),
    "caixa_lista_item": ("painelaio_caixa_item", """
        id bigint primary key, lista_id bigint, nr_operacao text, nr_instrumento text, nr_proposta text,
        siarg text, recebedor text, uf text, etapa_num int, etapa_texto text, tipologia text,
        valor numeric(15,2), dt_envio date, dt_autorizacao date, dt_pendencia date, dt_devolucao date,
        situacao text, execucao_etapas boolean, passou_cgpac text, obs_mcid text, raw jsonb,
        contrato_id bigint""", False),  # contrato_id muda quando um contrato novo casa com o item
}

LOG_DDL = """create table if not exists {s}.painelaio_sync_log (
    id bigserial primary key, em timestamptz default now(), tabela text, inseridas int,
    atualizadas int, ok boolean, detalhe jsonb)"""

# Só as 4 colunas que o 03 usa, só dos convênios da carteira SACI (que o 03 já lê).
# atualizado_em = hora do último refresh (o 03 do dono faz o refresh a cada rodada).
TGOV_VIEW_DDL = """create materialized view if not exists {s}.painelaio_tgov_aio as
select trim(c.num_convenio) as num_convenio,
       max(c.vlr_saldo_conta) as vlr_saldo_conta,
       max(a.dte_emissao_aio_instrumento_contratual)
         filter (where a.dsc_situacao_aio_instrumento_contratual ilike 'emitida') as dte_emissao_aio,
       string_agg(distinct trim(a.dsc_situacao_aio_instrumento_contratual), ', ') as situacao_aio,
       now() as atualizado_em
  from mcid_transferegov.tab_convenios c
  left join mcid_transferegov.tab_inst_cont_proposta_aio_modulo_empresas a on a.cod_proposta = c.cod_proposta
 where trim(c.num_convenio) in (select trim(num_convenio) from se_saci.view_mat_carteira_investimento)
 group by 1"""


def criar_visao(cur, s):
    cur.execute("select relkind from pg_class where oid = to_regclass(%s)", (f"{s}.painelaio_tgov_aio",))
    r = cur.fetchone()
    if r and r[0] == "v":  # versão anterior era visão comum
        cur.execute(f"drop view {s}.painelaio_tgov_aio")
    cur.execute(TGOV_VIEW_DDL.format(s=s))
    cur.execute(f"comment on materialized view {s}.painelaio_tgov_aio is 'painelAIO: AIO emitida, situação "
                f"e saldo do TransfereGov por convênio (carteira SACI). Atualizada pelo 03_sync_referencia.py "
                f"do dono; lida por quem sincroniza sem acesso ao mcid_transferegov.'")


def liberar(cur, s, usuario):
    """Dá a outro usuário do MCID o necessário para rodar a sincronização (só o dono consegue)."""
    if not re.fullmatch(r"[a-z0-9_.]+", usuario):
        raise SystemExit(f"usuário inválido: {usuario!r}")
    tabs = ", ".join(f"{s}.{t}" for t, _, _ in TABELAS.values())
    cur.execute(f'grant select on {s}.painelaio_tgov_aio to "{usuario}"')
    cur.execute(f'grant select, insert, update on {s}.aio_solicitacoes, {tabs}, {s}.painelaio_sync_log to "{usuario}"')
    cur.execute(f'grant usage on sequence {s}.aio_solicitacoes_id_seq, {s}.painelaio_sync_log_id_seq to "{usuario}"')


def colunas(ddl):
    """Nomes das colunas do DDL (ignora vírgulas dentro de parênteses, ex. numeric(15,2))."""
    return [c.split()[0] for c in re.split(r",(?![^()]*\))", ddl) if c.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--criar-tabelas", action="store_true")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--liberar", metavar="USUARIO_MCID",
                    help="dá a esse usuário do MCID o acesso para rodar a sincronização e sai")
    args = ap.parse_args()
    s = schema_mcid()

    try:
        conn = get_mcid_connection()
    except Exception as e:
        print(f"Sem conexão com o banco MCID (VPN desligada?): {str(e).splitlines()[0]}")
        return

    if args.liberar:
        with conn, conn.cursor() as cur:
            criar_visao(cur, s)
            liberar(cur, s, args.liberar)
        print(f"{args.liberar} já pode rodar a sincronização (visão {s}.painelaio_tgov_aio e tabelas {s}.painelaio_*).")
        return

    if args.criar_tabelas:
        with conn, conn.cursor() as cur:
            for _, (tab, ddl, _) in TABELAS.items():
                cur.execute(f"create table if not exists {s}.{tab} ({ddl})")
            cur.execute(LOG_DDL.format(s=s))
            criar_visao(cur, s)
        print(f"Tabelas {s}.painelaio_* e visão {s}.painelaio_tgov_aio prontas.")
        if not args.commit:
            return

    from psycopg2.extras import Json, execute_values

    # colunas novas do painel entram no espelho sem precisar recriar as tabelas.
    # Só altera quando falta coluna: alter table exige ser o dono, e quem só tem
    # insert/update (outro usuário rodando a sincronização) não pode.
    with conn, conn.cursor() as cur:
        for _, (tab, ddl, _) in TABELAS.items():
            cur.execute("select column_name from information_schema.columns where table_schema=%s and table_name=%s",
                        (s, tab))
            existentes = {r[0] for r in cur.fetchall()}
            if existentes:
                for col in re.split(r",(?![^()]*\))", ddl):
                    col = col.strip()
                    if col and "primary key" not in col and col.split()[0] not in existentes:
                        cur.execute(f"alter table {s}.{tab} add column if not exists {col}")

    sb = SupabaseREST()
    resumo = {}
    with conn, conn.cursor() as cur:
        for origem, (tab, ddl, so_novas) in TABELAS.items():
            cols = colunas(ddl)
            cur.execute(f"select id from {s}.{tab}")
            existentes = {r[0] for r in cur.fetchall()}
            filtro = {"id": f"gt.{max(existentes)}"} if so_novas and existentes else None
            linhas = sb.select(origem, ",".join(cols), filtro, ordem="id")
            novas = [l for l in linhas if l["id"] not in existentes]
            resumo[tab] = {"lidas": len(linhas), "inseridas": len(novas), "atualizadas": len(linhas) - len(novas)}
            print(f"{tab:<24} lidas {len(linhas):>6}  novas {len(novas):>6}  atualizadas {len(linhas) - len(novas):>6}")
            if not args.commit or not linhas:
                continue
            valores = [tuple(Json(l[c]) if isinstance(l[c], (dict, list)) and c in ("diff", "raw") else l[c]
                             for c in cols) for l in linhas]
            upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "id")
            execute_values(cur, f"insert into {s}.{tab} ({', '.join(cols)}) values %s "
                                f"on conflict (id) do update set {upd}", valores, page_size=500)
            cur.execute(f"insert into {s}.painelaio_sync_log (tabela, inseridas, atualizadas, ok, detalhe) "
                        f"values (%s, %s, %s, true, %s)", (tab, resumo[tab]["inseridas"],
                                                           resumo[tab]["atualizadas"], json.dumps(resumo[tab])))
    if args.commit:
        sb.log("04_espelhar_mcid", "supabase->mcid", sum(r["lidas"] for r in resumo.values()), detalhe=resumo)
        print("\nEspelho atualizado.")
    else:
        print("\nSimulação: nada foi gravado. Rode de novo com --commit.")


if __name__ == "__main__":
    main()
