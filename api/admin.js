/* Acesso admin: com a senha certa, devolve a planilha (.xlsx) com todos os pedidos. Não há painel.
   A senha é conferida aqui no servidor, contra um hash (scrypt) — ela nunca vai para a página.
   Para trocar a senha sem mexer no código, defina a variável ADMIN_SENHA na Vercel.
   POST { senha } -> arquivo pedidos-camiseta-AAAA-MM-DD-HHhMM.xlsx (abas Pedidos, Itens e Tamanhos) */
import { HttpError, rota, readJSON, bancoPronto, dentroDoLimite, ipDe, listarPedidos, confereSenha } from "./_lib.js";
import { planilha } from "./_xlsx.js";
import { PRODUTO, RETIRADA, PAGAMENTO } from "../produto.js";

const HASH_SENHA = "W+jQnwqgrk0csbugEIv7pA==:j1mhphb2aEH67XMpgY/3sClbiRR5GOPTlr69lDSzIOc="; // hash da senha combinada (maiúsculas e minúsculas contam)

const POST = async (req) => {
  if (bancoPronto() && !(await dentroDoLimite("cam:tentativas:" + ipDe(req), 10, 15 * 60))) {
    throw new HttpError(429, "Muitas tentativas. Espere 15 minutos e tente de novo.");
  }
  const body = await readJSON(req, 2_000);
  if (!confereSenha(body.senha, HASH_SENHA, "ADMIN_SENHA")) throw new HttpError(401, "Senha incorreta.");
  if (!bancoPronto()) throw new HttpError(503, "O banco de dados ainda não foi configurado. Veja o README, seção Acesso admin.");

  const pedidos = (await listarPedidos()).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
  const arquivo = planilha(montarAbas(pedidos));
  return new Response(arquivo, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pedidos-camiseta-${carimbo()}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Pedidos": String(pedidos.length),
    },
  });
};

export default rota({ POST });

/* ===================== conteúdo da planilha ===================== */
const STATUS = {
  "aguardando-boleto": "Pedido registrado", aguardando: "Aguardando pagamento", pago: "Pago",
  "em análise": "Em análise", recusado: "Recusado", cancelado: "Cancelado",
};
const METODO = { PIX: "Pix", CREDIT_CARD: "Cartão de crédito", DEBIT_CARD: "Cartão de débito", BOLETO: "Boleto PagBank" };

const ehBoleto = (p) => p.forma === "boleto";
const formaDe = (p) => ehBoleto(p) ? "Boleto" : ["PagBank", METODO[p.pagamento?.metodo]].filter(Boolean).join(" · ");
const statusDe = (p) => STATUS[p.status] || p.status || "";
const entregaDe = (p) => p.entrega?.tipo === "RETIRADA" ? (RETIRADA?.nome || "Retirada") : p.entrega?.tipo ? `Correios ${p.entrega.tipo}` : "";
// entra na contagem de produção: pedido no boleto ou pago no PagBank (fora cancelados e recusados)
const conta = (p) => !["cancelado", "recusado"].includes(p.status) && (ehBoleto(p) || ["pago", "em análise"].includes(p.status));

const cpfFmt = (c) => (c = String(c || "").replace(/\D/g, "")).length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : c;
function celularDe(c = {}) {
  const n = String(c.celular || `${c.area || ""}${c.numero || ""}`).replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (n.length === 10) return n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return n;
}
const modeloDoItem = (i) => i.modelo || PRODUTO.modelos[0].nome;
const itensTexto = (p) => (p.itens || []).map((i) => `${i.qtd}× ${modeloDoItem(i)} ${i.tamanho}${PRODUTO.cores.length > 1 ? ` (${i.cor})` : ""}`).join("; ");

