"""
Leitura das listas da Caixa em .xlsx.

A planilha pode ter vários blocos empilhados ("Tabela 1 ... E-mail Caixa de
15/07/2026", depois o cabeçalho, depois as linhas), cada um começando numa
coluna diferente. O leitor procura o cabeçalho pelo texto (célula "Operação")
e usa docs/js/caixa_mapa.json — o mesmo mapa do upload no painel.
"""

import json
import re

import openpyxl

from comum import MAPA_CAIXA, as_date, as_num, norm_instrumento, norm_operacao, norm_txt, parse_etapas, sim_nao, texto

_MAPA = json.loads(MAPA_CAIXA.read_text(encoding="utf-8"))
_SINONIMOS = {s: campo for campo, lista in _MAPA["campos"].items() for s in lista}
_TIPOS = _MAPA["tipos"]


def _norm_cab(v):
    return norm_txt(v).rstrip("?").strip() if v is not None else ""


def _serial(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _titulo_tabela(celula):
    s = texto(celula)
    if not s:
        return None
    m = re.match(r"^\s*tabela\s+(\d+)", s, re.I)
    if not m:
        return None
    data = re.search(r"(\d{2})/(\d{2})/(\d{4})", s)
    return {
        "tabela": f"T{m.group(1)}",
        "titulo": str(celula).split("\n")[0].strip(),
        "recebida_em": f"{data.group(3)}-{data.group(2)}-{data.group(1)}" if data else None,
    }


def _converter(campo, v):
    tipo = _TIPOS.get(campo)
    if tipo == "numero":
        return as_num(v)
    if tipo == "data":
        d = as_date(v)
        return d.isoformat() if d else None
    if tipo == "simnao":
        return sim_nao(v)
    return texto(v)


def ler_listas(caminho):
    """Devolve a lista de blocos: {tabela, titulo, recebida_em, aba, linha_cabecalho, itens:[...]}"""
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    blocos = []
    for ws in wb.worksheets:
        linhas = list(ws.iter_rows(values_only=True))
        titulo_atual = None
        i = 0
        while i < len(linhas):
            row = linhas[i] or ()
            for c in row:
                t = _titulo_tabela(c)
                if t:
                    titulo_atual = t
                    # a data do e-mail às vezes vem só na linha seguinte (descrição)
                    break
            cabs = [_norm_cab(c) for c in row]
            if _MAPA["cabecalho_obrigatorio"] in cabs and sum(1 for c in cabs if c in _SINONIMOS) >= 3:
                col_campo = {}
                for j, c in enumerate(row):
                    if c is None:
                        continue
                    campo = _SINONIMOS.get(_norm_cab(c))
                    if campo and campo not in col_campo.values():
                        col_campo[j] = campo
                bloco = dict(titulo_atual or {"tabela": "OUTRA", "titulo": None, "recebida_em": None})
                bloco.update(aba=ws.title, linha_cabecalho=i + 1, itens=[])
                i += 1
                while i < len(linhas) and any(v not in (None, "") for v in (linhas[i] or ())):
                    dados = linhas[i]
                    if any(_titulo_tabela(c) for c in dados):
                        break
                    item = {"raw": {}}
                    for j, v in enumerate(dados):
                        if v in (None, ""):
                            continue
                        nome = texto(row[j]) if j < len(row) and row[j] is not None else f"col{j + 1}"
                        item["raw"][nome] = _serial(v)
                        campo = col_campo.get(j)
                        if campo == "etapa":
                            nums, desc = parse_etapas(v)
                            item["etapa_num"] = nums[0] if nums else None
                            item["etapa_texto"] = texto(v)
                        elif campo == "nr_instrumento":
                            item["nr_instrumento"] = norm_instrumento(v)
                        elif campo == "nr_operacao":
                            item["nr_operacao"] = norm_operacao(v)
                        elif campo:
                            item[campo] = _converter(campo, v)
                    if item.get("nr_instrumento") or item.get("nr_operacao"):
                        item["linha"] = i + 1
                        bloco["itens"].append(item)
                    i += 1
                blocos.append(bloco)
                titulo_atual = None
                continue
            i += 1
    return blocos
