/* Gestão no painel: lotes de fabricação e os cadastros em beta (produtos, serviços, fornecedores e lançamentos
   do financeiro). Tudo protegido pela senha do painel (api/painel.js chama estas funções).
   Lotes:  cam:lotes  -> [{ id, numero, nome, status, refs, criadoEm, por, observacao, historico }]
   Beta:   cam:beta:<coleção> -> [{ id, ...campos, criadoEm, por, atualizadoEm, atualizadoPor }] */
import { randomBytes } from "node:crypto";
import { HttpError, redis, lerPedido, salvarPedido, linha } from "./_lib.js";

const ler = async (chave) => { try { return JSON.parse((await redis("GET", chave)) || "[]"); } catch { return []; } };
const gravar = (chave, lista) => redis("SET", chave, JSON.stringify(lista));
const novoId = () => Date.now().toString(36) + randomBytes(3).toString("hex");

/* ===================== lotes de fabricação ===================== */
export const STATUS_LOTE = ["aberto", "producao", "pronto", "entregue"];
const NOME_STATUS = { aberto: "Aberto", producao: "Em produção", pronto: "Pronto", entregue: "Entregue" };
// pedido que vale (entra na produção): boleto não cancelado, Pix informado ou confirmado, PagBank pago
export const valeProducao = (p) => !["cancelado", "recusado"].includes(p.status)
  && (p.forma === "boleto" || ["pago", "em análise"].includes(p.status) || (p.forma === "pix" && p.status === "pix-informado"));

export const listarLotes = () => ler("cam:lotes");

export async function criarLote(body, por) {
  const refs = [...new Set((Array.isArray(body.refs) ? body.refs : []).map((r) => linha(r, 60)).filter(Boolean))].slice(0, 500);
  if (!refs.length) throw new HttpError(400, "Escolha pelo menos um pedido para o lote.");
  const lotes = await listarLotes();
  const pedidos = [];
  for (const ref of refs) {
    const p = await lerPedido(ref);
    if (!p) throw new HttpError(404, `Pedido ${ref} não encontrado.`);
    if (!valeProducao(p)) throw new HttpError(400, `O pedido de ${p.cliente?.nome || ref} ainda não vale (cancelado ou pagamento não concluído).`);
    if (p.lote?.id && lotes.some((l) => l.id === p.lote.id)) throw new HttpError(400, `O pedido de ${p.cliente?.nome || ref} já está no lote ${p.lote.numero}.`);
    pedidos.push(p);
  }
  const numero = lotes.reduce((m, l) => Math.max(m, l.numero || 0), 0) + 1;
  const agora = Date.now();
  const lote = {
    id: novoId(), numero, nome: linha(body.nome, 60) || `Lote ${numero}`, status: "aberto", refs,
    criadoEm: agora, por, observacao: linha(body.observacao, 300), historico: [{ em: agora, por, status: "aberto" }],
  };
  for (const p of pedidos) { p.lote = { id: lote.id, numero }; await salvarPedido(p); }
  await gravar("cam:lotes", [...lotes, lote]);
  return lote;
}

export async function mudarStatusLote(body, por) {
  const lotes = await listarLotes();
  const lote = lotes.find((l) => l.id === linha(body.id, 40));
  if (!lote) throw new HttpError(404, "Lote não encontrado.");
  const status = String(body.status || "");
  if (!STATUS_LOTE.includes(status)) throw new HttpError(400, "Etapa inválida.");
  if (status === lote.status) throw new HttpError(400, `O lote já está em "${NOME_STATUS[status]}".`);
  lote.status = status;
  lote.historico = [...(lote.historico || []), { em: Date.now(), por, status }];
  await gravar("cam:lotes", lotes);
  return lote;
}

// desfaz o lote (só aberto) ou tira um pedido dele; os pedidos voltam para "aguardando lote"
export async function desfazerLote(body, por) {
  const lotes = await listarLotes();
  const lote = lotes.find((l) => l.id === linha(body.id, 40));
  if (!lote) throw new HttpError(404, "Lote não encontrado.");
  const tirar = body.ref ? [linha(body.ref, 60)] : lote.refs;
  if (!body.ref && lote.status !== "aberto") throw new HttpError(400, "Só dá para desfazer um lote que ainda está aberto.");
  for (const ref of tirar) {
    const p = await lerPedido(ref);
    if (p && p.lote?.id === lote.id) { delete p.lote; await salvarPedido(p); }
  }
  lote.refs = lote.refs.filter((r) => !tirar.includes(r));
  lote.historico = [...(lote.historico || []), { em: Date.now(), por, status: lote.status, nota: body.ref ? `tirou o pedido ${body.ref}` : "desfez o lote" }];
  const resto = body.ref && lote.refs.length ? lotes : lotes.filter((l) => l.id !== lote.id);
  await gravar("cam:lotes", resto);
  return resto.includes(lote) ? lote : null;
}

