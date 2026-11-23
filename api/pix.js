/* Pix estático com a chave do núcleo, para qualquer pessoa (não passa pelo PagBank).
   POST { itens, cliente: { nome, email, celular }, frete, endereco } -> { referencia, total, copiaECola, txid }
     O pedido fica "aguardando-pix" até o núcleo conferir o Pix no extrato e confirmar no painel de pedidos.
   POST { acao: "ja-paguei", pedido: REF } -> { status }: o comprador avisa que pagou; o pedido fica "pix-informado",
     entra na planilha (como o boleto) e continua no "Pix a conferir" do painel até o núcleo confirmar no extrato.
   GET ?pedido=REF -> { referencia, total, copiaECola, txid, status } (para reabrir o QR Code na página de obrigado) */
import { HttpError, json, rota, readJSON, bancoPronto, dentroDoLimite, ipDe, salvarPedido, lerPedido, linha } from "./_lib.js";
import { lerItens, itensParaSalvar, lerCliente, lerEntrega, entregaParaSalvar, novaReferencia } from "./_pedido.js";
import { PAGAMENTO } from "../produto.js";
import { pixCopiaECola, txidDoPedido } from "../pix.js";

const POST = async (req) => {
  const cfg = PAGAMENTO.pix;
  if (!cfg?.ativo) throw new HttpError(403, "O Pix não está disponível no momento.");
  // sem banco, o pedido se perderia: o Pix só vale com o pedido registrado
  if (!bancoPronto()) throw new HttpError(503, "Não conseguimos registrar o pedido agora. Tente de novo mais tarde.");
  if (!(await dentroDoLimite("cam:pix:" + ipDe(req), 60, 3600))) throw new HttpError(429, "Muitos pedidos seguidos. Tente de novo mais tarde.");

  const body = await readJSON(req);
  if (body.acao === "ja-paguei") return jaPaguei(body);
  const { itens, total: pecas, subtotal } = lerItens(body.itens);
  const cliente = lerCliente(body.cliente, { cpf: false });
  const entrega = lerEntrega(body, pecas);
  const referencia = novaReferencia(entrega.retirada);
  const total = subtotal + entrega.frete.valor;
  const txid = txidDoPedido(referencia);
  const copiaECola = pixCopiaECola({ recebedor: cfg.recebedor, valor: total, txid });
  const agora = Date.now();
  await salvarPedido({
    ref: referencia, criadoEm: agora, status: "aguardando-pix", forma: "pix",
    cliente: { nome: cliente.nome, email: cliente.email, celular: cliente.area + cliente.numero },
    itens: itensParaSalvar(itens), pecas,
    entrega: entregaParaSalvar(entrega),
    subtotal, total,
    pagamento: { metodo: "PIX", txid, copiaECola, chave: cfg.recebedor.chave },
    entregue: false, historico: [{ em: agora, status: "aguardando-pix" }],
  });
  console.log("Pedido no Pix:", referencia, cliente.nome, `${pecas} peça(s)`, total);
  return json({ referencia, total, copiaECola, txid });
};

async function jaPaguei(body) {
  const p = await lerPedido(linha(body.pedido, 60));
  if (!p || p.forma !== "pix") throw new HttpError(404, "Pedido não encontrado.");
  if (p.status === "aguardando-pix") {
    const agora = Date.now();
    p.status = "pix-informado";
    p.pagamento = { ...p.pagamento, informadoEm: agora };
    p.historico = [...(p.historico || []), { em: agora, status: "pix-informado" }];
    await salvarPedido(p);
    console.log("Pix informado pelo comprador:", p.ref);
  } else if (p.status === "cancelado") throw new HttpError(400, "Este pedido foi cancelado. Fale com o núcleo.");
  return json({ status: p.status });
}

const GET = async (req) => {
  if (!bancoPronto()) throw new HttpError(503, "Banco de dados indisponível.");
  const ref = linha(new URL(req.url).searchParams.get("pedido"), 60);
  const p = ref && (await lerPedido(ref));
  if (!p || p.forma !== "pix") throw new HttpError(404, "Pedido não encontrado.");
  return json({ referencia: p.ref, total: p.total, copiaECola: p.pagamento?.copiaECola, txid: p.pagamento?.txid, status: p.bonificado ? "pago" : p.status });
};

export default rota({ GET, POST });
