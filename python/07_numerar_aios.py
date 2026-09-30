#!/usr/bin/env python3
"""
Dá o nº sequencial aos AIOs que ainda não têm (uso único, depois de criar a
coluna aio.numero). Os AIOs da carga inicial recebem o mesmo nº da coluna ID
da planilha "Informações AIO"; os demais recebem os números seguintes, na
ordem de cadastro. Os AIOs novos já nascem numerados pelo banco.

Uso:
    python3 python/07_numerar_aios.py            # simulação
    python3 python/07_numerar_aios.py --commit
"""

import argparse
import json
import sys

import planilha
from comum import RAIZ, ErroSupabase, SupabaseREST


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arquivo", default=str(RAIZ / "Informações AIO.xlsx"))
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    sb = SupabaseREST()
    try:
        aios = sb.select("aio", "id,numero,contrato_id,etapas,created_at", ordem="id")
    except ErroSupabase as e:
        if "numero" in str(e):
            sys.exit("A coluna aio.numero ainda não existe: rode antes sql/01, 02, 03 e 04 no Supabase.")
        raise
    contratos = {c["id"]: c["nr_instrumento"] for c in sb.select("contrato", "id,nr_instrumento")}

    # nº da planilha por (instrumento, etapas)
    pl = {}
    for r in planilha.ler(args.arquivo):
        p, _, _ = planilha.converter(r)
        if p["aio"]["numero"]:
            pl[(p["contrato"]["nr_instrumento"], tuple(p["aio"]["etapas"]))] = p["aio"]["numero"]

    usados = {a["numero"] for a in aios if a["numero"]}
    plano = []
    for a in aios:
        if a["numero"]:
            continue
        n = pl.get((contratos.get(a["contrato_id"]), tuple(a["etapas"] or [])))
        if n and n not in usados:
            plano.append((a["id"], n, "ID da planilha"))
            usados.add(n)
    proximo = max(usados | {0}) + 1
    for a in sorted((a for a in aios if not a["numero"] and a["id"] not in {x[0] for x in plano}), key=lambda a: a["created_at"]):
        plano.append((a["id"], proximo, "sequência"))
        proximo += 1

    print(f"AIOs: {len(aios)} | já numerados: {sum(1 for a in aios if a['numero'])} | a numerar: {len(plano)}")
    for aid, n, origem in sorted(plano, key=lambda x: x[1])[:10]:
        print(f"  AIO id {aid:>5} -> nº {n:>3} ({origem})")
    if len(plano) > 10:
        print(f"  ... (+{len(plano) - 10})")
    if not args.commit:
        print("\nSimulação: nada foi gravado. Rode de novo com --commit.")
        return
    h = dict(sb.h, Prefer="return=minimal")
    for aid, n, _ in plano:
        sb._checa(sb._req.patch(f"{sb.base}/aio", headers=h, params={"id": f"eq.{aid}", "numero": "is.null"},
                                data=json.dumps({"numero": n}), timeout=30))
    sb.log("07_numerar_aios", "supabase", len(plano))
    print(f"\nNumerados: {len(plano)}.")


if __name__ == "__main__":
    main()
