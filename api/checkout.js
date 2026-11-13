/* Cria o checkout no PagBank (Pix e cartão) e devolve o link de pagamento.
   Fica travado enquanto PAGAMENTO.pagbank.ativo for false (produto.js); o boleto é feito em api/boleto.js.
   O preço e o frete são recalculados aqui: o valor enviado pelo navegador não é usado.
   Variáveis: PAGBANK_TOKEN (obrigatória), PAGBANK_AMBIENTE=sandbox|producao (padrão: sandbox), SITE_URL (opcional). */
import { HttpError, json, rota, readJSON, bancoPronto, salvarPedido } from "./_lib.js";
import { lerItens, itensParaSalvar, lerCliente, lerEntrega, entregaParaSalvar, novaReferencia } from "./_pedido.js";
import { PRODUTO, LOJA, PAGAMENTO } from "../produto.js";

const pagbankBase = () =>
  process.env.PAGBANK_AMBIENTE === "producao" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";

const POST = async (req) => {
  if (!PAGAMENTO.pagbank?.ativo) throw new HttpError(403, "Pix e cartão ainda não estão disponíveis. Use o boleto.");
  const token = (process.env.PAGBANK_TOKEN || "").trim(); // espaço ou quebra de linha colados junto com o token
  if (!token) throw new HttpError(503, "O pagamento ainda não foi configurado. Fale com a gente para concluir o pedido.");

  const body = await readJSON(req);
  const { itens, total, subtotal } = lerItens(body.itens);
  const cliente = lerCliente(body.cliente);
  const entrega = lerEntrega(body, total);
  const { retirada, end, frete } = entrega;

  const origem = (process.env.SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const referencia = novaReferencia(retirada);
  const pedido = {
    reference_id: referencia,
    // no formato do exemplo do PagBank (2023-08-14T19:09:10-03:00), em horário de Brasília
    expiration_date: new Date(Date.now() + 2 * 86400_000 - 3 * 3600_000).toISOString().slice(0, 19) + "-03:00",
    customer: {
      name: cliente.nome, email: cliente.email, tax_id: cliente.cpf,
      phone: { country: "+55", area: cliente.area, number: cliente.numero },
    },
    customer_modifiable: true,
    items: itens.map((i) => ({
      reference_id: `${PRODUTO.id}-${i.modelo.id}-${i.tamanho}-${i.cor.id}`.toLowerCase(),
      name: `${PRODUTO.nome} · ${i.modelo.nome} · ${i.tamanho}${PRODUTO.cores.length > 1 ? ` · ${i.cor.nome}` : ""}${retirada ? " · Retirada no núcleo" : ""}`.slice(0, 100),
      quantity: i.qtd,
      unit_amount: i.preco,
    })),
    ...(retirada ? {} : {
      shipping: {
        type: "FIXED",
        amount: frete.valor,
        address_modifiable: false,
        address: {
          street: end.rua, number: end.numero, ...(end.complemento ? { complement: end.complemento } : {}),
          locality: end.bairro, city: end.cidade, region_code: end.uf, country: "BRA", postal_code: end.cep,
        },
      },
    }),
    payment_methods: PAGAMENTO.pagbank.metodos.map((type) => ({ type })),
    payment_methods_configs: [{
      type: "CREDIT_CARD",
      config_options: [
        { option: "INSTALLMENTS_LIMIT", value: String(PRODUTO.parcelasMax) },
        { option: "INTEREST_FREE_INSTALLMENTS", value: String(PRODUTO.parcelasSemJuros) },
      ],
    }],
    soft_descriptor: LOJA.descricaoFatura.slice(0, 17),
    redirect_url: `${origem}/obrigado?pedido=${referencia}`,
    return_url: `${origem}/`,
  };
  // O PagBank só aceita notificação em endereço https público.
  if (origem.startsWith("https://")) {
    pedido.notification_urls = [`${origem}/api/pagbank-webhook`];
    pedido.payment_notification_urls = [`${origem}/api/pagbank-webhook`];
  }

  let r;
  try {
    r = await fetch(`${pagbankBase()}/checkouts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("PagBank fora do ar ou sem resposta:", e);
    throw new HttpError(502, "Não conseguimos abrir o pagamento agora. Tente de novo em instantes.");
  }
  const d = await r.json().catch(() => null);
  const pagar = d && Array.isArray(d.links) && d.links.find((l) => l.rel === "PAY");
  if (!r.ok || !pagar) {
    console.error("PagBank checkout:", r.status, JSON.stringify(d).slice(0, 1000));
    // o motivo que o PagBank devolveu vai junto na mensagem, para saber o que corrigir
    const motivo = (Array.isArray(d?.error_messages) ? d.error_messages : [])
      .map((e) => [e.parameter_name, e.description || e.error || e.code].filter(Boolean).join(": ")).filter(Boolean).join("; ");
    throw new HttpError(502, `Não conseguimos abrir o pagamento agora. Tente de novo em instantes. (PagBank ${r.status}${motivo ? `: ${motivo}` : ""})`.slice(0, 400));
  }
  console.log("Checkout criado:", referencia, d.id, `${total} peça(s)`, `frete ${frete.id} ${frete.valor}`);

  // Guarda o pedido para o acesso admin. Se o banco falhar, a venda segue (o pedido continua no PagBank).
  if (bancoPronto()) {
    try {
      await salvarPedido({
        ref: referencia, checkoutId: d.id, criadoEm: Date.now(), status: "aguardando", forma: "pagbank",
        cliente: { nome: cliente.nome, email: cliente.email, cpf: cliente.cpf, celular: cliente.area + cliente.numero },
        itens: itensParaSalvar(itens),
        pecas: total,
        entrega: entregaParaSalvar(entrega),
        subtotal, total: subtotal + frete.valor,
        pagamento: null, entregue: false, historico: [{ em: Date.now(), status: "aguardando" }],
      });
    } catch (e) { console.error("Não foi possível salvar o pedido", referencia, e); }
  }
  return json({ url: pagar.href, referencia });
};

export default rota({ POST });
