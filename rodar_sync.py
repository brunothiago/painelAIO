#!/usr/bin/env python3
"""
Sincronização do painelAIO (Mac e Windows). Precisa da VPN para falar com o banco MCID:
  0) Gmail -> MCID: e-mails de AIO da GEPAC07 em se_cgpac.aio_solicitacoes
     (aio_pipeline.py do painelcargaaio; 7 dias para cobrir dias sem VPN)
  1) MCID -> Supabase: dados do SACI/TransfereGov usados na busca e no detalhe
  1b) AIOs da SNH que chegaram por e-mail viram AIOs no painel (08_aios_do_email.py)
  2) Supabase -> MCID: espelho do cadastro em se_cgpac.painelaio_*
Sem VPN, os scripts avisam e saem sem erro. O resultado vai para ~/logs/painelaio_sync.log.

É Python (e não shell) porque o agendador do macOS bloqueia o bash de ler a Área de
Trabalho; o Python do projeto já tem essa permissão.

Uso:
    .venv/bin/python rodar_sync.py               # Mac (o agendamento chama assim)
    .venv\\Scripts\\python rodar_sync.py --git-pull   # Windows: baixa o código novo antes
"""

import argparse
import datetime
import os
import pathlib
import re
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parent
CARGA = RAIZ.parent / "painelcargaaio"
LOG = pathlib.Path.home() / "logs" / "painelaio_sync.log"
LIMITE = 20 * 60   # segundos por passo: se travar (rede), segue para o próximo


def python_de(pasta):
    for p in (pasta / ".venv" / "bin" / "python3", pasta / ".venv" / "Scripts" / "python.exe"):
        if p.exists():
            return str(p)
    return sys.executable


def rodar(log, cmd, cwd, filtro=None):
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    try:
        r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=LIMITE)
        saida = (r.stdout or "") + (r.stderr or "")
        if r.returncode:
            saida += f"\n(saiu com código {r.returncode})\n"
    except subprocess.TimeoutExpired:
        saida = f"(passou de {LIMITE // 60} min e foi interrompido)\n"
    linhas = saida.splitlines()
    if filtro:
        linhas = [l for l in linhas if re.search(filtro, l)]
    log.write("".join(f"{l}\n" for l in linhas))
    log.flush()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--git-pull", action="store_true",
                    help="antes de rodar, baixa o código novo dos dois repositórios (notebook que só roda)")
    args = ap.parse_args()

    LOG.parent.mkdir(parents=True, exist_ok=True)
    py, py_carga = python_de(RAIZ), python_de(CARGA)
    with open(LOG, "a", encoding="utf-8") as log:
        log.write(f"=== {datetime.datetime.now():%Y-%m-%d %H:%M} ===\n")
        if args.git_pull:
            for pasta in (RAIZ, CARGA):
                rodar(log, ["git", "-C", str(pasta), "pull", "--ff-only", "--quiet"], RAIZ)
        rodar(log, [py_carga, str(CARGA / "aio_pipeline.py"), "--dias", "7"], CARGA, filtro=r"RESUMO|ERROR|Falha")
        rodar(log, [py, "python/03_sync_referencia.py", "--commit"], RAIZ)
        rodar(log, [py, "python/08_aios_do_email.py", "--commit"], RAIZ, filtro=r"^(?!Relatório|  e-mails)")
        rodar(log, [py, "python/04_espelhar_mcid.py", "--commit"], RAIZ)


if __name__ == "__main__":
    main()
