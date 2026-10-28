#!/usr/bin/env python3
"""
Cria no painel os AIOs que chegaram por e-mail da Caixa (GEPAC07) e ainda não
estão cadastrados, para as secretarias escolhidas (padrão: SNH). Não precisa de
VPN: lê a tabela referencia do Supabase, que o 03_sync_referencia.py preenche
com a data do e-mail e a situação da AIO no TransfereGov.

Para cada instrumento com e-mail e sem nenhum AIO no painel (nem excluído):
  - AIO já emitida no TGOV  -> entra como CONCLUIDO, na data de emissão do TGOV
  - ainda não emitida       -> entra como SOLICITADO, na data do e-mail
Os AIOs criados por este script que ainda estão em SOLICITADO passam para
CONCLUIDO quando o TGOV mostrar a AIO emitida. Os demais AIOs não são tocados.

Uso:
    python3 python/08_aios_do_email.py                     # simulação
    python3 python/08_aios_do_email.py --commit
    python3 python/08_aios_do_email.py --secretaria SNH SNSA --commit
"""

import argparse
import collections
import datetime
import sys

from comum import ErroSupabase, SupabaseREST, salvar_csv

AUTOR = "e-mail GEPAC07"


def _dt(v):
    return datetime.date.fromisoformat(v[:10]) if v else None


def _br(d):
    return d.strftime("%d/%m/%Y") if d else "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--secretaria", nargs="+", default=["SNH"])
    ap.add_argument("--commit", action="store_true", help="grava no Supabase (sem isso é só simulação)")
    args = ap.parse_args()
    hoje = datetime.date.today()

    sb = SupabaseREST()
    secs = ",".join(args.secretaria)
    refs = sb.select("referencia", "*", {"dt_aio_recebido_email": "not.is.null", "secretaria": f"in.({secs})"})
    contratos = {c["nr_instrumento"]: c["id"] for c in sb.select("contrato", "id,nr_instrumento") if c["nr_instrumento"]}
    com_aio = {a["contrato_id"] for a in sb.select("aio", "contrato_id")}   # inclui excluídos: não recria
    meus = sb.select("aio", "id,numero,contrato_id,momento",
                     {"created_by": f"eq.{AUTOR}", "momento": "eq.SOLICITADO", "excluido_em": "is.null"})

    novos = []
    for r in refs:
        if contratos.get(r["nr_instrumento"]) in com_aio:
            continue
        dt_email = _dt(r["dt_aio_recebido_email"])
        dt_tgov = _dt(r["dt_emissao_aio_tgov"])
        emitida = r["situacao_aio_tgov"] == "Emitida"
        momento = "CONCLUIDO" if emitida else "SOLICITADO"
        desde = min(dt_tgov or dt_email, hoje) if emitida else min(dt_email, hoje)
        obs = f"Criado automaticamente a partir do e-mail da GEPAC07 de {_br(dt_email)}."
        if emitida:
            obs += f" AIO emitida no TransfereGov em {_br(dt_tgov)}."
        novos.append({
            "instrumento": r["nr_instrumento"], "municipio": r["municipio"], "uf": r["uf"],
            "secretaria": r["secretaria"], "modalidade": r["modalidade"], "momento": momento,
            "momento_desde": desde, "dt_email": dt_email, "dt_tgov": dt_tgov,
            "payload": {
                "autor": AUTOR,
                "contrato": {
                    "nr_instrumento": r["nr_instrumento"], "nr_operacao": r["nr_operacao"],
                    "nr_proposta": r["nr_proposta"], "processo_sei": r["processo_sei"],
                    "proponente": r["proponente"], "municipio": r["municipio"], "uf": r["uf"],
                    "descricao": r["objeto"], "secretaria": r["secretaria"], "modalidade": r["modalidade"],
                    "fase_pac": r["fase_pac"], "cod_tci": r["cod_tci"], "tci": r["tci"],
                },
                "aio": {
                    "etapas": [], "tipo": "EMISSAO", "momento": momento, "momento_desde": desde,
                    "dt_solicitacao_caixa": dt_email, "dt_conclusao": desde if emitida else None,
                    "valor_solicitado": r["valor_repasse"], "tgov": r["tgov"], "obs": obs,
                },
            },
        })

    # AIOs deste script que o TGOV já mostra como emitidos
    ref_por_instr = {r["nr_instrumento"]: r for r in refs}
    instr_por_contrato = {v: k for k, v in contratos.items()}
    concluir = []
    for a in meus:
        r = ref_por_instr.get(instr_por_contrato.get(a["contrato_id"]))
        if r and r["situacao_aio_tgov"] == "Emitida":
            concluir.append((a, min(_dt(r["dt_emissao_aio_tgov"]) or hoje, hoje)))

    print(f"Secretarias: {secs} — {len(refs)} instrumentos com e-mail da GEPAC07")
    print(f"Novos AIOs: {len(novos)}  {dict(collections.Counter(n['momento'] for n in novos))}")
    if novos:
        print(f"  e-mails de {_br(min(n['dt_email'] for n in novos))} a {_br(max(n['dt_email'] for n in novos))}")
    print(f"Passam de SOLICITADO para CONCLUIDO (AIO emitida no TGOV): {len(concluir)}")
    caminho = salvar_csv("aios_do_email", novos,
                         ["instrumento", "municipio", "uf", "secretaria", "modalidade", "momento",
                          "momento_desde", "dt_email", "dt_tgov"])
    print(f"Relatório: {caminho}")

    if not args.commit:
        print("\nSimulação: nada foi gravado. Rode de novo com --commit.")
        return

    criados, erros = 0, []
    for n in novos:
        try:
            sb.rpc("criar_aio", {"p": n["payload"]})
            criados += 1
        except ErroSupabase as e:
            erros.append((n["instrumento"], str(e)))
    concluidos = 0
    for a, dt in concluir:
        try:
            sb.rpc("mudar_momento", {"p_aio": a["id"], "p_momento": "CONCLUIDO", "p_data": dt.isoformat(),
                                     "p_obs": f"AIO emitida no TransfereGov em {_br(dt)} (automático)."})
            concluidos += 1
        except ErroSupabase as e:
            erros.append((f"AIO {a['numero']}", str(e)))

    print(f"\nGravado: {criados} AIOs criados, {concluidos} concluídos, {len(erros)} erros.")
    for chave, e in erros[:20]:
        print(f"  {chave}: {e}")
    sb.log("08_aios_do_email", "email->supabase", criados, ok=not erros,
           detalhe={"secretarias": args.secretaria, "concluidos": concluidos, "erros": erros[:50]})
    if erros:
        sys.exit(1)


if __name__ == "__main__":
    main()
