// Mapa único das colunas do painel. A ordem define a LETRA de cada campo,
// igual à coluna na planilha exportada (A = Nº AIO, B = Instrumento, ...).
// A tela de preenchimento, a lista e a exportação usam este mesmo mapa:
// "AIO 12, coluna Y" quer dizer a mesma coisa em todo lugar.
// Para incluir um campo novo, acrescente NO FIM (para não mudar as letras já usadas).
import { html } from './util.js';

export const COLUNAS = [
  ['numero', 'Nº AIO'],
  ['nr_instrumento', 'Instrumento'],
  ['nr_operacao', 'Operação Caixa'],
  ['tci', 'TCI'],
  ['processo_sei', 'Processo SEI'],
  ['municipio', 'Município'],
  ['uf', 'UF'],
  ['proponente', 'Proponente'],
  ['secretaria', 'Secretaria'],
  ['modalidade', 'Modalidade'],
  ['fase_pac', 'Fase do PAC'],
  ['descricao', 'Descrição do objeto'],
  ['em_etapas', 'Contrato em etapas'],
  ['etapas', 'Etapa(s)'],
  ['etapa_descricao', 'Descrição da etapa'],
  ['tipo', 'Emissão ou convalidação'],
  ['momento_nome', 'Momento'],
  ['momento_desde', 'No momento desde'],
  ['dias_no_momento', 'Dias no momento'],
  ['atrasado', 'Atrasado'],
  ['responsavel', 'Responsável'],
  ['valor_solicitado', 'Valor solicitado'],
  ['referencia_solicitacao', 'Referência da solicitação'],
  ['dt_solicitacao_caixa', 'Solicitação da Caixa'],
  ['dt_entrada_cgpac', 'Entrada na CGPAC'],
  ['dt_saida_cgpac', 'Saída da CGPAC'],
  ['dt_assinatura', 'Assinatura'],
  ['dt_conclusao', 'Conclusão (AIO concedida)'],
  ['dias_mcid', 'Dias no MCid'],
  ['dias_cgpac', 'Dias na CGPAC'],
  ['presente_convalidacao', 'Na lista de convalidação da Caixa'],
  ['caixa_listas', 'Listas da Caixa'],
  ['caixa_situacao', 'Situação na Caixa'],
  ['os_emitida', 'O.S. emitida até 03/07/2026'],
  ['tgov', 'No TransfereGov'],
  ['aio_automatica_tgov', 'AIO automática no TGOV'],
  ['aio_automatica_caixa', 'AIO automática na Caixa'],
  ['situacao_aio_tgov', 'AIO no TGOV (situação)'],
  ['dt_emissao_aio_tgov', 'Emissão da AIO no TGOV'],
  ['exec_fisica_pct', 'Execução física (%)'],
  ['saldo_conta', 'Saldo em conta'],
  ['dt_ultimo_desbloqueio', 'Último desbloqueio'],
  ['dt_aio_recebido_email', 'E-mail GEPAC07 recebido'],
  ['ref_valor_repasse', 'Valor de repasse (SACI)'],
  ['problemas', 'Tem problema'],
  ['ressalvas', 'Ressalvas e/ou pendências'],
  ['localizacao_sei', 'Localização no SEI'],
  ['status_sei', 'Status no SEI'],
  ['obs', 'Observações'],
  ['updated_at', 'Última alteração'],
  ['updated_by', 'Alterado por'],
  ['link_saci', 'Link SACI'],
];

/** 0 -> A, 25 -> Z, 26 -> AA ... */
export const colLetra = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };

const LETRA = Object.fromEntries(COLUNAS.map(([k], i) => [k, colLetra(i)]));
const ROTULO = Object.fromEntries(COLUNAS.map(([k, r]) => [k, r]));

export const letra = (k) => LETRA[k] || '';
export const rotulo = (k) => ROTULO[k] || k;

/** Selo com a letra da coluna (vazio se o campo não está no mapa). */
export const selo = (k) => (LETRA[k] ? html`<span class="letra" title="Coluna ${LETRA[k]} da planilha exportada">${LETRA[k]}</span>` : '');

/** Rótulo com selo: "[E] Processo SEI". */
export const rotuloComLetra = (k, texto) => html`${selo(k)}${texto || rotulo(k)}`;
