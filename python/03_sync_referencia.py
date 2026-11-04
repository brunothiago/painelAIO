#!/usr/bin/env python3
"""
Atualiza a tabela referencia do painelAIO com os dados do banco MCID (só leitura
no MCID; precisa da VPN).

Fontes:
  se_saci.view_mat_carteira_investimento  -> TCI, operação, proposta, tomador,
      município/UF, objeto, secretaria, modalidade, fase PAC, valor de repasse,
      execução física (%)
  mcid_transferegov.tab_convenios          -> está no TGOV, saldo em conta
  mcid_transferegov.tab_inst_cont_proposta_aio_modulo_empresas
                                           -> situação e data de emissão da AIO no TGOV
      Quem não tem acesso ao mcid_transferegov lê a cópia se_cgpac.painelaio_tgov_aio
      (visão materializada criada pelo 04_espelhar_mcid.py). Quem tem acesso lê direto e,
      com --commit, atualiza essa cópia (se for o dono dela).
  se_cgpac.aio_solicitacoes                -> data em que o e-mail da Caixa (GEPAC07) chegou

Entram todos os instrumentos PAC do SACI e os que já estão cadastrados no painel.
É essa tabela que a busca de "Novo AIO" usa para pré-preencher o cadastro.

Uso:
    python3 python/03_sync_referencia.py            # dry-run (mostra contagens e exemplos)
    python3 python/03_sync_referencia.py --commit   # grava no Supabase
"""

import argparse
import sys

from comum import SupabaseREST, get_mcid_connection, norm_instrumento, norm_operacao, texto

SQL_SACI = """
select distinct on (trim(num_convenio))
       trim(num_convenio), trim(cod_operacao), trim(num_proposta), trim(cod_tci), trim(txt_tomador),
       trim(txt_municipio), trim(txt_uf), dsc_objeto_instrumento, trim(txt_sigla_secretaria),
       trim(txt_modalidade), trim(dsc_fase_pac), vlr_repasse, prc_execucao_fisica
  from se_saci.view_mat_carteira_investimento
 where nullif(trim(num_convenio), '') is not null
   and (bln_pac = 'SIM' or trim(num_convenio) = any (%s))
 order by trim(num_convenio), (bln_carteira_ativa_mcid = 'SIM') desc, dte_carga desc nulls last
"""

SQL_TGOV_VISAO = """
select num_convenio, vlr_saldo_conta, dte_emissao_aio, situacao_aio
  from {schema}.painelaio_tgov_aio
 where num_convenio = any (%s)
"""


def _tgov_direto(cur):
    """O usuário lê o mcid_transferegov? (testa o schema antes: sem USAGE, o teste da tabela dá erro)"""
    cur.execute("select has_schema_privilege('mcid_transferegov', 'USAGE')")
    if not cur.fetchone()[0]:
        return False
    cur.execute("select has_table_privilege('mcid_transferegov.tab_convenios', 'SELECT') and "
                "has_table_privilege('mcid_transferegov.tab_inst_cont_proposta_aio_modulo_empresas', 'SELECT')")
    return cur.fetchone()[0]

SQL_TGOV = """
select trim(c.num_convenio), max(c.vlr_saldo_conta),
       max(a.dte_emissao_aio_instrumento_contratual)
         filter (where a.dsc_situacao_aio_instrumento_contratual ilike 'emitida'),
       string_agg(distinct trim(a.dsc_situacao_aio_instrumento_contratual), ', ')
  from mcid_transferegov.tab_convenios c
  left join mcid_transferegov.tab_inst_cont_proposta_aio_modulo_empresas a on a.cod_proposta = c.cod_proposta
 where trim(c.num_convenio) = any (%s)
 group by 1
"""

SQL_EMAIL = """
select regexp_replace(split_part(instrumento, '/', 1), '\\D', '', 'g'), max(data_aio_recebido)::date
  from {schema}.aio_solicitacoes
 where instrumento is not null
 group by 1
"""


