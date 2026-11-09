/* Gera um .xlsx de verdade (abre no Excel, Google Planilhas e LibreOffice) sem dependências.
   planilha([aba, ...]) -> Buffer. Dois tipos de aba:
   - tabela: { nome, colunas: [{ titulo, largura, tipo }], linhas: [[...]], rodape: [[...]] }
     tipo: "texto" (padrão), "moeda" (centavos -> R$), "data" (timestamp em ms, hora de Brasília), "inteiro".
     Cabeçalho fixo e filtro; as linhas do rodapé (totais) saem em negrito, depois de uma linha em branco.
   - painel: { nome, painel: true, larguras: [...], celulas: [[ref, valor, estilo]], mesclas: ["B2:I2"], alturas: { 2: 30 } }
     Sem linhas de grade; estilo é um nome de PAINEL (abaixo). Moeda em centavos; percentual de 0 a 1. */
import { deflateRawSync } from "node:zlib";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* ===================== estilos ===================== */
const fonte = (sz, { b, i, cor } = {}) => `<font>${b ? "<b/>" : ""}${i ? "<i/>" : ""}<sz val="${sz}"/>${cor ? `<color rgb="FF${cor}"/>` : ""}<name val="Calibri"/><family val="2"/></font>`;
const FONTES = [
  fonte(11), fonte(11, { b: 1, cor: "FCF4EA" }), fonte(11, { b: 1 }),            // 0 normal, 1 cabeçalho, 2 negrito
  fonte(22, { b: 1, cor: "451B0A" }), fonte(9, { b: 1, cor: "8A4718" }),          // 3 número do cartão, 4 rótulo do cartão
  fonte(20, { b: 1, cor: "451B0A" }), fonte(10, { i: 1, cor: "6B5A4B" }),         // 5 título, 6 subtítulo
  fonte(11, { cor: "DB992D" }), fonte(13, { b: 1, cor: "451B0A" }), fonte(14, { b: 1, cor: "451B0A" }), // 7 barra, 8 seção, 9 texto do cartão
];
const preenche = (cor) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${cor}"/><bgColor indexed="64"/></patternFill></fill>`;
const PREENCHIMENTOS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', preenche("451B0A"), preenche("FBF0DA")];
const BORDAS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE8DBC6"/></bottom><diagonal/></border>',
  // cartões: bordas brancas grossas nas laterais separam um cartão do outro
  '<border><left style="thick"><color rgb="FFFFFFFF"/></left><right style="thick"><color rgb="FFFFFFFF"/></right><top/><bottom/><diagonal/></border>',
];
// formatos: 164 moeda, 165 data e hora, 166 uma casa decimal; 1 "0", 3 "#,##0", 9 "0%"
const FORMATOS = '<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>';
const xf = (num, font, fill = 0, borda = 0, alinha = "") =>
  `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${borda}" xfId="0"${num ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${borda ? ' applyBorder="1"' : ""}${alinha ? ` applyAlignment="1"><alignment ${alinha}/></xf>` : "/>"}`;
const CARTAO = 'horizontal="left" vertical="center" indent="1"';
const XFS = [
  /* 0-8: abas de tabela */
  xf(0, 0), xf(0, 1, 2), xf(164, 0), xf(165, 0), xf(1, 0), xf(0, 2), xf(164, 2), xf(165, 2), xf(1, 2),
  /* 9 título, 10 subtítulo, 11 rótulo do cartão, 12-15 número do cartão (inteiro, moeda, decimal, texto), 16 seção */
  xf(0, 5, 0, 0, 'vertical="center"'), xf(0, 6), xf(0, 4, 3, 2, 'horizontal="left" vertical="bottom" indent="1"'),
  xf(3, 3, 3, 2, CARTAO), xf(164, 3, 3, 2, CARTAO), xf(166, 3, 3, 2, CARTAO), xf(0, 9, 3, 2, CARTAO), xf(0, 8, 0, 0, 'vertical="bottom"'),
  /* 17 cabeçalho de tabela (texto), 18 cabeçalho à direita, 19-23 linhas: texto, inteiro, moeda, percentual, barra */
  xf(0, 1, 2, 0, 'vertical="center" indent="1"'), xf(0, 1, 2, 0, 'horizontal="right" vertical="center"'),
  xf(0, 0, 0, 1, 'vertical="center" indent="1"'), xf(3, 0, 0, 1, 'vertical="center"'), xf(164, 0, 0, 1, 'vertical="center"'), xf(9, 0, 0, 1, 'vertical="center"'), xf(0, 7, 0, 1, 'vertical="center" indent="1"'),
  /* 24 texto discreto (sem dados) */
  xf(0, 6, 0, 1, 'vertical="center" indent="1"'),
];
const ESTILOS = `${CAB}<styleSheet ${NS}>${FORMATOS}<fonts count="${FONTES.length}">${FONTES.join("")}</fonts><fills count="${PREENCHIMENTOS.length}">${PREENCHIMENTOS.join("")}</fills><borders count="${BORDAS.length}">${BORDAS.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${XFS.length}">${XFS.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const ESTILO = { texto: 0, moeda: 2, data: 3, inteiro: 4 };
const NEGRITO = { texto: 5, moeda: 6, data: 7, inteiro: 8 };
export const PAINEL = {
  titulo: 9, subtitulo: 10, rotulo: 11, numero: 12, valor: 13, decimal: 14, destaque: 15, secao: 16,
  cabecalho: 17, cabecalhoDir: 18, texto: 19, inteiro: 20, moeda: 21, percentual: 22, barra: 23, vazio: 24,
};
const EM_CENTAVOS = new Set([PAINEL.valor, PAINEL.moeda]);

const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const coluna = (i) => { let s = ""; for (i += 1; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const indiceColuna = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
// Excel conta dias desde 30/12/1899; o horário vai em Brasília (UTC-3, sem horário de verão desde 2019)
const serialExcel = (ms) => (ms - 3 * 3600_000) / 86400_000 + 25569;
const texto = (ref, valor, s) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;

function celula(ref, valor, tipo, negrito) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = (negrito ? NEGRITO : ESTILO)[tipo] ?? 0;
  const st = s ? ` s="${s}"` : "";
  if (tipo === "moeda" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${Number(valor) / 100}</v></c>`;
  if (tipo === "data" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${serialExcel(Number(valor))}</v></c>`;
  if (tipo === "inteiro" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${Number(valor)}</v></c>`;
  return texto(ref, valor, negrito ? NEGRITO.texto : 0);
}

