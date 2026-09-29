#!/usr/bin/env python3
"""
Copia o cadastro do painelAIO (Supabase) para o banco MCID, em tabelas próprias
no schema se_cgpac (não mexe em aio_solicitacoes):

    se_cgpac.painelaio_contrato      se_cgpac.painelaio_caixa_lista
    se_cgpac.painelaio_aio           se_cgpac.painelaio_caixa_item
    se_cgpac.painelaio_historico     se_cgpac.painelaio_sync_log

Serve de cópia institucional (e backup) e permite cruzar o controle de AIO com
as outras bases do MCID em SQL. O histórico só recebe linhas novas.

Uso (precisa da VPN):
    python3 python/04_espelhar_mcid.py --criar-tabelas   # 1ª vez: cria as tabelas no se_cgpac
    python3 python/04_espelhar_mcid.py                   # dry-run: mostra o que mudaria
    python3 python/04_espelhar_mcid.py --commit          # grava
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
        id bigint primary key, contrato_id bigint, etapas int[], etapa_descricao text, tipo text,
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


def colunas(ddl):
    """Nomes das colunas do DDL (ignora vírgulas dentro de parênteses, ex. numeric(15,2))."""
    return [c.split()[0] for c in re.split(r",(?![^()]*\))", ddl) if c.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--criar-tabelas", action="store_true")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    s = schema_mcid()

    try:
        conn = get_mcid_connection()
    except Exception as e:
        print(f"Sem conexão com o banco MCID (VPN desligada?): {str(e).splitlines()[0]}")
        return

    if args.criar_tabelas:
        with conn, conn.cursor() as cur:
            for _, (tab, ddl, _) in TABELAS.items():
                cur.execute(f"create table if not exists {s}.{tab} ({ddl})")
            cur.execute(LOG_DDL.format(s=s))
        print(f"Tabelas {s}.painelaio_* prontas.")
        if not args.commit:
            return

    from psycopg2.extras import Json, execute_values

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