// entrega de um pedido (retirada no núcleo ou envio pelos Correios)
export async function marcarEntrega(body, por) {
  const p = await lerPedido(linha(body.ref, 60));
  if (!p) throw new HttpError(404, "Pedido não encontrado.");
  const sim = !!body.entregue;
  p.entregue = sim;
  p.entrega = { ...p.entrega, entregueEm: sim ? Date.now() : null, entreguePor: sim ? por : null, rastreio: sim ? linha(body.rastreio, 40) || p.entrega?.rastreio || "" : p.entrega?.rastreio || "" };
  await salvarPedido(p);
  return p;
}

/* ===================== cadastros em beta ===================== */
const centavos = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e10) : 0; };
const inteiro = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 1e7) : 0; };
const texto = (n) => (v) => linha(v, n);
const um = (opcoes, padrao) => (v) => (opcoes.includes(v) ? v : padrao);
const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10));
const sn = (v) => !!v;
export const COLECOES = {
  produtos: { obrigatorio: "nome", campos: { nome: texto(80), categoria: texto(40), sku: texto(40), preco: centavos, custo: centavos, unidade: texto(20), ativo: sn, obs: texto(300) } },
  servicos: { obrigatorio: "nome", campos: { nome: texto(80), fornecedor: texto(80), cobranca: um(["peca", "servico", "hora"], "servico"), custo: centavos, prazo: texto(40), obs: texto(300) } },
  fornecedores: { obrigatorio: "nome", campos: { nome: texto(80), documento: texto(30), telefone: texto(30), email: texto(80), fornece: texto(120), obs: texto(300) } },
  lancamentos: { obrigatorio: "descricao", campos: {
    data, tipo: um(["producao", "despesa", "taxa"], "despesa"), categoria: texto(40), descricao: texto(120), fornecedor: texto(80), nota: texto(40),
    quantidade: inteiro, valor: centavos, lote: texto(40), pago: sn, obs: texto(300),
  } },
};
const chaveBeta = (c) => {
  if (!COLECOES[c]) throw new HttpError(400, "Cadastro inválido.");
  return "cam:beta:" + c;
};
export async function listarBeta() {
  const out = {};
  for (const c of Object.keys(COLECOES)) out[c] = await ler(chaveBeta(c));
  return out;
}
export async function salvarBeta(body, por) {
  const c = String(body.colecao || ""), chave = chaveBeta(c), def = COLECOES[c];
  const item = body.item || {};
  const limpo = Object.fromEntries(Object.entries(def.campos).map(([k, f]) => [k, f(item[k])]));
  if (!limpo[def.obrigatorio]) throw new HttpError(400, "Preencha o campo obrigatório.", { campo: def.obrigatorio });
  if (c === "lancamentos" && !limpo.valor) throw new HttpError(400, "Informe o valor.", { campo: "valor" });
  const lista = await ler(chave);
  const agora = Date.now();
  let salvo;
  const i = item.id ? lista.findIndex((x) => x.id === item.id) : -1;
  if (i >= 0) { salvo = { ...lista[i], ...limpo, atualizadoEm: agora, atualizadoPor: por }; lista[i] = salvo; }
  else {
    if (lista.length >= 1000) throw new HttpError(400, "Limite de itens neste cadastro.");
    salvo = { id: novoId(), ...limpo, criadoEm: agora, por }; lista.push(salvo);
  }
  await gravar(chave, lista);
  return salvo;
}
export async function excluirBeta(body) {
  const chave = chaveBeta(String(body.colecao || ""));
  const lista = await ler(chave);
  const resto = lista.filter((x) => x.id !== body.id);
  if (resto.length === lista.length) throw new HttpError(404, "Item não encontrado.");
  await gravar(chave, resto);
  return true;
}
