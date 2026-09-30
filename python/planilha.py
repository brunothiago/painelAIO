"""
Leitura da aba "AIOs a partir de julho de 2026" da planilha "Informações AIO"
e conversão de cada linha em contrato + AIO + momento do painelAIO.
"""

import datetime

import openpyxl

from comum import as_date, as_num, cfg, norm_instrumento, norm_txt, parse_etapas, parse_munuf, sim_nao, texto

ABA_PADRAO = "AIOs a partir de julho de 2026"

# login da planilha -> login do e-mail, quando forem diferentes
LOGIN_EMAIL = {"amanda.cunha": "amanda.duque"}

# cabeçalho normalizado (início do texto) -> chave interna
COLUNAS = {
    "id": "id", "processo": "processo", "responsavel": "responsavel", "fase do pac": "fase_pac",
    "descricao": "descricao", "proponente": "proponente", "secretaria de origem": "secretaria",
    "modalidade": "modalidade", "instrumento": "instrumento", "tgov": "tgov",
    "aio automatica no tgov": "aio_automatica_tgov", "o.s. emitida": "os_emitida",
    "problemas": "problemas", "ressalvas": "ressalvas", "encaminhamento cgpac": "encaminhamento",
    "localizacao atual": "localizacao_sei", "status no sei": "status_sei",
    "presente nas planilhas": "presente_caixa", "emissao de aio ou convalidacao": "tipo",
    "etapa": "etapa", "valor solicitado": "valor", "data da solicitacao da caixa": "dt_solicitacao",
    "entrada na cgpac": "dt_entrada", "saida da cgpac": "dt_saida", "status caixa": "status_caixa",
    "referencia da solicitacao": "referencia", "contrato de etapas": "contrato_etapas",
    "execucao fisica": "exec_fisica", "data do ultimo desbloqueio": "dt_desbloqueio",
    "tem dinheiro em conta": "tem_dinheiro", "valor em conta": "valor_conta",
    "foi emitido o aio automatico na caixa": "aio_automatica_caixa", "tci": "tci",
}


def _chave(cab):
    n = norm_txt(cab)
    # casa pelo começo do texto; a mais longa primeiro (ex. "etapa" x "contrato de etapas")
    for k in sorted(COLUNAS, key=len, reverse=True):
        if n.startswith(k):
            return COLUNAS[k]
    return None


def ler(caminho, aba=ABA_PADRAO):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    ws = wb[aba]
    linhas = list(ws.iter_rows(values_only=True))
    idx = {}
    for j, c in enumerate(linhas[0]):
        k = _chave(c) if c is not None else None
        if k and k not in idx:
            idx[k] = j
    out = []
    for n, row in enumerate(linhas[1:], start=2):
        r = {k: row[j] if j < len(row) else None for k, j in idx.items()}
        if not texto(r.get("processo")) and not texto(r.get("instrumento")):
            continue
        r["_linha"] = n
        out.append(r)
    return out


def momento(r):
    """Primeira regra que casar. Devolve (codigo, motivo, data_do_momento)."""
    sc = norm_txt(r.get("status_caixa"))
    enc = norm_txt(r.get("encaminhamento"))
    ent, sai, sol = as_date(r.get("dt_entrada")), as_date(r.get("dt_saida")), as_date(r.get("dt_solicitacao"))
    if "concedida" in sc:
        return "CONCLUIDO", "Status Caixa = AIO Concedida", sai or ent or sol
    if "impedimento" in sc:
        return "IMPEDIMENTO", "Status Caixa = Impedimento judicial", sai or ent or sol
    if "gab-se" in enc:
        return "TRAMITADO_GABSE", f"Encaminhamento = {texto(r.get('encaminhamento'))}", sai or ent
    if "aguardando providencias" in enc:
        return "PENDENCIA_CGPAC", "Encaminhamento = Aguardando providências na CGPAC", ent
    if "finalistica" in enc:
        return "DEVOLVIDO_SF", f"Encaminhamento = {texto(r.get('encaminhamento'))}", sai or ent
    if "analise" in enc:
        return "EM_ANALISE", "Encaminhamento = Solicitação em análise", ent
    if ent:
        return "RECEBIDO", "Tem data de entrada na CGPAC", ent
    return "SOLICITADO", "Sem encaminhamento nem entrada na CGPAC", sol


def tipo(v):
    n = norm_txt(v)
    if n.startswith("emiss"):
        return "EMISSAO"
    if n.startswith("convalid"):
        return "CONVALIDACAO"
    return None