function abaTabela({ colunas, linhas, rodape = [] }) {
  const ult = coluna(colunas.length - 1);
  const xmlLinha = (n, vals, cabecalho, negrito) =>
    `<row r="${n}">${vals.map((v, i) => cabecalho ? texto(`${coluna(i)}${n}`, v, 1) : celula(coluna(i) + n, v, colunas[i]?.tipo || "texto", negrito)).join("")}</row>`;
  const corpo = [xmlLinha(1, colunas.map((c) => c.titulo), true)];
  linhas.forEach((l, i) => corpo.push(xmlLinha(i + 2, l)));
  const filtroAte = linhas.length + 1;
  rodape.forEach((l, i) => corpo.push(xmlLinha(filtroAte + 2 + i, l, false, true)));
  const fim = filtroAte + (rodape.length ? rodape.length + 1 : 0);
  return {
    filtro: `$A$1:$${ult}$${filtroAte}`,
    xml: `${CAB}<worksheet ${NS} ${NS_R}>`
      + `<dimension ref="A1:${ult}${fim}"/>`
      + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>`
      + `<cols>${colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 14}" customWidth="1"/>`).join("")}</cols>`
      + `<sheetData>${corpo.join("")}</sheetData>`
      + `<autoFilter ref="A1:${ult}${filtroAte}"/>`
      + `</worksheet>`,
  };
}

/* Aba livre (o painel): cada célula com o seu estilo, células mescladas e alturas de linha. */
function abaPainel({ larguras, celulas, mesclas = [], alturas = {} }) {
  const linhas = new Map();
  for (const [ref, valor, estilo = 0] of celulas) {
    const [, letras, num] = /^([A-Z]+)(\d+)$/.exec(ref);
    const n = Number(num);
    let xml;
    if (valor === null || valor === undefined || valor === "") xml = estilo ? `<c r="${ref}" s="${estilo}"/>` : "";
    else if (typeof valor === "number" && Number.isFinite(valor)) xml = `<c r="${ref}" s="${estilo}"><v>${EM_CENTAVOS.has(estilo) ? valor / 100 : valor}</v></c>`;
    else xml = texto(ref, valor, estilo);
    if (!linhas.has(n)) linhas.set(n, []);
    linhas.get(n).push([indiceColuna(letras), xml]);
  }
  for (const n of Object.keys(alturas).map(Number)) if (!linhas.has(n)) linhas.set(n, []);
  const nums = [...linhas.keys()].sort((a, b) => a - b);
  const ult = coluna(larguras.length - 1), fim = nums.at(-1) || 1;
  const corpo = nums.map((n) => {
    const ht = alturas[n] ? ` ht="${alturas[n]}" customHeight="1"` : "";
    return `<row r="${n}"${ht}>${linhas.get(n).sort((a, b) => a[0] - b[0]).map((c) => c[1]).join("")}</row>`;
  }).join("");
  return {
    filtro: null,
    xml: `${CAB}<worksheet ${NS} ${NS_R}>`
      + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<dimension ref="A1:${ult}${fim}"/>`
      + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>`
      + `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
      + `<sheetData>${corpo}</sheetData>`
      + (mesclas.length ? `<mergeCells count="${mesclas.length}">${mesclas.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "")
      // ao imprimir ou gerar PDF, o painel cabe em uma página de largura
      + `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>`
      + `</worksheet>`,
  };
}

export function planilha(abas) {
  const nomes = abas.map((a) => String(a.nome).replace(/[\\/?*[\]:']/g, " ").slice(0, 31));
  const folhas = abas.map((a) => (a.painel ? abaPainel(a) : abaTabela(a)));
  const arquivos = [
    ["[Content_Types].xml", `${CAB}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + folhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
      + `</Types>`],
    ["_rels/.rels", `${CAB}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${CAB}<workbook ${NS} ${NS_R}><bookViews><workbookView/></bookViews><sheets>`
      + nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
      + `</sheets>`
      + (folhas.some((f) => f.filtro) ? `<definedNames>${folhas.map((f, i) => f.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(nomes[i])}'!${f.filtro}</definedName>` : "").join("")}</definedNames>` : "")
      + `</workbook>`],
    ["xl/_rels/workbook.xml.rels", `${CAB}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + folhas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${folhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", ESTILOS],
    ...folhas.map((f, i) => [`xl/worksheets/sheet${i + 1}.xml`, f.xml]),
  ];
  return zip(arquivos);
}

/* ===================== zip (deflate) ===================== */
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(arquivos) {
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, texto] of arquivos) {
    const n = Buffer.from(nome), dados = Buffer.from(texto, "utf8"), comp = deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(dia, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(hora, 12); cd.writeUInt16LE(dia, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(dados.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(pos, 42);
    partes.push(local, n, comp);
    central.push(cd, n);
    pos += 30 + n.length + comp.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, ...central, fim]);
}
