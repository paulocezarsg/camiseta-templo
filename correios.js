/* Calculadora simples de frete dos Correios (PAC e SEDEX), sem integração: o preço sai de uma tabela
   por trecho e faixa de peso. A página usa para mostrar o frete na hora e o servidor usa para cobrar
   no PagBank, então os dois sempre batem.

   Como manter: os Correios reajustam os preços uma vez por ano (normalmente em abril). Confira alguns
   CEPs no simulador oficial (https://www.correios.com.br/enviar → "Calcule preços e prazos") a partir
   do CEP de postagem e ajuste as tabelas abaixo. Valores em centavos. */
import { pacotePara } from "./produto.js";

// Estado de onde as camisetas serão postadas.
export const ORIGEM_UF = "SP";

/* Faixas de peso (kg) e preço de cada trecho. Acima da última faixa, soma o adicional por kg. */
const FAIXAS = [0.3, 0.5, 1, 2, 3, 5];
const TABELA = {
  PAC: {
    estadual:  { precos: [1990, 2090, 2290, 2690, 3090, 3890], kgAdicional: 450, prazo: 5 },
    regional:  { precos: [2390, 2590, 2890, 3490, 4090, 5290], kgAdicional: 600, prazo: 7 },
    nacional1: { precos: [2790, 3090, 3590, 4490, 5390, 7090], kgAdicional: 850, prazo: 9 },
    nacional2: { precos: [3290, 3690, 4390, 5690, 6990, 9490], kgAdicional: 1200, prazo: 11 },
    nacional3: { precos: [3790, 4290, 5190, 6890, 8590, 11890], kgAdicional: 1600, prazo: 13 },
  },
  SEDEX: {
    estadual:  { precos: [2290, 2490, 2890, 3590, 4290, 5690], kgAdicional: 700, prazo: 2 },
    regional:  { precos: [3190, 3590, 4290, 5590, 6890, 9490], kgAdicional: 1300, prazo: 3 },
    nacional1: { precos: [4190, 4790, 5890, 7990, 10090, 14290], kgAdicional: 2100, prazo: 4 },
    nacional2: { precos: [5290, 6090, 7690, 10690, 13690, 19690], kgAdicional: 3000, prazo: 5 },
    nacional3: { precos: [6290, 7290, 9290, 13090, 16890, 24490], kgAdicional: 3800, prazo: 6 },
  },
};

/* Faixas de CEP de cada estado (cinco primeiros dígitos). */
const FAIXAS_CEP = [
  ["SP", 1000, 19999], ["RJ", 20000, 28999], ["ES", 29000, 29999], ["MG", 30000, 39999],
  ["BA", 40000, 48999], ["SE", 49000, 49999], ["PE", 50000, 56999], ["AL", 57000, 57999],
  ["PB", 58000, 58999], ["RN", 59000, 59999], ["CE", 60000, 63999], ["PI", 64000, 64999],
  ["MA", 65000, 65999], ["PA", 66000, 68899], ["AP", 68900, 68999], ["AM", 69000, 69299],
  ["RR", 69300, 69399], ["AM", 69400, 69899], ["AC", 69900, 69999], ["DF", 70000, 72799],
  ["GO", 72800, 72999], ["DF", 73000, 73699], ["GO", 73700, 76799], ["RO", 76800, 76999],
  ["TO", 77000, 77999], ["MT", 78000, 78899], ["MS", 79000, 79999], ["PR", 80000, 87999],
  ["SC", 88000, 89999], ["RS", 90000, 99999],
];
const REGIAO = { AC: "N", AM: "N", AP: "N", PA: "N", RO: "N", RR: "N", TO: "N", AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE", DF: "CO", GO: "CO", MT: "CO", MS: "CO", ES: "SE", MG: "SE", RJ: "SE", SP: "SE", PR: "S", RS: "S", SC: "S" };
// Distância entre regiões: 1 = próximas, 3 = mais distantes.
const DISTANCIA = { "SE-S": 1, "SE-CO": 1, "SE-NE": 2, "SE-N": 3, "S-CO": 2, "S-NE": 3, "S-N": 3, "CO-NE": 2, "CO-N": 2, "NE-N": 2 };

export function ufDoCep(cep) {
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const n = Number(d.slice(0, 5));
  const f = FAIXAS_CEP.find(([, ini, fim]) => n >= ini && n <= fim);
  return f ? f[0] : null;
}

export function trecho(ufOrigem, ufDestino) {
  if (ufOrigem === ufDestino) return "estadual";
  const a = REGIAO[ufOrigem], b = REGIAO[ufDestino];
  if (a === b) return "regional";
  return "nacional" + (DISTANCIA[`${a}-${b}`] || DISTANCIA[`${b}-${a}`] || 3);
}

function preco({ precos, kgAdicional }, pesoKg) {
  const i = FAIXAS.findIndex((f) => pesoKg <= f);
  if (i >= 0) return precos[i];
  return precos.at(-1) + Math.ceil(pesoKg - FAIXAS.at(-1)) * kgAdicional;
}

/* Frete para `qtd` camisetas até o CEP. Devolve null se o CEP não existir. */
export function calcularFrete(cep, qtd, diasParaPostar = 0) {
  const uf = ufDoCep(cep);
  if (!uf || !(qtd > 0)) return null;
  const t = trecho(ORIGEM_UF, uf);
  const { pesoKg } = pacotePara(qtd);
  const opcoes = Object.entries(TABELA).map(([id, trechos]) => ({
    id, nome: id, valor: preco(trechos[t], pesoKg), prazo: trechos[t].prazo + diasParaPostar,
  }));
  return { uf, trecho: t, opcoes };
}
