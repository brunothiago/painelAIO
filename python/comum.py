"""
Funções comuns dos scripts do painelAIO.

- Configuração: lê ../config.env (DB_* do banco MCID; SUPABASE_URL e
  SUPABASE_SERVICE_KEY do Supabase; EMAIL_DOMINIO dos logins).
- MCID: conexão psycopg2 (só funciona na VPN).
- Supabase: cliente REST simples por HTTPS (porta 443), que passa pela rede do
  ministério mesmo quando as portas do Postgres (5432/6543) estão bloqueadas.
- Normalizadores dos valores da planilha "Informações AIO" e das listas da Caixa.
"""

import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import unicodedata

RAIZ = pathlib.Path(__file__).resolve().parent.parent
RELATORIOS = RAIZ / "relatorios"
MAPA_CAIXA = RAIZ / "docs" / "js" / "caixa_mapa.json"

try:
    from dotenv import load_dotenv
    load_dotenv(RAIZ / "config.env")
except ImportError:  # sem python-dotenv: lê o arquivo na mão
    _cfg = RAIZ / "config.env"
    if _cfg.exists():
        for _l in _cfg.read_text().splitlines():
            if "=" in _l and not _l.strip().startswith("#"):
                _k, _v = _l.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())


def cfg(nome, padrao=None, obrigatorio=False):
    v = os.getenv(nome, padrao)
    if obrigatorio and not v:
        sys.exit(f"Falta {nome} no config.env (veja config.env.example).")
    return v


# ---------------------------------------------------------------------------
# Banco MCID (VPN)
# ---------------------------------------------------------------------------

def get_mcid_connection():
    """Mesma conexão do painelcargaaio (aio_pipeline.get_db_connection)."""
    import psycopg2
    for k in ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        cfg(k, obrigatorio=True)
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        connect_timeout=10,
    )


def schema_mcid():
    s = os.getenv("DB_SCHEMA", "se_cgpac")
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", s):
        sys.exit(f"DB_SCHEMA inválido: {s!r}")
    return s


# ---------------------------------------------------------------------------
# Supabase (HTTPS)
# ---------------------------------------------------------------------------

class ErroSupabase(RuntimeError):
    pass


class SupabaseREST:
    """Cliente mínimo do PostgREST do Supabase usando a service key (ignora RLS)."""

    def __init__(self, url=None, chave=None):
        import requests
        self._req = requests
        self.url = (url or cfg("SUPABASE_URL", obrigatorio=True)).rstrip("/")
        chave = chave or cfg("SUPABASE_SERVICE_KEY", obrigatorio=True)
        self.base = self.url + "/rest/v1"
        self.h = {"apikey": chave, "Content-Type": "application/json"}
        if chave.startswith("eyJ"):  # chave antiga (JWT service_role) também vai no Authorization
            self.h["Authorization"] = f"Bearer {chave}"

    def _checa(self, r):
        if r.status_code >= 300:
            try:
                d = r.json()
                msg = d.get("message") or d
            except ValueError:
                msg = r.text
            raise ErroSupabase(f"HTTP {r.status_code}: {msg}")
        return r

    def select(self, tabela, colunas="*", filtros=None, ordem=None, lote=1000):
        """Lê todas as linhas (paginando). filtros: dict no formato PostgREST, ex. {"id": "eq.3"}."""
        out, inicio = [], 0
        while True:
            params = {"select": colunas, "limit": lote, "offset": inicio}
            if filtros:
                params.update(filtros)
            if ordem:
                params["order"] = ordem
            r = self._checa(self._req.get(f"{self.base}/{tabela}", headers=self.h, params=params, timeout=60))
            parte = r.json()
            out.extend(parte)
            if len(parte) < lote:
                return out
            inicio += lote

    def upsert(self, tabela, linhas, on_conflict, lote=500):
        h = dict(self.h, Prefer="resolution=merge-duplicates,return=minimal")
        for i in range(0, len(linhas), lote):
            self._checa(self._req.post(f"{self.base}/{tabela}", headers=h,
                                       params={"on_conflict": on_conflict},
                                       data=json.dumps(linhas[i:i + lote], default=_json_default),
                                       timeout=120))

    def insert(self, tabela, linhas):
        h = dict(self.h, Prefer="return=minimal")
        self._checa(self._req.post(f"{self.base}/{tabela}", headers=h,
                                   data=json.dumps(linhas, default=_json_default), timeout=120))

    def rpc(self, nome, payload):
        r = self._checa(self._req.post(f"{self.base}/rpc/{nome}", headers=self.h,
                                       data=json.dumps(payload, default=_json_default), timeout=120))
        return r.json() if r.text else None

    def log(self, script, direcao, linhas, ok=True, detalhe=None):
        try:
            self.insert("sync_log", [{"script": script, "direcao": direcao, "linhas": linhas,
                                      "ok": ok, "detalhe": detalhe or {}}])
        except ErroSupabase as e:
            print(f"(aviso) não gravou sync_log: {e}")


