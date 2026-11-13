/* Acesso admin: com a senha certa, devolve a planilha (.xlsx) com os pedidos que valem.
   A senha é conferida aqui no servidor, contra um hash (scrypt) — ela nunca vai para a página.
   Para trocar a senha sem mexer no código, defina a variável ADMIN_SENHA na Vercel.
   POST { senha } -> arquivo pedidos-camiseta-AAAA-MM-DD-HHhMM.xlsx
   (abas Painel, Pedidos, Itens, Tamanhos e Por pessoa) */
import { HttpError, rota, readJSON, bancoPronto, dentroDoLimite, ipDe, listarPedidos, confereSenha } from "./_lib.js";
import { planilha, PAINEL } from "./_xlsx.js";
import { PRODUTO, RETIRADA, PAGAMENTO, EVENTO } from "../produto.js";

const HASH_SENHA = "W+jQnwqgrk0csbugEIv7pA==:j1mhphb2aEH67XMpgY/3sClbiRR5GOPTlr69lDSzIOc="; // hash da senha combinada (maiúsculas e minúsculas contam)

const POST = async (req) => {
  if (bancoPronto() && !(await dentroDoLimite("cam:tentativas:" + ipDe(req), 10, 15 * 60))) {
    throw new HttpError(429, "Muitas tentativas. Espere 15 minutos e tente de novo.");
  }
  const body = await readJSON(req, 2_000);
  if (!confereSenha(body.senha, HASH_SENHA, "ADMIN_SENHA")) throw new HttpError(401, "Senha incorreta.");
  if (!bancoPronto()) throw new HttpError(503, "O banco de dados ainda não foi configurado. Veja o README, seção Acesso admin.");

  // Só vão para a planilha os pedidos que valem: no boleto (fora os cancelados) e Pix/cartão já pagos no PagBank.
  // Cancelados, recusados e pagamentos não concluídos ficam só no painel de pedidos (o cancelado pode ser reativado lá).
  const pedidos = (await listarPedidos())
    .filter(conta)
    .sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
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

/* ===================== datas e meses (horário de Brasília) ===================== */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const brasilia = (ms) => new Date(ms - 3 * 3600_000);
const z2 = (n) => String(n).padStart(2, "0");
const dataHora = (ms) => { const d = brasilia(ms); return `${z2(d.getUTCDate())}/${z2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} às ${z2(d.getUTCHours())}:${z2(d.getUTCMinutes())}`; };
const diaChave = (ms) => { const d = brasilia(ms); return `${d.getUTCFullYear()}-${z2(d.getUTCMonth() + 1)}-${z2(d.getUTCDate())}`; };
const diaRotulo = (ms) => { const d = brasilia(ms); return `${z2(d.getUTCDate())}/${z2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} (${SEMANA[d.getUTCDay()]})`; };
// a 1ª parcela vai no boleto do mês seguinte ao pedido; as demais, nos meses depois
function mesDaParcela(ms, i) {
  const d = brasilia(ms), t = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1 + i;
  return { chave: t, rotulo: `${MESES[t % 12]}/${Math.floor(t / 12)}` };
}
const pessoaDe = (p) => p.cliente?.cadastroId || String(p.cliente?.nome || "").trim().toLowerCase();
const pecasDe = (p) => p.pecas ?? (p.itens || []).reduce((s, i) => s + i.qtd, 0);
const soma = (lista, f) => lista.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/* Junta os pedidos no boleto de cada pessoa (uma pessoa pode comprar mais de uma vez):
   quantidade, valor, parcelamento de cada pedido e quanto vai no boleto de cada mês. */
function juntarPorPessoa(pedidos) {
  const pessoas = new Map(), meses = new Map();
  for (const p of pedidos.filter((x) => ehBoleto(x) && !["cancelado", "recusado"].includes(x.status))) {
    const k = pessoaDe(p);
    if (!pessoas.has(k)) pessoas.set(k, { nome: p.cliente?.nome || "", confirmados: [], pedidos: [], pecas: 0, total: 0, parcelas: [], porMes: new Map() });
    const x = pessoas.get(k);
    x.pedidos.push(p.ref); x.pecas += pecasDe(p); x.total += p.total || 0;
    const conf = p.cliente?.nomeConfirmado;
    if (conf && !x.confirmados.includes(conf)) x.confirmados.push(conf);
    const valores = p.pagamento?.valores?.length ? p.pagamento.valores : [p.total || 0];
    x.parcelas.push(`${valores.length}x`);
    valores.forEach((v, i) => {
      const m = mesDaParcela(p.criadoEm, i);
      meses.set(m.chave, m.rotulo);
      x.porMes.set(m.chave, (x.porMes.get(m.chave) || 0) + v);
    });
  }
  return {
    lista: [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    meses: [...meses.entries()].sort((a, b) => a[0] - b[0]),
  };
}

function montarPorPessoa(pp) {
  const colunas = [
    { titulo: "Nome", largura: 34 },
    { titulo: "Nome(s) confirmado(s)", largura: 34 },
    { titulo: "Pedidos", tipo: "inteiro", largura: 9 },
    { titulo: "Peças", tipo: "inteiro", largura: 8 },
    { titulo: "Valor total", tipo: "moeda", largura: 14 },
    { titulo: "Parcelamento", largura: 15 },
    ...pp.meses.map(([, rotulo]) => ({ titulo: `Boleto ${rotulo}`, tipo: "moeda", largura: 15 })),
    { titulo: "Pedidos (números)", largura: 44 },
  ];
  const linhas = pp.lista.map((x) => [
    x.nome, x.confirmados.join(" / "), x.pedidos.length, x.pecas, x.total, x.parcelas.join(" + "),
    ...pp.meses.map(([k]) => x.porMes.get(k) || ""), x.pedidos.join(", "),
  ]);
  const rodape = [[
    "Total", `${pp.lista.length} pessoa(s)`, soma(pp.lista, (x) => x.pedidos.length), soma(pp.lista, (x) => x.pecas), soma(pp.lista, (x) => x.total), "",
    ...pp.meses.map(([k]) => soma(pp.lista, (x) => x.porMes.get(k) || 0)), "",
  ]];
  if (!pp.lista.length) rodape.push(["Nenhum pedido no boleto ainda."]);
  rodape.push(["Cada coluna “Boleto mês/ano” soma o que vai no boleto da pessoa naquele mês: a 1ª parcela entra no mês seguinte ao pedido e as demais nos meses depois."]);
  return { nome: "Por pessoa", colunas, linhas, rodape };
}

/* Painel: os números principais em cartões e tabelas com barras de proporção. */
function montarPainel(vale, pp, pedidos = []) {
  const P = PAINEL, celulas = [], mesclas = [], alturas = { 1: 12, 4: 10 };
  const put = (ref, v, e) => celulas.push([ref, v, e]);
  const junta = (a, b) => mesclas.push(`${a}:${b}`);
  const COL = "BCDEFGHI";
  const barra = (v, max) => (v > 0 && max > 0 ? "  " + "█".repeat(Math.max(1, Math.round((v / max) * 30))) : "");

  put("B2", "Painel de pedidos · Camiseta da Inauguração do Templo", P.titulo); junta("B2", "I2"); alturas[2] = 36;
  put("B3", `${EVENTO?.nucleo || ""} · atualizado em ${dataHora(Date.now())} (horário de Brasília) · conta os pedidos no boleto e os pagos no PagBank`, P.subtitulo); junta("B3", "I3");

  // cartões
  const totalPecas = soma(vale, pecasDe), totalValor = soma(vale, (p) => p.total);
  const pecasModelo = (nome) => soma(vale, (p) => (p.itens || []).filter((i) => modeloDoItem(i) === nome).reduce((s, i) => s + i.qtd, 0));
  const retiradas = vale.filter((p) => p.entrega?.tipo === "RETIRADA");
  const correios = vale.filter((p) => p.entrega?.tipo && p.entrega.tipo !== "RETIRADA");
  const ultimo = vale.reduce((m, p) => Math.max(m, p.criadoEm || 0), 0);
  const modelos = PRODUTO.modelos.slice(0, 2);
  const cartoes = [
    [["Pedidos", vale.length, P.numero], ["Compradores", new Set(vale.map(pessoaDe)).size, P.numero], ["Camisetas", totalPecas, P.numero], ["Valor total", totalValor, P.valor]],
    [...modelos.map((m) => [`Camisetas ${m.nome}`, pecasModelo(m.nome), P.numero]), ["Retiradas no núcleo", retiradas.length, P.numero], ["Envios pelos Correios", correios.length, P.numero]],
    [["Valor médio por pedido", vale.length ? Math.round(totalValor / vale.length) : 0, P.valor], ["Peças por pedido", vale.length ? totalPecas / vale.length : 0, P.decimal],
     ["Frete (Correios)", soma(correios, (p) => p.entrega?.valor), P.valor], ["Último pedido", ultimo ? dataHora(ultimo).replace(/\/\d{4} às/, " às") : "—", P.destaque]],
  ];
  let r = 5;
  for (const linha of cartoes) {
    linha.forEach(([rotulo, valor, estilo], k) => {
      const a = COL[k * 2], b = COL[k * 2 + 1];
      put(`${a}${r}`, rotulo.toUpperCase(), P.rotulo); put(`${b}${r}`, "", P.rotulo); junta(`${a}${r}`, `${b}${r}`);
      put(`${a}${r + 1}`, valor, estilo); put(`${b}${r + 1}`, "", estilo); junta(`${a}${r + 1}`, `${b}${r + 1}`);
    });
    alturas[r] = 22; alturas[r + 1] = 42; alturas[r + 2] = 10;
    r += 3;
  }

  // tabelas: rótulo (B:C), até três números (D, E, F) e a barra (G:I)
  const tabela = (titulo, cab, tipos, linhas, vazio) => {
    r += 1; alturas[r - 1] = 14;
    put(`B${r}`, titulo, P.secao); junta(`B${r}`, `I${r}`); alturas[r] = 26; r++;
    put(`B${r}`, cab[0], P.cabecalho); put(`C${r}`, "", P.cabecalho); junta(`B${r}`, `C${r}`);
    "DEF".split("").forEach((c, k) => put(`${c}${r}`, cab[k + 1] || "", P.cabecalhoDir));
    for (const c of "GHI") put(`${c}${r}`, "", P.cabecalho);
    junta(`G${r}`, `I${r}`); alturas[r] = 22; r++;
    if (!linhas.length) {
      put(`B${r}`, vazio, P.vazio); for (const c of "CDEFGHI") put(`${c}${r}`, "", P.vazio);
      junta(`B${r}`, `I${r}`); alturas[r] = 22; r++;
      return;
    }
    const max = Math.max(0, ...linhas.map((l) => l[4] || 0));
    for (const l of linhas) {
      put(`B${r}`, l[0], P.texto); put(`C${r}`, "", P.texto); junta(`B${r}`, `C${r}`);
      "DEF".split("").forEach((c, k) => put(`${c}${r}`, l[k + 1] ?? "", tipos[k] ?? P.texto));
      put(`G${r}`, barra(l[4], max), P.barra); put(`H${r}`, "", P.barra); put(`I${r}`, "", P.barra); junta(`G${r}`, `I${r}`);
      alturas[r] = 21; r++;
    }
  };

  tabela("A receber por mês (boleto do mês subsequente)", ["Mês do boleto", "Pessoas", "Valor"], [P.inteiro, P.moeda],
    pp.meses.map(([k, rotulo]) => {
      const valor = soma(pp.lista, (x) => x.porMes.get(k) || 0);
      return [`Boleto de ${rotulo}`, pp.lista.filter((x) => x.porMes.get(k)).length, valor, "", valor];
    }), "Nenhum pedido no boleto ainda.");

  const noBoleto = vale.filter(ehBoleto);
  tabela("Parcelamento no boleto", ["Parcelas", "Pedidos", "Valor", "% dos pedidos"], [P.inteiro, P.moeda, P.percentual],
    Array.from({ length: PAGAMENTO.boleto?.parcelasMax || 1 }, (_, i) => i + 1).map((n) => {
      const ped = noBoleto.filter((p) => (p.pagamento?.parcelas || 1) === n);
      return [n === 1 ? "À vista (1x)" : `${n}x`, ped.length, soma(ped, (p) => p.total), noBoleto.length ? ped.length / noBoleto.length : 0, ped.length];
    }), "Nenhum pedido no boleto ainda.");

  // Forma de pagamento: boleto (cadastrados) e Pix/cartão pelo PagBank
  const formaCurta = (p) => ehBoleto(p) ? "Boleto (cadastrados)" : METODO[p.pagamento?.metodo] ? `${METODO[p.pagamento.metodo]} (PagBank)` : "PagBank";
  const formas = ["Boleto (cadastrados)", "Pix (PagBank)", "Cartão de crédito (PagBank)", "Cartão de débito (PagBank)"];
  for (const p of vale) if (!formas.includes(formaCurta(p))) formas.push(formaCurta(p));
  tabela("Forma de pagamento", ["Forma", "Pedidos", "Peças", "Valor"], [P.inteiro, P.inteiro, P.moeda],
    formas.map((f) => {
      const ped = vale.filter((p) => formaCurta(p) === f);
      return [f, ped.length, soma(ped, pecasDe), soma(ped, (p) => p.total), ped.length];
    }), "");

  tabela("Entrega", ["Entrega", "Pedidos", "Peças", "Frete"], [P.inteiro, P.inteiro, P.moeda],
    [["RETIRADA", RETIRADA?.nome || "Retirada no núcleo"], ["PAC", "Correios PAC"], ["SEDEX", "Correios SEDEX"]].map(([tipo, rotulo]) => {
      const ped = vale.filter((p) => p.entrega?.tipo === tipo);
      return [rotulo, ped.length, soma(ped, pecasDe), soma(ped, (p) => p.entrega?.valor), ped.length];
    }), "");

  const porTamanho = new Map();
  for (const p of vale) for (const i of p.itens || []) {
    const k = `${modeloDoItem(i)} · ${i.tamanho}`;
    porTamanho.set(k, (porTamanho.get(k) || 0) + i.qtd);
  }
  const ordem = PRODUTO.modelos.flatMap((m) => m.tamanhos.map((t) => `${m.nome} · ${t}`));
  tabela("Camisetas por modelo e tamanho (mais pedidas primeiro)", ["Modelo · tamanho", "Peças", "% das peças"], [P.inteiro, P.percentual],
    [...porTamanho.entries()].sort((a, b) => b[1] - a[1] || ordem.indexOf(a[0]) - ordem.indexOf(b[0]))
      .map(([k, n]) => [k, n, totalPecas ? n / totalPecas : 0, "", n]), "Nenhuma camiseta pedida ainda.");

  const porDia = new Map();
  for (const p of vale) {
    const k = diaChave(p.criadoEm);
    if (!porDia.has(k)) porDia.set(k, { rotulo: diaRotulo(p.criadoEm), pedidos: 0, pecas: 0, valor: 0 });
    const d = porDia.get(k); d.pedidos++; d.pecas += pecasDe(p); d.valor += p.total || 0;
  }
  tabela("Pedidos por dia", ["Dia", "Pedidos", "Peças", "Valor"], [P.inteiro, P.inteiro, P.moeda],
    [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, d]) => [d.rotulo, d.pedidos, d.pecas, d.valor, d.valor]),
    "Nenhum pedido ainda.");

  const quem = new Map();
  for (const p of vale) {
    const k = pessoaDe(p);
    if (!quem.has(k)) quem.set(k, { nome: p.cliente?.nome || "", pedidos: 0, pecas: 0, valor: 0 });
    const q = quem.get(k); q.pedidos++; q.pecas += pecasDe(p); q.valor += p.total || 0;
  }
  tabela("Quem mais comprou (os 10 maiores valores)", ["Nome", "Pedidos", "Peças", "Valor"], [P.inteiro, P.inteiro, P.moeda],
    [...quem.values()].sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 10)
      .map((q) => [q.nome, q.pedidos, q.pecas, q.valor, q.valor]), "Nenhum pedido ainda.");

  // alterações feitas no painel de pedidos (as mais recentes primeiro)
  const faixa = (lin, de, ate, valor, estilo) => {
    const cols = COL.slice(COL.indexOf(de), COL.indexOf(ate) + 1).split("");
    cols.forEach((c, k) => put(`${c}${lin}`, k ? "" : valor, estilo));
    if (cols.length > 1) junta(`${de}${lin}`, `${ate}${lin}`);
  };
  const alteracoes = pedidos.flatMap((p) => (p.alteracoes || []).map((a) => ({ ...a, nome: p.cliente?.nome || p.ref })))
    .sort((a, b) => b.em - a.em).slice(0, 10);
  r += 1; alturas[r - 1] = 14;
  put(`B${r}`, "Alterações feitas no painel (as 10 mais recentes)", P.secao); junta(`B${r}`, `I${r}`); alturas[r] = 26; r++;
  [["B", "C", "Comprador"], ["D", "E", "Alterado por"], ["F", "F", "Quando"], ["G", "I", "O que mudou"]].forEach(([a, b, t]) => faixa(r, a, b, t, P.cabecalho));
  alturas[r] = 22; r++;
  if (!alteracoes.length) { faixa(r, "B", "I", "Nenhuma alteração feita ainda.", P.vazio); alturas[r] = 22; r++; }
  for (const a of alteracoes) {
    faixa(r, "B", "C", a.nome, P.texto);
    faixa(r, "D", "E", a.por, P.texto);
    faixa(r, "F", "F", dataHora(a.em).replace(/\/\d{4} às/, " às"), P.texto);
    faixa(r, "G", "I", a.mudancas.map((m) => m.campo).join(", "), P.texto);
    alturas[r] = 21; r++;
  }

  return { nome: "Painel", painel: true, larguras: [2, 15, 15, 15, 15, 15, 15, 15, 15, 2], celulas, mesclas, alturas };
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
    // feitas no painel de pedidos
    { titulo: "Observação", largura: 30, valor: (p) => p.observacao },
    { titulo: "Alterado", largura: 9, valor: (p) => (p.alteracoes?.length ? "Sim" : "") },
    { titulo: "Última alteração", tipo: "data", largura: 17, valor: (p) => p.alteracoes?.at(-1)?.em ?? "" },
    { titulo: "Alterado por", largura: 22, valor: (p) => p.alteracoes?.at(-1)?.por },
    { titulo: "Alterações", largura: 70, valor: (p) => (p.alteracoes || []).map((a) => `${dataHora(a.em)} · ${a.por}: ${a.mudancas.map((m) => `${m.campo} ${m.de} → ${m.para}`).join("; ")}`).join(" | ") },
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

  const pp = juntarPorPessoa(pedidos);
  return [
    montarPainel(vale, pp, pedidos),
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
    montarPorPessoa(pp),
  ];
}
