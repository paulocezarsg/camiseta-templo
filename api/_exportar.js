/* Exportações do painel de pedidos (Excel):
   - "todos": todos os pedidos (inclusive cancelados e pagamentos não concluídos), um por linha, com o status.
   - "boleto": só o nome da pessoa e o valor de cada mês, para lançar os boletos. Junta todos os pedidos no boleto
     da mesma pessoa (fora os cancelados); a 1ª parcela vai no boleto do mês seguinte ao pedido e as demais nos
     meses depois. Primeira aba com todos os meses lado a lado e uma aba por mês só com nome e valor. */
import { planilha } from "./_xlsx.js";
import { RETIRADA } from "../produto.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brasilia = (ms) => new Date(ms - 3 * 3600_000);
function mesDaParcela(ms, i) {
  const d = brasilia(ms), t = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1 + i;
  return { chave: t, rotulo: `${MESES[t % 12]}/${Math.floor(t / 12)}` };
}
// pedido bonificado: continua valendo (a camiseta é feita e entregue), mas sem nenhum valor a cobrar
export const semCobranca = (p) => (p.bonificado ? {
  ...p, status: "bonificado", subtotal: 0, total: 0, entrega: { ...p.entrega, valor: 0 },
  pagamento: { ...p.pagamento, parcelas: 0, valores: [] },
} : p);
const STATUS = {
  bonificado: "Bonificado", "aguardando-boleto": "Pedido registrado", "aguardando-pix": "Pix a conferir", "pix-informado": "Pix informado (a conferir)",
  pago: "Pago", aguardando: "Aguardando pagamento", "em análise": "Em análise", recusado: "Recusado", cancelado: "Cancelado",
};
const METODO = { PIX: "Pix", CREDIT_CARD: "Cartão de crédito", DEBIT_CARD: "Cartão de débito" };
const forma = (p) => (p.status === "bonificado" ? (p.forma === "boleto" ? "Boleto (bonificado)" : "Pix (bonificado)") : p.forma === "boleto" ? `Boleto ${p.pagamento?.parcelas || 1}x` : p.forma === "pix" ? "Pix (QR Code)" : ["PagBank", METODO[p.pagamento?.metodo]].filter(Boolean).join(" · "));
const celular = (c = {}) => { const n = String(c.celular || `${c.area || ""}${c.numero || ""}`).replace(/\D/g, ""); return n.length === 11 ? n.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3") : n.length === 10 ? n.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3") : n; };
const itens = (p) => (p.itens || []).map((i) => `${i.qtd}× ${i.modelo} ${i.tamanho}`).join("; ");
const endereco = (p) => { const e = p.entrega?.endereco || {}; return [e.rua && `${e.rua}, ${e.numero || "s/n"}${e.complemento ? ` - ${e.complemento}` : ""}`, e.bairro, e.cidade && `${e.cidade}/${e.uf}`, e.cep && `CEP ${String(e.cep).replace(/(\d{5})(\d{3})/, "$1-$2")}`].filter(Boolean).join(" · "); };
const carimbo = () => { const d = brasilia(Date.now()), z = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}-${z(d.getUTCHours())}h${z(d.getUTCMinutes())}`; };

export function exportarTodos(pedidos, lotes = []) {
  const lista = pedidos.map(semCobranca).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
  const lote = (p) => lotes.find((l) => l.id === p.lote?.id);
  const colunas = [
    { titulo: "Data", tipo: "data", largura: 17 }, { titulo: "Pedido", largura: 28 }, { titulo: "Nome", largura: 32 },
    { titulo: "Status", largura: 24 }, { titulo: "Pagamento", largura: 22 }, { titulo: "Celular", largura: 16 }, { titulo: "E-mail", largura: 28 },
    { titulo: "Itens", largura: 34 }, { titulo: "Peças", tipo: "inteiro", largura: 8 }, { titulo: "Camisetas", tipo: "moeda", largura: 13 },
    { titulo: "Frete", tipo: "moeda", largura: 11 }, { titulo: "Total", tipo: "moeda", largura: 13 }, { titulo: "Entrega", largura: 26 },
    { titulo: "Endereço", largura: 46 }, { titulo: "TXID do Pix", largura: 26 }, { titulo: "Lote", largura: 16 }, { titulo: "Entregue", largura: 10 },
    { titulo: "Observação", largura: 30 },
  ];
  const linhas = lista.map((p) => [
    p.criadoEm, p.ref, p.cliente?.nome, STATUS[p.status] || p.status, forma(p), celular(p.cliente), p.cliente?.email || "",
    itens(p), p.pecas || 0, p.subtotal || 0, p.entrega?.valor || 0, p.total || 0,
    p.entrega?.tipo === "RETIRADA" ? (RETIRADA?.nome || "Retirada") : `Correios ${p.entrega?.tipo || ""}`.trim(),
    endereco(p), p.forma === "pix" ? p.pagamento?.txid || "" : "", lote(p)?.nome || "", p.entregue ? "Sim" : "", p.observacao || "",
  ]);
  const soma = (k) => lista.reduce((s, p) => s + (k(p) || 0), 0);
  const rodape = [["Total", `${lista.length} pedido(s)`, "", "", "", "", "", "", soma((p) => p.pecas), soma((p) => p.subtotal), soma((p) => p.entrega?.valor), soma((p) => p.total)],
    ["Inclui todos os pedidos (também cancelados e pagamentos não concluídos): veja a coluna Status."]];
  return { arquivo: planilha([{ nome: "Pedidos", colunas, linhas, rodape }]), nome: `pedidos-todos-${carimbo()}.xlsx`, quantos: lista.length };
}

export function exportarBoleto(pedidos) {
  const boletos = pedidos.filter((p) => p.forma === "boleto" && !p.bonificado && !["cancelado", "recusado"].includes(p.status));
  const pessoas = new Map(), meses = new Map();
  for (const p of boletos) {
    const k = p.cliente?.cadastroId || String(p.cliente?.nome || "").trim().toLowerCase();
    if (!pessoas.has(k)) pessoas.set(k, { nome: p.cliente?.nome || "", porMes: new Map(), total: 0 });
    const x = pessoas.get(k);
    const valores = p.pagamento?.valores?.length ? p.pagamento.valores : [p.total || 0];
    valores.forEach((v, i) => {
      const m = mesDaParcela(p.criadoEm, i);
      meses.set(m.chave, m.rotulo);
      x.porMes.set(m.chave, (x.porMes.get(m.chave) || 0) + v);
      x.total += v;
    });
  }
  const lista = [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ordem = [...meses.entries()].sort((a, b) => a[0] - b[0]);
  const somaMes = (k) => lista.reduce((s, x) => s + (x.porMes.get(k) || 0), 0);
  const abas = [{
    nome: "Boletos",
    colunas: [{ titulo: "Nome", largura: 36 }, ...ordem.map(([, r]) => ({ titulo: `Boleto ${r}`, tipo: "moeda", largura: 15 })), { titulo: "Total", tipo: "moeda", largura: 14 }],
    linhas: lista.map((x) => [x.nome, ...ordem.map(([k]) => x.porMes.get(k) || ""), x.total]),
    rodape: [["Total", ...ordem.map(([k]) => somaMes(k)), lista.reduce((s, x) => s + x.total, 0)],
      [lista.length ? "Cada coluna é o valor que vai no boleto daquele mês. A 1ª parcela entra no mês seguinte ao pedido." : "Nenhum pedido no boleto ainda."]],
  }];
  for (const [k, r] of ordem) {
    const doMes = lista.filter((x) => x.porMes.get(k));
    abas.push({
      nome: `Boleto ${r.replace("/", "-")}`,
      colunas: [{ titulo: "Nome", largura: 36 }, { titulo: "Valor", tipo: "moeda", largura: 15 }],
      linhas: doMes.map((x) => [x.nome, x.porMes.get(k)]),
      rodape: [["Total", somaMes(k)]],
    });
  }
  return { arquivo: planilha(abas), nome: `boletos-${carimbo()}.xlsx`, quantos: lista.length };
}
