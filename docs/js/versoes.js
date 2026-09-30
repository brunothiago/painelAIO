// Histórico de versões do painel (espelha VERSOES.md). Ao publicar uma versão
// nova, acrescente no topo da lista e troque ?v= no index.html.
import { $, html, render } from './util.js';

export const VERSOES = [
  {
    v: '1.2.0', data: '30/09/2026', itens: [
      'Cada campo tem uma letra, como no Excel (A = Nº AIO, B = Instrumento…), igual à coluna da planilha exportada.',
      'As letras aparecem no preenchimento do AIO, no cadastro de AIO novo, nos dados do MCID e no cabeçalho da lista.',
      'Botão "Mapa de colunas" com a lista completa (A até AZ). A exportação ganhou fase do PAC, referência da solicitação, saldo, desbloqueio, e-mail GEPAC07 e valor de repasse.',
    ],
  },
  {
    v: '1.1.0', data: '30/09/2026', itens: [
      'Nº sequencial de cada AIO (AIO nº 1, 2, 3…), igual à coluna ID da planilha para os AIOs da carga inicial; os novos recebem o próximo nº.',
      'Busca pelo nº: digite 12 (ou #12) e aperte Enter para abrir o AIO nº 12. Ordenação por nº.',
      'Nº na lista, no detalhe, no quadro, na atividade e na exportação.',
    ],
  },
  {
    v: '1.0.0', data: '29/09/2026', itens: [
      'Primeira versão do Painel AIO com cadastro ao vivo (Supabase).',
      'Momentos do fluxo: Solicitado → Recebido na CGPAC → Em análise → Tramitado ao GAB-SE → Assinado → Concluído, e desvios com observação obrigatória.',
      'Contratos em etapas agrupados pelo instrumento; um AIO por etapa (ou por "2 e 4").',
      'Busca e início do cadastro a partir do SACI/TransfereGov, das listas da Caixa ou de contrato já cadastrado.',
      'Listas da Caixa: importação do .xlsx no próprio painel, presença na lista de convalidação e fila de itens sem cadastro.',
      'Histórico de cada AIO (quem, quando, o quê), aba Atividade, quadro por momento e exportação CSV/Excel.',
    ],
  },
];
export const VERSAO = VERSOES[0].v;

export function abrirVersoes() {
  const raiz = $('#modal-raiz');
  render(raiz, html`<div class="modal" id="modal-versoes"><div class="modal-card" style="max-width:640px">
    <div class="modal-cab"><h2>Versões do Painel AIO</h2><button class="fechar" type="button" data-fechar>×</button></div>
    <div class="modal-corpo">${VERSOES.map((x) => html`<section class="sec" style="margin-bottom:10px"><h4>Versão ${x.v} <span class="muted pequeno">${x.data}</span></h4>
      <ul style="padding-left:18px;font-size:.88rem">${x.itens.map((i) => html`<li style="margin-bottom:4px">${i}</li>`)}</ul></section>`)}</div></div></div>`);
  raiz.querySelector('[data-fechar]').onclick = () => render(raiz, '');
  $('#modal-versoes').onclick = (e) => { if (e.target.id === 'modal-versoes') render(raiz, ''); };
}
