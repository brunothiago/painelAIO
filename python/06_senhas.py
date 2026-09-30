#!/usr/bin/env python3
"""
Administração dos logins do painelAIO (usa a secret key do config.env).

Rode no SEU Terminal (não pelo chat): as senhas aparecem só na sua tela.

    python3 python/06_senhas.py --listar
        mostra os usuários, se já entraram e se estão na tabela da equipe (perfil)

    python3 python/06_senhas.py --nova-senha zione.rego@cidades.gov.br
        gera uma senha provisória nova e mostra na tela (mande para a pessoa por fora)

    python3 python/06_senhas.py --nova-senha zione.rego@cidades.gov.br --digitar
        você digita a senha (não aparece na tela)

    python3 python/06_senhas.py --criar fulano@cidades.gov.br
        cria o login (já confirmado) com senha provisória; lembre de incluir a
        pessoa também na tabela perfil (sql/05b_equipe.sql)
"""

import argparse
import getpass
import secrets
import string
import sys

from comum import SupabaseREST


def senha_provisoria():
    # fácil de ditar: sem caracteres parecidos (0/O, 1/l) e sem espaço
    alfa = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")
    return "-".join("".join(secrets.choice(alfa) for _ in range(4)) for _ in range(3))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--listar", action="store_true")
    g.add_argument("--nova-senha", metavar="EMAIL")
    g.add_argument("--criar", metavar="EMAIL")
    ap.add_argument("--digitar", action="store_true", help="digitar a senha em vez de gerar")
    args = ap.parse_args()

    sb = SupabaseREST()
    base = sb.url + "/auth/v1/admin/users"
    r = sb._req.get(base, headers=sb.h, params={"per_page": 1000}, timeout=30)
    sb._checa(r)
    usuarios = {u["email"].lower(): u for u in r.json().get("users", [])}
    perfis = {p["email"].lower(): p for p in sb.select("perfil", "email,nome,papel,ativo")}

    if args.listar:
        for email in sorted(set(usuarios) | set(perfis)):
            u, p = usuarios.get(email), perfis.get(email)
            login = "SEM LOGIN" if not u else ("já entrou " + u["last_sign_in_at"][:10]) if u.get("last_sign_in_at") else "nunca entrou"
            equipe = "FORA da equipe (perfil)" if not p else f"{p['papel']}{'' if p['ativo'] else ' (inativo)'}"
            print(f"{email:<36} {login:<22} {equipe}")
        return

    def definir(email, uid=None):
        if args.digitar:
            s1 = getpass.getpass("Nova senha (mín. 8): ")
            if len(s1) < 8 or s1 != getpass.getpass("Repita: "):
                sys.exit("Senhas diferentes ou curtas demais. Nada foi alterado.")
            senha = s1
        else:
            senha = senha_provisoria()
        corpo = {"password": senha, "email_confirm": True}
        if uid:
            resp = sb._req.put(f"{base}/{uid}", headers=sb.h, json=corpo, timeout=30)
        else:
            resp = sb._req.post(base, headers=sb.h, json=dict(corpo, email=email), timeout=30)
        sb._checa(resp)
        if not args.digitar:
            print(f"\n  {email}\n  senha provisória: {senha}\n")
            print("  Mande para a pessoa por fora (Teams/telefone) e peça para trocar no painel:")
            print("  menu com o nome › Trocar senha.")
        else:
            print(f"Senha de {email} alterada.")

    email = (args.nova_senha or args.criar).strip().lower()
    if args.nova_senha:
        if email not in usuarios:
            sys.exit(f"{email} não tem login. Use --criar.")
        definir(email, usuarios[email]["id"])
    else:
        if email in usuarios:
            sys.exit(f"{email} já tem login. Use --nova-senha.")
        definir(email)
    if email not in perfis:
        print(f"ATENÇÃO: {email} não está na tabela perfil — vai ver 'Acesso não liberado'.")


if __name__ == "__main__":
    main()
