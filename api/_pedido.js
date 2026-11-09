/* O que o pedido no boleto e o pedido pelo PagBank têm em comum: sacola, cliente, entrega e a lista de cadastrados. */
import { randomBytes } from "node:crypto";
import { HttpError, digitos, linha, cpfValido, UFS } from "./_lib.js";
import { calcularFrete } from "../correios.js";
import { PRODUTO, RETIRADA, modeloDe, precoDoModelo } from "../produto.js";
import { CADASTRADOS } from "./_cadastrados.js";

export function lerItens(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new HttpError(400, "Sua sacola está vazia.");
  const juntos = new Map();
  for (const it of lista.slice(0, 50)) {
    const cor = PRODUTO.cores.find((c) => c.id === it.cor);
    const modelo = modeloDe(it.modelo || PRODUTO.modelos[0].id);
    const tamanho = String(it.tamanho ?? "");
    const qtd = Number(it.qtd);
    if (!cor || !modelo || !modelo.tamanhos.includes(tamanho) || !Number.isInteger(qtd) || qtd < 1) throw new HttpError(400, "Há um item inválido na sacola.");
    const chave = `${cor.id}-${modelo.id}-${tamanho}`;
    juntos.set(chave, { cor, modelo, tamanho, preco: precoDoModelo(modelo.id), qtd: (juntos.get(chave)?.qtd || 0) + qtd });
  }
  const itens = [...juntos.values()];
  const total = itens.reduce((s, i) => s + i.qtd, 0);
  const subtotal = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
  if (total > PRODUTO.maxPorPedido) throw new HttpError(400, `O limite é de ${PRODUTO.maxPorPedido} peças por pedido.`);
  return { itens, total, subtotal };
}
/* Itens como ficam guardados no pedido (e na planilha do admin). */
export const itensParaSalvar = (itens) => itens.map((i) => ({ cor: i.cor.nome, modelo: i.modelo.nome, tamanho: i.tamanho, qtd: i.qtd, unitario: i.preco }));

export function lerCliente(c = {}) {
  const nome = linha(c.nome, 120);
  const email = linha(c.email, 120).toLowerCase();
  const cpf = digitos(c.cpf);
  const cel = digitos(c.celular).replace(/^55(?=\d{10,11}$)/, "");
  if (nome.split(" ").length < 2) throw new HttpError(400, "Informe o nome completo.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Informe um e-mail válido.");
  if (!cpfValido(cpf)) throw new HttpError(400, "Informe um CPF válido.");
  if (cel.length < 10 || cel.length > 11) throw new HttpError(400, "Informe o celular com DDD.");
  return { nome, email, cpf, area: cel.slice(0, 2), numero: cel.slice(2) };
}

function lerEndereco(e = {}) {
  const end = {
    cep: digitos(e.cep), rua: linha(e.rua, 160), numero: linha(e.numero, 20), complemento: linha(e.complemento, 40),
    bairro: linha(e.bairro, 60), cidade: linha(e.cidade, 90), uf: linha(e.uf, 2).toUpperCase(),
  };
  if (end.cep.length !== 8) throw new HttpError(400, "Informe o CEP de entrega.");
  if (!end.rua || !end.numero || !end.bairro || !end.cidade) throw new HttpError(400, "Preencha o endereço de entrega completo.");
  if (!UFS.includes(end.uf)) throw new HttpError(400, "Informe o estado (UF) de entrega.");
  return end;
}

/* Retirada no núcleo: sem endereço e sem frete. Senão, o frete é recalculado pela tabela dos Correios. */
export function lerEntrega(body, pecas) {
  const retirada = body.frete === "RETIRADA" && !!RETIRADA?.ativa;
  if (retirada) return { retirada, end: null, frete: { id: "RETIRADA", valor: 0, prazo: null } };
  const end = lerEndereco(body.endereco || {});
  const cotacao = calcularFrete(end.cep, pecas, PRODUTO.diasParaPostar);
  if (!cotacao) throw new HttpError(400, "CEP de entrega não encontrado.");
  return { retirada, end, frete: cotacao.opcoes.find((o) => o.id === body.frete) || cotacao.opcoes[0] };
}
export const entregaParaSalvar = ({ retirada, end, frete }) =>
  retirada ? { tipo: "RETIRADA", valor: 0 } : { tipo: frete.id, valor: frete.valor, prazo: frete.prazo || null, endereco: end };

export const novaReferencia = (retirada) =>
  "CG-" + Date.now().toString(36).toUpperCase() + randomBytes(2).toString("hex").toUpperCase() + (retirada ? "-RETIRADA" : "");

/* ===================== cadastrados ===================== */
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const usados = new Map();
// cada linha da lista é o nome completo (aceita também { nome: "..." })
const LISTA = CADASTRADOS.map((c) => linha(typeof c === "string" ? c : c?.nome, 120)).filter(Boolean).map((nome) => {
  const base = normalizar(nome).replace(/ /g, "-");
  const n = (usados.get(base) || 0) + 1; usados.set(base, n);
  return { nome, id: n > 1 ? `${base}-${n}` : base, chave: normalizar(nome) };
}).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

export const cadastroPronto = () => LISTA.length > 0;
export const cadastroPorId = (id) => LISTA.find((c) => c.id === String(id || "")) || null;
/* Para o painel de pedidos (protegido por senha): a lista inteira de nomes e a busca pelo nome exato. */
export const nomesCadastrados = () => LISTA.map((c) => c.nome);
export const cadastroPorNome = (nome) => LISTA.find((c) => c.chave === normalizar(nome)) || null;
export const mesmoNome = (a, b) => normalizar(a) === normalizar(b);

/* Cada palavra digitada precisa ser o começo de uma palavra do nome ("marc mart" acha "Marcelo Martinatti").
   Primeiro vêm os nomes que começam pelo que foi digitado; depois, os demais, em ordem alfabética. */
export function buscarCadastro(termo, max = 8) {
  const t = normalizar(termo), partes = t.split(" ").filter(Boolean);
  if (partes.join("").length < 3) return [];
  const peso = (c) => (c.chave.startsWith(t) ? 0 : c.chave.startsWith(partes[0]) ? 1 : 2);
  return LISTA.filter((c) => {
    const palavras = c.chave.split(" ");
    return partes.every((p) => palavras.some((w) => w.startsWith(p)));
  }).sort((a, b) => peso(a) - peso(b)).slice(0, max).map(({ id, nome }) => ({ id, nome }));
}