def converter(r, hoje=None):
    """Linha da planilha -> (payload do criar_aio, linha de referencia, relatorio)."""
    hoje = hoje or datetime.date.today()
    dominio = cfg("EMAIL_DOMINIO", "cidades.gov.br")
    instr = norm_instrumento(r.get("instrumento"))
    etapas, etapa_desc = parse_etapas(r.get("etapa"))
    em_etapas = bool(sim_nao(r.get("contrato_etapas"))) or len(etapas) > 0
    mun, uf = parse_munuf(r.get("proponente"))
    cod, motivo, data = momento(r)
    data = min(data, hoje) if data else hoje
    login = texto(r.get("responsavel"))
    alertas = []
    if em_etapas and not etapas:
        alertas.append("contrato em etapas sem etapa informada (ficou como etapa única)")
    if not login:
        alertas.append("sem responsável")
    if not as_date(r.get("dt_solicitacao")):
        alertas.append("sem data de solicitação da Caixa")
    if not instr:
        alertas.append("sem nº de instrumento")

    contrato = {
        "nr_instrumento": instr,
        "processo_sei": texto(r.get("processo")),
        "proponente": texto(r.get("proponente")),
        "municipio": mun, "uf": uf,
        "descricao": texto(r.get("descricao")),
        "secretaria": texto(r.get("secretaria")),
        "modalidade": texto(r.get("modalidade")),
        "fase_pac": texto(r.get("fase_pac")),
        "em_etapas": em_etapas,
        "tci": texto(r.get("tci")),
    }
    aio = {
        "etapas": etapas,
        "etapa_descricao": etapa_desc,
        "tipo": tipo(r.get("tipo")),
        "momento": cod,
        "momento_desde": data.isoformat(),
        "responsavel": f"{LOGIN_EMAIL.get(login, login)}@{dominio}" if login else None,
        "processo_sei": texto(r.get("processo")),
        "valor_solicitado": as_num(r.get("valor")),
        "dt_solicitacao_caixa": _iso(r.get("dt_solicitacao")),
        "dt_entrada_cgpac": _iso(r.get("dt_entrada")),
        "dt_saida_cgpac": _iso(r.get("dt_saida")),
        "referencia_solicitacao": texto(r.get("referencia")),
        "os_emitida": sim_nao(r.get("os_emitida")),
        "tgov": sim_nao(r.get("tgov")),
        "aio_automatica_tgov": sim_nao(r.get("aio_automatica_tgov")),
        "aio_automatica_caixa": sim_nao(r.get("aio_automatica_caixa")),
        "problemas": bool(sim_nao(r.get("problemas"))),
        "ressalvas": texto(r.get("ressalvas")),
        "localizacao_sei": texto(r.get("localizacao_sei")),
        "status_sei": texto(r.get("status_sei")),
    }
    payload = {"contrato": contrato, "aio": aio, "autor": "carga-planilha",
               "obs_momento": f"Carga inicial da planilha Informações AIO ({motivo})"}

    referencia = None
    if instr:
        exec_fis = as_num(r.get("exec_fisica"))
        referencia = {
            "nr_instrumento": instr,
            "processo_sei": contrato["processo_sei"],
            "proponente": contrato["proponente"], "municipio": mun, "uf": uf,
            "objeto": contrato["descricao"], "secretaria": contrato["secretaria"],
            "modalidade": contrato["modalidade"],
            "tgov": aio["tgov"], "aio_automatica_tgov": aio["aio_automatica_tgov"],
            "tci": contrato["tci"],
            # planilha traz fração (0,7342); o SACI e o painel usam % (73,42)
            "exec_fisica_pct": round(exec_fis * 100, 4) if exec_fis is not None and exec_fis <= 1.5 else None,
            "dt_ultimo_desbloqueio": _iso(r.get("dt_desbloqueio")),
            "saldo_conta": as_num(r.get("valor_conta")),
            "fontes": ["planilha"],
        }
    relatorio = {
        "linha": r["_linha"], "id_planilha": r.get("id"), "instrumento": instr,
        "processo": contrato["processo_sei"], "municipio_uf": f"{mun or ''}/{uf or ''}",
        "etapas": "Única" if not etapas else " e ".join(map(str, etapas)),
        "tipo": aio["tipo"], "momento": cod, "momento_desde": aio["momento_desde"], "motivo": motivo,
        "status_caixa": texto(r.get("status_caixa")), "encaminhamento": texto(r.get("encaminhamento")),
        "status_sei": aio["status_sei"], "presente_caixa_planilha": texto(r.get("presente_caixa")),
        "responsavel": aio["responsavel"], "alertas": alertas,
    }
    return payload, referencia, relatorio


def _iso(v):
    d = as_date(v)
    return d.isoformat() if d else None