def _num(v):
    return float(v) if v is not None else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="grava no Supabase (sem isso é só simulação)")
    args = ap.parse_args()

    sb = SupabaseREST() if args.commit else None
    cadastrados = [c["nr_instrumento"] for c in sb.select("contrato", "nr_instrumento") if c["nr_instrumento"]] if sb else []

    try:
        conn = get_mcid_connection()
    except Exception as e:  # sem VPN
        print(f"Sem conexão com o banco MCID (VPN desligada?): {str(e).splitlines()[0]}")
        if sb:
            sb.log("03_sync_referencia", "mcid->supabase", 0, ok=False, detalhe={"erro": "sem conexão MCID"})
        return

    refs = {}
    with conn, conn.cursor() as cur:
        cur.execute(SQL_SACI, (cadastrados,))
        for (conv, oper, prop, tci, tomador, mun, uf, obj, sec, modal, fase, repasse, fis) in cur.fetchall():
            k = norm_instrumento(conv)
            if not k:
                continue
            refs[k] = {
                "nr_instrumento": k, "nr_operacao": norm_operacao(oper), "nr_proposta": texto(prop),
                "proponente": texto(tomador), "municipio": texto(mun), "uf": texto(uf),
                "objeto": texto(obj), "secretaria": texto(sec), "modalidade": texto(modal),
                "fase_pac": texto(fase), "programa": texto(modal), "valor_repasse": _num(repasse),
                "exec_fisica_pct": _num(fis), "cod_tci": texto(tci), "tci": texto(tci),
                "tgov": False, "saldo_conta": None, "dt_emissao_aio_tgov": None, "situacao_aio_tgov": None,
                "dt_aio_recebido_email": None, "fontes": ["saci"],
            }
        print(f"SACI: {len(refs)} instrumentos")

        from comum import schema_mcid
        visao = f"{schema_mcid()}.painelaio_tgov_aio"
        cur.execute("select pg_get_userbyid(relowner) = current_user from pg_class where oid = to_regclass(%s)",
                    (visao,))
        r = cur.fetchone()
        tem_visao, dono_visao = r is not None, bool(r and r[0])
        if _tgov_direto(cur):
            cur.execute(SQL_TGOV, (list(refs),))
            linhas_tgov = cur.fetchall()
            if dono_visao and args.commit:
                cur.execute(f"refresh materialized view {visao}")
                print(f"Cópia {visao} atualizada (lida por quem não tem acesso ao TransfereGov)")
        elif tem_visao:
            cur.execute(f"select to_char(max(atualizado_em), 'DD/MM/YYYY HH24:MI') from {visao}")
            print(f"TransfereGov lido da cópia {visao}, atualizada em {cur.fetchone()[0]}")
            cur.execute(SQL_TGOV_VISAO.format(schema=schema_mcid()), (list(refs),))
            linhas_tgov = cur.fetchall()
        else:
            # sem TGOV, gravar apagaria no painel a data de emissão e o saldo: melhor parar
            print(f"Sem acesso ao mcid_transferegov e sem a cópia {visao}. Nada foi gravado.\n"
                  f"Peça ao dono do {schema_mcid()} para rodar: 04_espelhar_mcid.py --liberar SEU_USUARIO")
            if sb:
                sb.log("03_sync_referencia", "mcid->supabase", 0, ok=False, detalhe={"erro": "sem acesso ao TGOV"})
            return 1
        n_tgov = 0
        for conv, saldo, dt_aio, sit in linhas_tgov:
            r = refs.get(norm_instrumento(conv))
            if r:
                n_tgov += 1
                r.update(tgov=True, saldo_conta=_num(saldo), dt_emissao_aio_tgov=dt_aio, situacao_aio_tgov=texto(sit))
                r["fontes"] = r["fontes"] + ["transferegov"]
        print(f"TransfereGov: {n_tgov} com convênio; "
              f"{sum(1 for r in refs.values() if r['dt_emissao_aio_tgov'])} com AIO emitida")

        cur.execute(SQL_EMAIL.format(schema=schema_mcid()))
        n_email = 0
        for k, dt in cur.fetchall():
            r = refs.get(k)
            if r:
                n_email += 1
                r["dt_aio_recebido_email"] = dt
                r["fontes"] = r["fontes"] + ["gepac07"]
        print(f"E-mails GEPAC07 (aio_solicitacoes): {n_email} instrumentos")
        cur.execute(f"select max(data_aio_recebido), max(criado_em) from {schema_mcid()}.aio_solicitacoes")
        ultimo_email, email_importado = cur.fetchone()

    faltam = [k for k in cadastrados if k not in refs]
    if faltam:
        print(f"Cadastrados no painel sem registro no SACI: {len(faltam)} ({', '.join(faltam[:10])}...)")

    exemplos = list(refs.values())[:3]
    for e in exemplos:
        print("  ex.", {k: e[k] for k in ("nr_instrumento", "nr_operacao", "cod_tci", "municipio", "uf",
                                         "exec_fisica_pct", "dt_emissao_aio_tgov", "situacao_aio_tgov")})

    if not args.commit:
        print("\nSimulação: nada foi gravado. Rode de novo com --commit.")
        return

    linhas = list(refs.values())
    sb.upsert("referencia", linhas, on_conflict="nr_instrumento")
    sb.log("03_sync_referencia", "mcid->supabase", len(linhas),
           detalhe={"tgov": n_tgov, "email": n_email, "sem_saci": len(faltam),
                    "ultimo_email": ultimo_email, "email_importado": email_importado})
    print(f"\nGravado: {len(linhas)} referências.")


if __name__ == "__main__":
    sys.exit(main())
