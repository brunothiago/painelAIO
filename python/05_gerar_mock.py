#!/usr/bin/env python3
"""
Gera seed/mock.json — os dados da pré-visualização local do painel (?mock=1),
copiados do Supabase. O arquivo fica fora de docs/ e do Git: não é publicado.

Uso:
    python3 python/05_gerar_mock.py
Depois:
    python3 -m http.server 8000      (na pasta do projeto)
    abra http://localhost:8000/docs/?mock=1
"""

import json

from comum import RAIZ, SupabaseREST, _json_default


def main():
    sb = SupabaseREST()
    aios = sb.select("v_aio_painel", ordem="id")
    instrs = {a["nr_instrumento"] for a in aios if a["nr_instrumento"]}
    refs = sb.select("referencia", "nr_instrumento,nr_operacao,nr_proposta,proponente,municipio,uf,objeto,secretaria,"
                                   "modalidade,fase_pac,valor_repasse,cod_tci,tci,dt_emissao_aio_tgov,situacao_aio_tgov",
                     ordem="nr_instrumento")
    # todas as referências dos cadastrados + uma amostra para testar a busca
    refs = [r for r in refs if r["nr_instrumento"] in instrs] + [r for r in refs if r["nr_instrumento"] not in instrs][:400]
    itens = sb.select("caixa_lista_item", "*,caixa_lista(tabela,recebida_em,convalidacao,titulo)", ordem="id")
    dados = {
        "momentos": sb.select("momento", ordem="ordem"),
        "perfis": sb.select("perfil", ordem="email"),
        "aios": aios,
        "historico": sb.select("aio_historico", ordem="id.desc"),
        "listas": sb.select("v_caixa_listas", ordem="recebida_em.desc"),
        "fila": sb.select("v_caixa_sem_cadastro"),
        "itens": itens,
        "referencias": refs,
        "sync": sb.select("sync_log", ordem="em.desc")[:20],
    }
    destino = RAIZ / "seed" / "mock.json"
    destino.parent.mkdir(exist_ok=True)
    destino.write_text(json.dumps(dados, ensure_ascii=False, default=_json_default))
    print(f"{destino}: {len(aios)} AIOs, {len(refs)} referências, {len(itens)} itens de listas da Caixa.")


if __name__ == "__main__":
    main()
