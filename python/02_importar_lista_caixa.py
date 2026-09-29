#!/usr/bin/env python3
"""
Importa as listas que a Caixa manda por e-mail (.xlsx) para o painelAIO.

Acha sozinho cada bloco "Tabela N ... E-mail Caixa de DD/MM/AAAA" e o
cabeçalho (célula "Operação"). Cada bloco vira uma lista com a data do e-mail.
Os itens casam com os contratos pelo nº do instrumento/convênio e, se não
casar, pelo nº da operação. Importar o mesmo arquivo de novo não duplica.

Listas de convalidação: por padrão T1, T2 e T5 contam como "presente na
planilha de convalidação da Caixa"; T3 (sem TGOV) e T4 (executados por etapas)
não. Mude com --convalidacao / --nao-convalidacao.

A mesma importação pode ser feita no painel (aba Caixa › Importar lista), sem VPN.

Uso:
    python3 python/02_importar_lista_caixa.py "Informações AIO.xlsx"                 # dry-run
    python3 python/02_importar_lista_caixa.py lista.xlsx --recebida-em 2026-10-02 --commit
    python3 python/02_importar_lista_caixa.py lista.xlsx --tabelas T5 --commit
"""

import argparse
import pathlib
import sys

import caixa
import planilha
from comum import RAIZ, ErroSupabase, SupabaseREST, salvar_csv, sha256_arquivo

NAO_CONVALIDACAO_PADRAO = {"T3", "T4"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arquivo")
    ap.add_argument("--recebida-em", help="data do e-mail (AAAA-MM-DD) para blocos sem data no título")
    ap.add_argument("--tabelas", help="importar só estas tabelas, ex. T1,T5")
    ap.add_argument("--convalidacao", default="", help="tabelas que contam como convalidação, ex. T1,T2,T5")
    ap.add_argument("--nao-convalidacao", default="", help="tabelas que não contam, ex. T3,T4")
    ap.add_argument("--commit", action="store_true", help="grava no Supabase (sem isso é só simulação)")
    args = ap.parse_args()

    arquivo = pathlib.Path(args.arquivo)
    blocos = caixa.ler_listas(arquivo)
    if args.tabelas:
        quero = {t.strip().upper() for t in args.tabelas.split(",")}
        blocos = [b for b in blocos if b["tabela"] in quero]
    if not blocos:
        sys.exit("Nenhuma tabela com cabeçalho 'Operação' encontrada no arquivo.")

    sim = {t.strip().upper() for t in args.convalidacao.split(",") if t.strip()}
    nao = {t.strip().upper() for t in args.nao_convalidacao.split(",") if t.strip()} or NAO_CONVALIDACAO_PADRAO - sim

    # data do e-mail: título do bloco > --recebida-em > bloco anterior
    anterior = None
    for b in blocos:
        if not b["recebida_em"]:
            b["recebida_em"] = args.recebida_em or anterior
            b["data_herdada"] = True
        anterior = b["recebida_em"]
        b["convalidacao"] = b["tabela"] not in nao
    sem_data = [b["tabela"] for b in blocos if not b["recebida_em"]]
    if sem_data:
        sys.exit(f"Sem data do e-mail para {sem_data}: informe --recebida-em AAAA-MM-DD.")

    # casamento: com o Supabase (se configurado e --commit) ou com a planilha da carga inicial
    if args.commit:
        sb = SupabaseREST()
        contratos = sb.select("contrato", "id,nr_instrumento,nr_operacao")
        instrs = {c["nr_instrumento"] for c in contratos if c["nr_instrumento"]}
        opers = {c["nr_operacao"] for c in contratos if c["nr_operacao"]}
        fonte = "contratos do Supabase"
    else:
        base = RAIZ / "Informações AIO.xlsx"
        instrs = {planilha.converter(r)[0]["contrato"]["nr_instrumento"] for r in planilha.ler(base)} if base.exists() else set()
        opers = set()
        fonte = "instrumentos da planilha Informações AIO (simulação)"

    print(f"Arquivo: {arquivo.name}\nCasamento contra: {fonte}\n")
    print(f"{'Tabela':<7}{'E-mail':<12}{'Conv.':<7}{'Itens':>6}{'Casam':>7}  Título")
    rel = []
    for b in blocos:
        casam = sum(1 for i in b["itens"] if i.get("nr_instrumento") in instrs or i.get("nr_operacao") in opers)
        b["casam"] = casam
        herdada = " (data herdada)" if b.get("data_herdada") else ""
        print(f"{b['tabela']:<7}{b['recebida_em']:<12}{'sim' if b['convalidacao'] else 'não':<7}"
              f"{len(b['itens']):>6}{casam:>7}  {(b['titulo'] or '')[:60]}{herdada}")
        for i in b["itens"]:
            rel.append({"tabela": b["tabela"], "recebida_em": b["recebida_em"], "linha": i.get("linha"),
                        "nr_instrumento": i.get("nr_instrumento"), "nr_operacao": i.get("nr_operacao"),
                        "etapa": i.get("etapa_num"), "recebedor": i.get("recebedor"), "uf": i.get("uf"),
                        "casa": i.get("nr_instrumento") in instrs or i.get("nr_operacao") in opers,
                        "situacao": i.get("situacao"), "obs_mcid": i.get("obs_mcid")})
    caminho = salvar_csv("caixa", rel, list(rel[0].keys()))
    print(f"\nRelatório: {caminho}")

    if not args.commit:
        print("\nSimulação: nada foi gravado. Rode de novo com --commit.")
        return

    sha = sha256_arquivo(arquivo)
    total = 0
    for b in blocos:
        payload = {"recebida_em": b["recebida_em"], "tabela": b["tabela"], "titulo": b["titulo"],
                   "arquivo_nome": arquivo.name, "arquivo_sha256": sha, "convalidacao": b["convalidacao"],
                   "autor": "script-importacao",
                   "itens": [{k: v for k, v in i.items() if k != "linha"} for i in b["itens"]]}
        try:
            r = sb.rpc("importar_lista_caixa", {"p": payload})
        except ErroSupabase as e:
            print(f"  {b['tabela']}: ERRO {e}")
            continue
        if r.get("duplicada"):
            print(f"  {b['tabela']}: já importada antes (lista {r['lista_id']}), pulada.")
        else:
            total += r["itens"]
            print(f"  {b['tabela']}: {r['itens']} itens, {r['casados']} casados com contratos.")
    sb.log("02_importar_lista_caixa", "xlsx->supabase", total, detalhe={"arquivo": arquivo.name})


if __name__ == "__main__":
    main()