function carimbo(ms = Date.now()) {
  const d = new Date(ms - 3 * 3600_000), z = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}-${z(d.getUTCHours())}h${z(d.getUTCMinutes())}`;
}

function montarAbas(pedidos) {
  const nParcelas = Math.max(PAGAMENTO.boleto?.parcelasMax || 1, ...pedidos.map((p) => p.pagamento?.valores?.length || 0));
  // Cada coluna diz como tirar o valor do pedido. As "opcionais" (dados que só o PagBank traz) só entram
  // na planilha quando algum pedido tem o dado; no boleto a lista de cadastrados traz só o nome.
  const endereco = (p) => p.entrega?.endereco || {};
  const pagoEm = (p) => { const t = Date.parse(p.pagamento?.pagoEm || ""); return Number.isFinite(t) ? t : ""; };
  const colunas = [
    { titulo: "Data", tipo: "data", largura: 17, valor: (p) => p.criadoEm, rodape: () => "Total" },
    { titulo: "Pedido", largura: 28, valor: (p) => p.ref, rodape: (l) => `${l.length} pedido(s)` },
    { titulo: "Pagamento", largura: 18, valor: formaDe },
    { titulo: "Status", largura: 20, valor: statusDe },
    { titulo: "Nome", largura: 34, valor: (p) => p.cliente?.nome },
    { titulo: "Nome confirmado", largura: 34, valor: (p) => p.cliente?.nomeConfirmado },
    { titulo: "CPF", largura: 15, valor: (p) => cpfFmt(p.cliente?.cpf), opcional: true },
    { titulo: "Celular", largura: 16, valor: (p) => celularDe(p.cliente), opcional: true },
    { titulo: "E-mail", largura: 30, valor: (p) => p.cliente?.email, opcional: true },
    { titulo: "Peças", tipo: "inteiro", largura: 8, valor: (p) => p.pecas ?? (p.itens || []).reduce((s, i) => s + i.qtd, 0), soma: true },
    { titulo: "Itens", largura: 44, valor: itensTexto },
    { titulo: "Camisetas", tipo: "moeda", largura: 13, valor: (p) => p.subtotal, soma: true },
    { titulo: "Entrega", largura: 32, valor: entregaDe },
    { titulo: "Frete", tipo: "moeda", largura: 11, valor: (p) => p.entrega?.valor ?? 0, soma: true },
    { titulo: "Total", tipo: "moeda", largura: 13, valor: (p) => p.total, soma: true },
    { titulo: "Parcelas", tipo: "inteiro", largura: 9, valor: (p) => p.pagamento?.parcelas || (ehBoleto(p) ? 1 : "") },
    ...Array.from({ length: nParcelas }, (_, i) => ({ titulo: `Parcela ${i + 1}`, tipo: "moeda", largura: 12, valor: (p) => p.pagamento?.valores?.[i] ?? "" })),
    { titulo: "Prazo (dias úteis)", tipo: "inteiro", largura: 17, valor: (p) => p.entrega?.prazo ?? "" },
    { titulo: "CEP", largura: 11, valor: (p) => (endereco(p).cep ? endereco(p).cep.replace(/(\d{5})(\d{3})/, "$1-$2") : "") },
    { titulo: "Endereço", largura: 40, valor: (p) => { const e = endereco(p); return [e.rua, e.numero].filter(Boolean).join(", ") + (e.complemento ? ` - ${e.complemento}` : ""); } },
    { titulo: "Bairro", largura: 20, valor: (p) => endereco(p).bairro },
    { titulo: "Cidade", largura: 22, valor: (p) => endereco(p).cidade },
    { titulo: "UF", largura: 5, valor: (p) => endereco(p).uf },
    { titulo: "Pago em (PagBank)", tipo: "data", largura: 17, valor: pagoEm, opcional: true },
  ].filter((c) => !c.opcional || pedidos.some((p) => c.valor(p) !== "" && c.valor(p) != null));
  const colPedidos = colunas.map(({ titulo, tipo, largura }) => ({ titulo, tipo, largura }));
  const linhasPedidos = pedidos.map((p) => colunas.map((c) => c.valor(p)));
  const vale = pedidos.filter(conta);
  const totalPedidos = colunas.map((c) => c.rodape ? c.rodape(pedidos) : c.soma ? pedidos.reduce((s, p) => s + (Number(c.valor(p)) || 0), 0) : "");

  const colItens = [
    { titulo: "Data", tipo: "data", largura: 17 },
    { titulo: "Pedido", largura: 28 },
    { titulo: "Nome", largura: 34 },
    { titulo: "Pagamento", largura: 18 },
    { titulo: "Status", largura: 20 },
    { titulo: "Modelo", largura: 12 },
    { titulo: "Tamanho", largura: 10 },
    { titulo: "Cor", largura: 12 },
    { titulo: "Quantidade", tipo: "inteiro", largura: 11 },
    { titulo: "Valor unitário", tipo: "moeda", largura: 14 },
    { titulo: "Valor", tipo: "moeda", largura: 13 },
    { titulo: "Entrega", largura: 32 },
  ];
  const linhasItens = pedidos.flatMap((p) => (p.itens || []).map((i) => [
    p.criadoEm, p.ref, p.cliente?.nome, formaDe(p), statusDe(p),
    modeloDoItem(i), i.tamanho, i.cor, i.qtd, i.unitario, (i.unitario || 0) * i.qtd, entregaDe(p),
  ]));

  // grade completa de modelos e tamanhos, mesmo os que ainda não tiveram pedido
  const grade = PRODUTO.modelos.flatMap((m) => m.tamanhos.map((t) => ({ modelo: m.nome, tamanho: t, pecas: 0, pedidos: new Set() })));
  for (const p of vale) for (const i of p.itens || []) {
    let g = grade.find((x) => x.modelo === modeloDoItem(i) && x.tamanho === i.tamanho);
    if (!g) grade.push(g = { modelo: modeloDoItem(i), tamanho: i.tamanho, pecas: 0, pedidos: new Set() });
    g.pecas += i.qtd; g.pedidos.add(p.ref);
  }
  const colTamanhos = [
    { titulo: "Modelo", largura: 14 }, { titulo: "Tamanho", largura: 10 },
    { titulo: "Peças", tipo: "inteiro", largura: 9 }, { titulo: "Pedidos", tipo: "inteiro", largura: 9 },
  ];

  return [
    { nome: "Pedidos", colunas: colPedidos, linhas: linhasPedidos, rodape: [totalPedidos] },
    { nome: "Itens", colunas: colItens, linhas: linhasItens },
    {
      nome: "Tamanhos", colunas: colTamanhos,
      linhas: grade.map((g) => [g.modelo, g.tamanho, g.pecas, g.pedidos.size]),
      rodape: [
        ["Total", "", grade.reduce((s, g) => s + g.pecas, 0), vale.length],
        ["Conta os pedidos no boleto e os pagos no PagBank (fora cancelados, recusados e pagamentos não concluídos)."],
      ],
    },
  ];
}
