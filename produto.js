/* Dados da loja e da camiseta. A página e as rotas da API leem este mesmo arquivo:
   o preço cobrado no PagBank e o pacote usado no frete saem daqui. Valores em centavos. */

export const EVENTO = {
  nucleo: "Núcleo Estrela Bonita",
  titulo: "Inauguração do Templo",
  ano: 2027,
  data: "",       // opcional, ex.: "15 de maio de 2027"; aparece no topo da página
  frase: "A esperança planta, o amor cultiva e a união faz o sonho acontecer.",
  // Imagens do projeto do templo, na ordem em que aparecem na seção "O templo".
  templo: [
    { src: "fotos/templo-fachada.webp", legenda: "A fachada e os três arcos da entrada: a estrela, o sol e a lua." },
    { src: "fotos/templo-salao.webp", legenda: "O salão, com o teto em madeira e as portas abertas para o jardim." },
    { src: "fotos/templo-salao-fundo.webp", legenda: "O salão visto do fundo, com a mesa à frente." },
  ],
};

/* Textos de quem fala sobre o templo, na seção "Palavras". Enquanto os parágrafos estiverem vazios,
   a página mostra o espaço reservado. Um item da lista por parágrafo; foto é o retrato (quadrado). */
export const TEXTOS = [
  {
    nome: "Marcelo Martinatti", papel: "Mestre Representante", titulo: "", foto: "fotos/marcelo.webp",
    paragrafos: [
      "A alegria de ver, após 18 anos de uma linda história de trabalho, zelo e dedicação de valorosos irmãos, a concretização deste sonho, o novo Templo do Estrela Bonita!",
      "Lançamos essa campanha com a confecção de uma belíssima camiseta, que registra esse momento tão especial e histórico, com um nobre objetivo de arrecadar recursos para aquisição de equipamentos e itens necessários ao Templo.",
      "Faça parte desta história, pois ela também é sua!",
    ],
  },
  {
    nome: "Christian Santana", papel: "Presidente", titulo: "", foto: "fotos/christian.webp",
    paragrafos: [
      "Meus caríssimos irmãos e amigos,",
      "No dia 01/11, lançamos uma campanha especial de venda de camisetas comemorativas pela inauguração do novo templo do nosso amado Núcleo Estrela Bonita.",
      "Essa iniciativa tem como objetivo arrecadar recursos para a aquisição de itens importantes para nosso novo templo, que estamos construindo com tanto carinho e dedicação.",
      "Sabemos que este período tem exigido um esforço financeiro significativo de toda a nossa irmandade. Ainda assim, queremos convidar todos os irmãos, amigos, familiares e pessoas que simpatizam com nosso trabalho a participarem dessa campanha.",
      "A camiseta foi preparada com muito carinho e traz uma bela imagem da fachada do novo templo. Além de ser uma lembrança especial desse momento, cada camiseta adquirida representa uma contribuição para essa conquista que é de todos nós.",
      "Contamos com a colaboração de todos para, mais uma vez, demonstrarmos a força da nossa união!",
      "Unidos, continuamos construindo e realizando sonhos!",
    ],
  },
];

/* Vídeo da seção "Vídeo". Preencha UM dos dois: o link do YouTube (ex.: https://youtu.be/xxxx)
   ou o caminho de um arquivo .mp4 (ex.: "fotos/video.mp4"). Vazios: aparece "Vídeo em breve". */
export const VIDEO = {
  titulo: "O templo em movimento",
  texto: "",
  youtube: "https://youtu.be/Acw1NEagnQA",
  arquivo: "",
  capa: "fotos/templo-salao.webp",
};

/* Formas de pagamento.
   boleto: só para quem está na lista de cadastrados (api/_cadastrados.js), em até parcelasMax vezes.
     Não passa pelo PagBank: o pedido fica registrado e o valor vai no boleto do mês subsequente (a planilha do admin traz tudo).
   pagbank: Pix e cartão pelo PagBank. Enquanto estiver desligado (ativo: false), não aparece na loja
     e a rota do checkout recusa o pedido; para liberar, troque para true e configure as variáveis do PagBank. */
export const PAGAMENTO = {
  boleto: {
    ativo: true,
    parcelasMax: 3,
    publico: "Para irmãos cadastrados no núcleo",
    aviso: "O valor irá no seu boleto do mês subsequente. Se parcelar, cada parcela vai no boleto de um mês.",
    semNome: "Não encontrou o seu nome? Fale com o núcleo.",
  },
  pagbank: {
    ativo: false,
    metodos: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  },
};

/* Divide um valor (em centavos) em n parcelas; o centavo que sobra vai na primeira. */
export function parcelasDe(total, n) {
  const base = Math.floor(total / n), resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? resto : 0));
}

