#!/usr/bin/env python3
"""
Aplica os arquivos de sql/ direto no banco do Supabase, sem precisar colar no
SQL Editor. Usa SUPABASE_DB_URL do config.env (Connect › Session pooler).

Regras de segurança embutidas:
  - se rodar 01, 02 ou 03, o 04_rls.sql roda logo depois (recriar tabelas ou
    visões devolve ao visitante sem login a permissão padrão do Supabase);
  - no fim sempre roda o 99_testes.sql e mostra o resultado.

Uso:
    python3 python/aplicar_sql.py                    # mostra o que rodaria (simulação)
    python3 python/aplicar_sql.py --commit           # roda 01, 02, 03, 04, 05, 06 e 99
    python3 python/aplicar_sql.py 03 --commit        # só a 03 (e depois 04 e 99)
    python3 python/aplicar_sql.py 05b --commit       # equipe (arquivo local, fora do Git)
"""

import argparse
import sys

from comum import RAIZ, cfg

PADRAO = ["01", "02", "03", "04", "05", "06"]


def arquivos(prefixos):
    sqls = sorted((RAIZ / "sql").glob("*.sql"))
    escolhidos = []
    for p in prefixos:
        achou = [f for f in sqls if f.name.split("_")[0] == p]
        if not achou:
            sys.exit(f"Não achei sql/{p}_*.sql")
        escolhidos += achou
    if any(f.name[:2] in ("01", "02", "03") for f in escolhidos):
        escolhidos += [f for f in sqls if f.name.startswith("04_")]
    escolhidos += [f for f in sqls if f.name.startswith("99_")]
    vistos, ordem = set(), []
    for f in sorted(escolhidos, key=lambda f: f.name):
        if f not in vistos:
            vistos.add(f)
            ordem.append(f)
    return ordem


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("prefixos", nargs="*", help="ex.: 01 03 05b (padrão: 01 a 06)")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--banco", default="SUPABASE_DB_URL",
                    help="variável do config.env com o endereço (ex.: SUPABASE_DB_URL_NOVO)")
    args = ap.parse_args()

    lista = arquivos(args.prefixos or PADRAO)
    print("Vai rodar, nesta ordem:", ", ".join(f.name for f in lista))
    if not args.commit:
        print("Simulação: nada foi executado. Rode de novo com --commit.")
        return

    import psycopg2
    url = cfg(args.banco, obrigatorio=True)
    print(f"Banco: {args.banco}")
    conn = psycopg2.connect(url, connect_timeout=15)
    conn.autocommit = True  # cada arquivo controla a própria transação (o 99 faz rollback)
    cur = conn.cursor()
    for f in lista:
        try:
            cur.execute(f.read_text(encoding="utf-8"))
        except psycopg2.Error as e:
            print(f"  ERRO em {f.name}: {str(e).strip()}")
            sys.exit(1)
        res = cur.fetchall() if cur.description else None
        extra = f" -> {res[0][0]}" if f.name.startswith("99_") and res else ""
        print(f"  ok  {f.name}{extra}")
    conn.close()


if __name__ == "__main__":
    main()
