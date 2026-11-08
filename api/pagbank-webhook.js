/* Notificações do PagBank sobre o pedido (pago, recusado, cancelado...).
   A autenticidade é conferida pelo cabeçalho x-authenticity-token = sha256(PAGBANK_TOKEN + "-" + corpo).
   O status e a forma de pagamento são gravados no pedido, que aparece no acesso admin. */
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError, json, rota, bancoPronto, lerPedido, salvarPedido } from "./_lib.js";

const STATUS = { PAID: "pago", AUTHORIZED: "pago", AVAILABLE: "pago", IN_ANALYSIS: "em análise", WAITING: "aguardando", DECLINED: "recusado", CANCELED: "cancelado" };

const POST = async (req) => {
  const token = process.env.PAGBANK_TOKEN;
  if (!token) throw new HttpError(503, "PagBank não configurado.");
  const corpo = await req.text();
  const recebido = Buffer.from(req.headers.get("x-authenticity-token") || "");
  const esperado = Buffer.from(createHash("sha256").update(`${token}-${corpo}`).digest("hex"));
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new HttpError(401, "Assinatura inválida.");

  let ordem;
  try { ordem = JSON.parse(corpo); } catch { throw new HttpError(400, "Dados inválidos."); }
  const cobrancas = ordem.charges || [];
  console.log("PagBank:", ordem.reference_id, ordem.id, cobrancas.map((c) => `${c.status} ${c.payment_method?.type || ""} ${c.amount?.value ?? ""}`.trim()).join(" | ") || "sem cobrança");

  if (bancoPronto() && ordem.reference_id) {
    const pedido = await lerPedido(String(ordem.reference_id).slice(0, 60));
    if (!pedido) { console.warn("Pedido não encontrado no banco:", ordem.reference_id); return json({ ok: true }); }
    // a cobrança paga vale sobre as outras; senão, a mais recente
    const c = cobrancas.find((x) => STATUS[x.status] === "pago") || cobrancas.at(-1);
    if (c) {
      const status = STATUS[c.status] || String(c.status || "").toLowerCase();
      if (pedido.status !== status) pedido.historico = [...(pedido.historico || []), { em: Date.now(), status }];
      pedido.status = status;
      pedido.pagamento = {
        metodo: c.payment_method?.type || null,
        parcelas: c.payment_method?.installments || null,
        valor: c.amount?.value ?? null,
        pagoEm: c.paid_at || (status === "pago" ? new Date().toISOString() : null),
        ordemId: ordem.id || null,
      };
      await salvarPedido(pedido);
    }
  }
  return json({ ok: true });
};

export default rota({ POST });
