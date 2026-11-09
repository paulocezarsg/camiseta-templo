/* Painel de pedidos: com a senha do painel, lista todos os pedidos e permite alterar os pedidos no boleto.
   Cada alteração pede de novo a senha e o nome de quem está alterando; o pedido guarda o histórico
   (quem, quando e o que mudou), e a planilha do admin passa a mostrar os valores novos na hora.
   Para trocar a senha sem mexer no código, defina a variável PAINEL_SENHA na Vercel.
   POST { acao: "listar", senha }                         -> { pedidos, cadastrados }
   POST { acao: "alterar", senha, ref, por, dados }       -> { pedido }
     dados: { nome, itens: [{ cor, modelo, tamanho, qtd }], entrega: "RETIRADA"|"PAC"|"SEDEX", endereco, parcelas, status, observacao } */
import { HttpError, json, rota, readJSON, bancoPronto, dentroDoLimite, redis, ipDe, listarPedidos, lerPedido, salvarPedido, confereSenha, linha } from "./_lib.js";
import { lerItens, itensParaSalvar, lerEntrega, entregaParaSalvar, cadastroPorNome, nomesCadastrados, mesmoNome } from "./_pedido.js";
import { PRODUTO, PAGAMENTO, RETIRADA, parcelasDe } from "../produto.js";

const HASH_SENHA = "SiCElJgKOvTJ3Ofr/88GXQ==:CIpHfa9Q/vSEU1G+j1N41NaXK7TAeVQHaotRfuOcc+8="; // hash da senha do painel
const ERROS_SENHA = 10, JANELA_SENHA = 15 * 60; // senhas erradas por endereço de internet

async function exigirSenha(req, senha) {
  if (!bancoPronto()) throw new HttpError(503, "O banco de dados ainda não foi configurado.");
  const chave = "cam:painel-erros:" + ipDe(req);
  if (Number(await redis("GET", chave)) >= ERROS_SENHA) throw new HttpError(429, "Muitas tentativas de senha. Espere 15 minutos e tente de novo.", { campo: "senha" });
  if (!confereSenha(senha, HASH_SENHA, "PAINEL_SENHA")) {
    await dentroDoLimite(chave, ERROS_SENHA, JANELA_SENHA);
    throw new HttpError(401, senha ? "Senha incorreta." : "Digite a senha do painel.", { campo: "senha" });
  }
}

/* ===================== textos para o histórico ===================== */
const brl = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS = { "aguardando-boleto": "Pedido registrado", cancelado: "Cancelado" };
const textoItens = (itens = []) => itens.map((i) => `${i.qtd}× ${i.modelo || PRODUTO.modelos[0].nome} ${i.tamanho}`).join(", ");
function textoEntrega(e = {}) {
  if (e.tipo === "RETIRADA") return RETIRADA?.nome || "Retirada no núcleo";
  const end = e.endereco || {};
  const local = [end.rua && `${end.rua}, ${end.numero || "s/n"}`, end.cidade && `${end.cidade}/${end.uf}`, end.cep && `CEP ${String(end.cep).replace(/(\d{5})(\d{3})/, "$1-$2")}`].filter(Boolean).join(" · ");
  return `Correios ${e.tipo || ""}${local ? ` (${local})` : ""}`.trim();
}
function diferencas(antes, depois) {
  const lista = [];
  const compara = (campo, a, b) => { if ((a ?? "") !== (b ?? "")) lista.push({ campo, de: a || "—", para: b || "—" }); };
  compara("Comprador", antes.cliente?.nome, depois.cliente?.nome);
  compara("Itens", textoItens(antes.itens), textoItens(depois.itens));
  compara("Entrega", textoEntrega(antes.entrega), textoEntrega(depois.entrega));
  compara("Parcelamento", `${antes.pagamento?.parcelas || 1}x`, `${depois.pagamento?.parcelas || 1}x`);
  compara("Total", brl(antes.total), brl(depois.total));
  compara("Status", STATUS[antes.status] || antes.status, STATUS[depois.status] || depois.status);
  compara("Observação", antes.observacao, depois.observacao);
  return lista;
}

/* ===================== ações ===================== */
async function alterar(body) {
  const cfg = PAGAMENTO.boleto;
  const pedido = await lerPedido(linha(body.ref, 60));
  if (!pedido) throw new HttpError(404, "Pedido não encontrado.");
  if (pedido.forma !== "boleto") throw new HttpError(400, "Só os pedidos no boleto podem ser alterados aqui.");
  const por = linha(body.por, 80);
  if (por.replace(/[^\p{L}]/gu, "").length < 2) throw new HttpError(400, "Informe o seu nome (quem está alterando).", { campo: "por" });

  const d = body.dados || {};
  // comprador: o mesmo de antes ou um nome da lista de cadastrados
  let cliente = pedido.cliente || {};
  if (!mesmoNome(d.nome, cliente.nome)) {
    const pessoa = cadastroPorNome(d.nome);
    if (!pessoa) throw new HttpError(400, "Escolha um nome da lista de cadastrados.", { campo: "nome" });
    cliente = { ...cliente, nome: pessoa.nome, cadastroId: pessoa.id };
  }
  const { itens, total: pecas, subtotal } = lerItens(d.itens);
  const n = Number(d.parcelas);
  if (!Number.isInteger(n) || n < 1 || n > cfg.parcelasMax) throw new HttpError(400, `Escolha de 1 a ${cfg.parcelasMax} parcelas.`, { campo: "parcelas" });
  const entrega = lerEntrega({ frete: d.entrega, endereco: d.endereco }, pecas);
  if (d.entrega !== "RETIRADA" && !entrega.retirada && entrega.frete.id !== d.entrega) throw new HttpError(400, "Escolha a entrega: retirada, PAC ou SEDEX.", { campo: "entrega" });
  const status = d.status === "cancelado" ? "cancelado" : "aguardando-boleto";
  const total = subtotal + entrega.frete.valor;

  const agora = Date.now();
  const novo = {
    ...pedido, cliente, itens: itensParaSalvar(itens), pecas, entrega: entregaParaSalvar(entrega), subtotal, total,
    pagamento: { ...pedido.pagamento, metodo: "BOLETO", parcelas: n, valores: parcelasDe(total, n) },
    status, observacao: linha(d.observacao, 300),
  };
  const mudancas = diferencas(pedido, novo);
  if (!mudancas.length) throw new HttpError(400, "Nada foi alterado neste pedido.");
  novo.alteracoes = [...(pedido.alteracoes || []), { em: agora, por, mudancas }];
  if (status !== pedido.status) novo.historico = [...(pedido.historico || []), { em: agora, status }];
  await salvarPedido(novo);
  console.log("Pedido alterado:", novo.ref, "por", por, mudancas.map((m) => m.campo).join(", "));
  return novo;
}

const POST = async (req) => {
  const body = await readJSON(req, 20_000);
  await exigirSenha(req, body.senha);
  if (body.acao === "listar") {
    const pedidos = (await listarPedidos()).sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    return json({ pedidos, cadastrados: nomesCadastrados(), agora: Date.now() });
  }
  if (body.acao === "alterar") return json({ pedido: await alterar(body) });
  throw new HttpError(400, "Ação inválida.");
};

export default rota({ POST });