def _json_default(o):
    if isinstance(o, (datetime.date, datetime.datetime)):
        return o.isoformat()
    if hasattr(o, "__float__"):
        return float(o)
    raise TypeError(f"não serializável: {type(o)}")


# ---------------------------------------------------------------------------
# Normalizadores
# ---------------------------------------------------------------------------

UFS = {"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
       "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"}

ESTADOS = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA",
    "ceara": "CE", "distrito federal": "DF", "espirito santo": "ES", "goias": "GO",
    "maranhao": "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
    "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE", "piaui": "PI",
    "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
    "rondonia": "RO", "roraima": "RR", "santa catarina": "SC", "sao paulo": "SP",
    "sergipe": "SE", "tocantins": "TO",
}

VAZIOS = {"", "-", "na", "n/a", "#value!", "#n/a", "#ref!", "none", "null"}


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c))


def norm_txt(s):
    """Minúsculas, sem acento, espaços simples (igual ao norm_txt do banco + trim)."""
    return re.sub(r"\s+", " ", sem_acento(s or "").lower()).strip()


def texto(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip()
    return None if s.lower() in VAZIOS else s


def sim_nao(v):
    s = norm_txt(v)
    if not s or s in VAZIOS:
        return None
    if s in ("sim", "s", "x", "yes", "true", "verdadeiro") or s.startswith("sim"):
        return True
    if s in ("nao", "n", "no", "false", "falso") or s.startswith("nao"):
        return False
    return None


def as_date(v):
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    if isinstance(v, (int, float)):
        if 40000 <= v <= 60000:  # número de série do Excel plausível (2009–2064)
            return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(v))).date()
        return None
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(s[:19], fmt).date()
        except ValueError:
            pass
    return None


def as_num(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("\xa0", " ").strip()
    if s.lower() in VAZIOS:
        return None
    s = re.sub(r"[^\d,.-]", "", s)
    if "," in s:                       # formato brasileiro 1.299.609,84
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def norm_instrumento(v):
    """Só dígitos antes de "/" ("985333/2025" -> "985333"). Igual ao banco."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    d = re.sub(r"\D", "", str(v).split("/")[0])
    return d or None


def norm_operacao(v):
    """Operação Caixa: dígitos antes do DV, sem zeros à esquerda ("0396120-18" -> "396120")."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    d = re.sub(r"\D", "", str(v).split("-")[0]).lstrip("0")
    return d or None


def parse_etapas(v):
    """'Única' -> ([], None); 3 -> ([3], None); '2 e 4' -> ([2, 4], None);
    'Etapa 1 – Feo/Espanhol - Projetos' -> ([1], 'Feo/Espanhol - Projetos')."""
    if v is None:
        return [], None
    if isinstance(v, (int, float)):
        return [int(v)], None
    s = str(v).replace("\xa0", " ").strip()
    if not s or norm_txt(s) in ("unica", "etapa unica") or norm_txt(s) in VAZIOS:
        return [], None
    partes = re.split(r"\s+[–—-]\s*|\s*[–—]\s*", s, maxsplit=1)
    nums = [int(n) for n in re.findall(r"\d+", partes[0])]
    desc = partes[1].strip() if len(partes) > 1 and partes[1].strip() else None
    return sorted(set(nums)), desc


def parse_munuf(v):
    """Separa município e UF de 'Município de X/UF' ou 'Estado/Cidade'."""
    s = texto(v)
    if not s:
        return None, None
    s = s.rstrip(".")
    partes = [p.strip() for p in s.split("/") if p.strip()]
    uf = None
    for i, p in enumerate(partes):
        if p.upper() in UFS:
            uf = p.upper()
            partes.pop(i)
            break
    if uf is None:
        for i, p in enumerate(partes):
            if norm_txt(p) in ESTADOS:
                uf = ESTADOS[norm_txt(p)]
                partes.pop(i)
                break
    mun = "/".join(partes) or None
    if mun:
        mun = re.sub(r"^(munic[ií]pio|prefeitura municipal|estado)\s+(de|do|da)\s+", "", mun, flags=re.I).strip()
    return mun, uf


def sha256_arquivo(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def carimbo():
    return datetime.datetime.now().strftime("%Y-%m-%d_%H%M")


def salvar_csv(nome, linhas, colunas):
    """Grava relatório CSV (separador ;, UTF-8 com BOM para abrir no Excel)."""
    import csv
    RELATORIOS.mkdir(exist_ok=True)
    caminho = RELATORIOS / f"{nome}_{carimbo()}.csv"
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=colunas, delimiter=";", extrasaction="ignore")
        w.writeheader()
        for l in linhas:
            w.writerow({k: ("; ".join(map(str, v)) if isinstance(v, (list, tuple)) else v) for k, v in l.items()})
    return caminho
