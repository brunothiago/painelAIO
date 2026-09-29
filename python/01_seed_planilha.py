#!/usr/bin/env python3
"""
Carga inicial do painelAIO a partir da planilha "Informações AIO"
(aba "AIOs a partir de julho de 2026").

Para cada linha: cria o contrato (se ainda não existir), o AIO com o momento
deduzido da planilha e a primeira linha do histórico. Também grava na tabela
referencia os dados de execução física, desbloqueio, saldo e TCI.

Sem --commit só mostra o que faria e grava o relatório em relatorios/seed_*.csv
(confira a coluna "momento" antes de gravar). Rodar duas vezes não duplica:
linhas cujo contrato já tem AIO para as mesmas etapas são puladas.

Uso:
    python3 python/01_seed_planilha.py                      # dry-run
    python3 python/01_seed_planilha.py --commit             # grava no Supabase
    python3 python/01_seed_planilha.py --arquivo outra.xlsx --aba "Nome da aba"
"""

import argparse
import collections
import sys

from comum import RAIZ, ErroSupabase, SupabaseREST, salvar_csv
import planilha


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arquivo", default=str(RAIZ / "Informações AIO.xlsx"))
    ap.add_argument("--aba", default=planilha.ABA_PADRAO)
    ap.add_argument("--commit", action="store_true", help="grava no Supabase (sem isso é só simulação)")
    args = ap.parse_args()

    linhas = planilha.ler(args.arquivo, args.aba)
    convertidas = [planilha.converter(r) for r in linhas]
    rel = [c[2] for c in convertidas]

    print(f"Planilha: {args.arquivo} — aba '{args.aba}': {len(linhas)} linhas com dados\n")
    print("Momento deduzido:")
    for cod, n in collections.Counter(r["momento"] for r in rel).most_common():
        print(f"  {cod:<16} {n:>3}")
    print("\nEstrutura:", collections.Counter(("etapa única" if r["etapas"] == "Única" else "em etapas") for r in rel))
    print("Tipo:", collections.Counter(r["tipo"] or "(vazio)" for r in rel))
    instrs = collections.Counter(r["instrumento"] for r in rel if r["instrumento"])
    repetidos = {k: v for k, v in instrs.items() if v > 1}
    if repetidos:
        print("Instrumentos repetidos (viram etapas do mesmo contrato):", repetidos)
    alertas = [(r["linha"], a) for r in rel for a in r["alertas"]]
    if alertas:
        print(f"\nAlertas ({len(alertas)}):")
        for linha, a in alertas:
            print(f"  linha {linha}: {a}")

    caminho = salvar_csv("seed", rel, list(rel[0].keys()) if rel else ["linha"])
    print(f"\nRelatório: {caminho}")

    if not args.commit:
        print("\nSimulação: nada foi gravado. Confira o relatório e rode de novo com --commit.")
        return

    sb = SupabaseREST()
    contratos = {c["nr_instrumento"]: c["id"] for c in sb.select("contrato", "id,nr_instrumento") if c["nr_instrumento"]}
    ja = {(a["contrato_id"], tuple(a["etapas"] or [])) for a in sb.select("aio", "contrato_id,etapas", {"excluido_em": "is.null"})}

    criados, pulados, erros = 0, 0, []
    for payload, _, r in convertidas:
        cid = contratos.get(payload["contrato"]["nr_instrumento"])
        if cid and (cid, tuple(payload["aio"]["etapas"])) in ja:
            pulados += 1
            continue
        try:
            sb.rpc("criar_aio", {"p": payload})
            criados += 1
        except ErroSupabase as e:
            erros.append((r["linha"], str(e)))

    refs = {}
    for _, ref, _ in convertidas:
        if ref:
            refs[ref["nr_instrumento"]] = ref  # última linha do instrumento vale
    if refs:
        sb.upsert("referencia", list(refs.values()), on_conflict="nr_instrumento")

    print(f"\nGravado: {criados} AIOs criados, {pulados} já existiam, {len(refs)} referências, {len(erros)} erros.")
    for linha, e in erros:
        print(f"  linha {linha}: {e}")
    sb.log("01_seed_planilha", "planilha->supabase", criados,
           ok=not erros, detalhe={"arquivo": args.arquivo, "pulados": pulados, "erros": erros[:50]})
    if erros:
        sys.exit(1)


if __name__ == "__main__":
    main()