/* Retirada grátis: aparece como opção junto do frete (e já vem marcada). Com ela, o pedido não pede endereço nem cobra frete. */
export const RETIRADA = {
  ativa: true,
  nome: "Retirada no Núcleo Estrela Bonita",
  aviso: "Retire a sua camiseta no núcleo.",
};

// Quem vende: aparece no rodapé ("Vendido por ...") e na fatura do cartão.
export const LOJA = {
  nome: "Cruzeiro Gestão",
  site: "https://www.cruzeirogestao.com.br/",
  // Preencha o que quiser mostrar no rodapé; campos vazios não aparecem.
  email: "",
  whatsapp: "",   // só números, com DDI e DDD: 5531999999999
  instagram: "",  // sem @
  cnpj: "",
  // Até 17 caracteres: é o nome que aparece na fatura do cartão.
  descricaoFatura: "CRUZEIROGESTAO",
};

export const PRODUTO = {
  id: "camiseta-templo-estrela-bonita",
  nome: "Camiseta da Inauguração do Templo",
  edicao: "Edição comemorativa · 2027",
  descricao: "A camiseta comemorativa da inauguração do templo do Núcleo Estrela Bonita, com a fachada desenhada a traço, a estrela e a frase da inauguração.",
  preco: 10000,
  precoDe: null,         // preço riscado; null para esconder
  parcelasMax: 6,        // parcelas no cartão (PagBank, quando liberado)
  parcelasSemJuros: 3,   // quantas delas sem juros para o cliente
  maxPorPedido: 30,
  diasParaPostar: 3,     // dias úteis até a postagem; somado ao prazo dos Correios

  // A arte da frente, em traço com fundo transparente (a página a pinta na cor do tecido).
  estampa: "fotos/estampa.webp",
  // Foto da capa (topo da página): o modelo vestindo a camiseta, recortado sem fundo.
  capa: "fotos/capa-modelo.webp",
  // O templo a traço (sem a frase), usado como ilustração esmaecida no fundo da capa.
  traco: "fotos/templo-traco.webp",
  // fotos: fotos reais da camiseta naquela cor. Sem foto, a página mostra a camiseta ilustrada com a estampa.
  cores: [
    {
      id: "amarela", nome: "Amarela", hex: "#a06d2a",
      // na ordem da galeria: frente e costas sem modelo, depois com o modelo
      fotos: ["fotos/camiseta-frente.webp", "fotos/camiseta-costas.webp", "fotos/camiseta-modelo-frente.webp", "fotos/camiseta-modelo-lado.webp"],
    },
  ],

  // Modelos à venda, cada um com os seus tamanhos e medidas da peça em centímetros
  // (tórax: de uma axila à outra, com a peça esticada; comprimento: do ombro à barra).
  // preco é opcional: sem ele, o modelo custa o preço acima.
  modelos: [
    {
      id: "basica", nome: "Básica", detalhe: "Adulto",
      tamanhos: ["PP", "P", "M", "G", "GG", "G1", "G3", "G5"],
      medidas: {
        PP: { torax: 46, comprimento: 65 }, P: { torax: 49, comprimento: 67 }, M: { torax: 52, comprimento: 69 },
        G: { torax: 55, comprimento: 71 }, GG: { torax: 58, comprimento: 73 }, G1: { torax: 61, comprimento: 75 },
        G3: { torax: 65, comprimento: 78 }, G5: { torax: 68, comprimento: 81 },
      },
    },
    {
      id: "infantil", nome: "Infantil", detalhe: "2 a 10 anos",
      tamanhos: ["2", "4", "6", "8", "10"],
      medidas: {
        2: { torax: 33, comprimento: 43 }, 4: { torax: 35, comprimento: 46 }, 6: { torax: 37, comprimento: 49 },
        8: { torax: 39, comprimento: 52 }, 10: { torax: 41, comprimento: 55 },
      },
    },
  ],

  // Embalagem de uma peça, para o cálculo do frete (correios.js).
  pacote: { pesoKg: 0.25, comprimento: 30, largura: 22, alturaPorPeca: 3, alturaMin: 4 },
};

export const modeloDe = (id) => PRODUTO.modelos.find((m) => m.id === id);
export const precoDoModelo = (id) => modeloDe(id)?.preco ?? PRODUTO.preco;

/* Pacote para uma quantidade de peças: as camisetas vão empilhadas na mesma caixa. */
export function pacotePara(qtd) {
  const p = PRODUTO.pacote;
  return {
    pesoKg: Math.round(p.pesoKg * qtd * 1000) / 1000,
    comprimento: p.comprimento,
    largura: p.largura,
    altura: Math.min(100, Math.max(p.alturaMin, Math.ceil(p.alturaPorPeca * qtd))),
  };
}
