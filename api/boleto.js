/* Pedido no boleto, só para quem está na lista de cadastrados. Não passa pelo PagBank: o pedido fica
   registrado no banco e o núcleo emite os boletos a partir da planilha do admin.
   Na confirmação, a pessoa digita o próprio nome e sobrenome. Não há conferência com o nome escolhido
   na lista: o texto é guardado como foi digitado e aparece na planilha ("Nome confirmado").
   POST { itens, cadastro, parcelas, frete, endereco, confirmacao } -> { referencia, total, parcelas: [centavos...] } */
import { HttpError, json, rota, readJSON, bancoPronto, dentroDoLimite, ipDe, salvarPedido, linha } from "./_lib.js";
import { lerItens, itensParaSalvar, lerEntrega, entregaParaSalvar, novaReferencia, cadastroPorId } from "./_pedido.js";
import { PAGAMENTO, parcelasDe } from "../produto.js";

const POST = async (req) => {
  const cfg = PAGAMENTO.boleto;
  if (!cfg?.ativo) throw new HttpError(403, "O pagamento por boleto não está disponível no momento.");
  // Sem banco, o pedido se perderia: ele só existe aqui, não no PagBank.
  if (!bancoPronto()) throw new HttpError(503, "Não conseguimos registrar o pedido agora. Tente de novo mais tarde.");
  // limite folgado: no núcleo, vários pedidos podem sair da mesma rede
  if (!(await dentroDoLimite("cam:boleto:" + ipDe(req), 120, 3600))) throw new HttpError(429, "Muitos pedidos seguidos. Tente de novo mais tarde.");

  const body = await readJSON(req);
  const { itens, total, subtotal } = lerItens(body.itens);
  const pessoa = cadastroPorId(body.cadastro);
  if (!pessoa) throw new HttpError(400, "Escolha o seu nome na lista de cadastrados.", { campo: "cadastro" });
  const confirmacao = linha(body.confirmacao, 120);
  if (confirmacao.split(" ").length < 2) throw new HttpError(400, "Confirme o seu nome e sobrenome.", { campo: "confirmacao" });
  const n = Number(body.parcelas);
  if (!Number.isInteger(n) || n < 1 || n > cfg.parcelasMax) throw new HttpError(400, `Escolha de 1 a ${cfg.parcelasMax} parcelas.`);
  const entrega = lerEntrega(body, total);

  const referencia = novaReferencia(entrega.retirada);
  const valor = subtotal + entrega.frete.valor;
  const parcelas = parcelasDe(valor, n);
  const agora = Date.now();
  await salvarPedido({
    ref: referencia, criadoEm: agora, status: "aguardando-boleto", forma: "boleto",
    cliente: { nome: pessoa.nome, cadastroId: pessoa.id, nomeConfirmado: confirmacao },
    itens: itensParaSalvar(itens), pecas: total,
    entrega: entregaParaSalvar(entrega),
    subtotal, total: valor,
    pagamento: { metodo: "BOLETO", parcelas: n, valores: parcelas },
    entregue: false, historico: [{ em: agora, status: "aguardando-boleto" }],
  });
  console.log("Pedido no boleto:", referencia, pessoa.nome, `(confirmou: ${confirmacao})`, `${total} peça(s)`, `${n}x`, valor);
  return json({ referencia, total: valor, parcelas });
};

export default rota({ POST });
