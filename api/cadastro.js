/* Busca na lista de cadastrados para o pagamento no boleto.
   GET ?busca=mar -> { pronta, resultados: [{ id, nome }] } (até 8 nomes; precisa de pelo menos 3 letras) */
import { HttpError, json, rota, bancoPronto, dentroDoLimite, ipDe } from "./_lib.js";
import { buscarCadastro, cadastroPronto } from "./_pedido.js";
import { PAGAMENTO } from "../produto.js";

const GET = async (req) => {
  if (!PAGAMENTO.boleto?.ativo) return json({ pronta: false, resultados: [] });
  if (bancoPronto()) {
    let dentro = true;
    try { dentro = await dentroDoLimite("cam:busca:" + ipDe(req), 600, 600); } catch (e) { console.error(e); }
    if (!dentro) throw new HttpError(429, "Muitas buscas seguidas. Espere alguns minutos.");
  }
  const busca = (new URL(req.url).searchParams.get("busca") || "").slice(0, 80);
  return json({ pronta: cadastroPronto(), resultados: buscarCadastro(busca) });
};

export default rota({ GET });
