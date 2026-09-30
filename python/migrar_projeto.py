#!/usr/bin/env python3
"""
Copia o painelAIO inteiro de um projeto Supabase para outro (ex.: de Ohio para
São Paulo), banco a banco, pelos endereços de conexão do config.env:

    SUPABASE_DB_URL_ANTIGO   projeto de origem
    SUPABASE_DB_URL_NOVO     projeto de destino (já com os sql/ aplicados)

O que é copiado, mantendo ids, números, autores e datas:
  - public: momento, perfil, contrato, aio, aio_historico, caixa_lista,
    caixa_lista_item, referencia, sync_log
  - auth.users e auth.identities: os logins, com as senhas já criptografadas
    (ninguém precisa trocar a senha; a senha em si nunca é lida)

Os gatilhos do painel ficam desligados durante a cópia, para não reescrever
autores nem gerar histórico falso. As tabelas do destino são esvaziadas antes.

Uso:
    python3 python/migrar_projeto.py            # simulação: conta o que seria copiado
    python3 python/migrar_projeto.py --commit
"""

import argparse
import sys

import psycopg2
from psycopg2.extras import Json, execute_values

from comum import cfg

TABELAS = ["momento", "perfil", "contrato", "aio", "aio_historico", "caixa_lista",
           "caixa_lista_item", "referencia", "sync_log"]          # ordem das chaves estrangeiras
COM_GATILHO = ["contrato", "aio", "caixa_lista_item", "referencia"]
AUTH = ["users", "identities"]


def conectar(nome):
    c = psycopg2.connect(cfg(nome, obrigatorio=True), connect_timeout=20)
    c.autocommit = False
    return c


def colunas(cur, schema, tabela):
    """Colunas que podem ser gravadas (sem as geradas) e quais são jsonb."""
    cur.execute("""select column_name, data_type, is_generated, is_identity
                     from information_schema.columns
                    where table_schema = %s and table_name = %s order by ordinal_position""", (schema, tabela))
    linhas = cur.fetchall()
    grav = [c for c, _, ger, _ in linhas if ger != "ALWAYS"]
    jsonb = {c for c, t, _, _ in linhas if t in ("jsonb", "json")}
    ident = any(i == "YES" for _, _, _, i in linhas)
    return grav, jsonb, ident


def contar(cur, schema, tabela):
    cur.execute(f'select count(*) from {schema}."{tabela}"')
    return cur.fetchone()[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    ori, des = conectar("SUPABASE_DB_URL_ANTIGO"), conectar("SUPABASE_DB_URL_NOVO")
    co, cd = ori.cursor(), des.cursor()
    cd.execute("select current_database(), inet_server_addr()")
    co.execute("select current_database(), inet_server_addr()")
    if co.fetchone() == cd.fetchone():
        sys.exit("Origem e destino são o mesmo banco. Confira o config.env.")
    cd.execute("select to_regclass('public.aio') is not null")
    if not cd.fetchone()[0]:
        sys.exit("O projeto novo ainda não tem as tabelas: rode antes python/aplicar_sql.py no projeto novo.")

    plano = [("public", t) for t in TABELAS] + [("auth", t) for t in AUTH]
    print(f"{'tabela':<26}{'origem':>8}{'destino hoje':>14}")
    for s, t in plano:
        print(f"{s + '.' + t:<26}{contar(co, s, t):>8}{contar(cd, s, t):>14}")
    if not args.commit:
        print("\nSimulação: nada foi copiado. Rode de novo com --commit.")
        return

    try:
        for t in COM_GATILHO:
            cd.execute(f'alter table public."{t}" disable trigger user')
        # esvazia o destino (filhas primeiro)
        cd.execute("delete from auth.identities where user_id in (select id from auth.users)")
        cd.execute("delete from auth.users")
        cd.execute("truncate " + ", ".join(f'public."{t}"' for t in reversed(TABELAS)) + " restart identity cascade")

        for s, t in plano:
            grav_o, _, _ = colunas(co, s, t)
            grav_d, jsonb, ident = colunas(cd, s, t)
            cols = [c for c in grav_d if c in grav_o]           # só o que existe nos dois
            lista = ", ".join(f'"{c}"' for c in cols)
            co.execute(f'select {lista} from {s}."{t}"')
            linhas = [tuple(Json(v) if c in jsonb and v is not None else v for c, v in zip(cols, r))
                      for r in co.fetchall()]
            if linhas:
                sobre = " overriding system value" if ident else ""
                execute_values(cd, f'insert into {s}."{t}" ({lista}){sobre} values %s', linhas, page_size=1000)
            print(f"  {s}.{t}: {len(linhas)} linhas")

        # identidades: a próxima numeração continua de onde parou
        for t in TABELAS:
            cd.execute("""select pg_get_serial_sequence(format('public.%%I', table_name), 'id')
                            from information_schema.columns
                           where table_schema = 'public' and table_name = %s and column_name = 'id'""", (t,))
            r = cd.fetchone()
            seq = r[0] if r else None
            if seq:
                cd.execute(f'select setval(%s, coalesce((select max(id) from public."{t}"), 0) + 1, false)', (seq,))
        for t in COM_GATILHO:
            cd.execute(f'alter table public."{t}" enable trigger user')
        des.commit()
    except Exception:
        des.rollback()
        raise

    print("\nConferência (origem = destino?):")
    ok = True
    for s, t in plano:
        a, b = contar(co, s, t), contar(cd, s, t)
        ok &= a == b
        print(f"  {s + '.' + t:<26}{a:>8}{b:>8}  {'ok' if a == b else 'DIFERENTE'}")
    print("\nMigração concluída." if ok else "\nATENÇÃO: contagens diferentes.")


if __name__ == "__main__":
    main()
