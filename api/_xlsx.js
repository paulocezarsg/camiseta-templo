/* Gera um .xlsx de verdade (abre no Excel, Google Planilhas e LibreOffice) sem dependências.
   planilha([{ nome, colunas: [{ titulo, largura, tipo }], linhas: [[...]], rodape: [[...]] }]) -> Buffer
   tipo: "texto" (padrão), "moeda" (centavos -> R$), "data" (timestamp em ms, hora de Brasília), "inteiro".
   As linhas do rodapé (totais) saem em negrito, depois de uma linha em branco, fora do filtro. */
import { deflateRawSync } from "node:zlib";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// estilos (índices em cellXfs): 0 normal, 1 cabeçalho, 2 moeda, 3 data, 4 inteiro, 5-8 os mesmos em negrito
const ESTILO = { texto: 0, moeda: 2, data: 3, inteiro: 4 };
const NEGRITO = { texto: 5, moeda: 6, data: 7, inteiro: 8 };
const ESTILOS = `${CAB}<styleSheet ${NS}>
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFCF4EA"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF451B0A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="1" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const coluna = (i) => { let s = ""; for (i += 1; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
// Excel conta dias desde 30/12/1899; o horário vai em Brasília (UTC-3, sem horário de verão desde 2019)
const serialExcel = (ms) => (ms - 3 * 3600_000) / 86400_000 + 25569;

function celula(ref, valor, tipo, negrito) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = (negrito ? NEGRITO : ESTILO)[tipo] ?? 0;
  const st = s ? ` s="${s}"` : "";
  if (tipo === "moeda" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${Number(valor) / 100}</v></c>`;
  if (tipo === "data" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${serialExcel(Number(valor))}</v></c>`;
  if (tipo === "inteiro" && Number.isFinite(Number(valor))) return `<c r="${ref}"${st}><v>${Number(valor)}</v></c>`;
  const ns = negrito ? ` s="${NEGRITO.texto}"` : "";
  return `<c r="${ref}" t="inlineStr"${ns}><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
}

function aba({ colunas, linhas, rodape = [] }) {
  const ult = coluna(colunas.length - 1);
  const xmlLinha = (n, vals, cabecalho, negrito) =>
    `<row r="${n}">${vals.map((v, i) => cabecalho
      ? `<c r="${coluna(i)}${n}" t="inlineStr" s="1"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
      : celula(coluna(i) + n, v, colunas[i]?.tipo || "texto", negrito)).join("")}</row>`;
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

export function planilha(abas) {
  const nomes = abas.map((a) => String(a.nome).replace(/[\\/?*[\]:']/g, " ").slice(0, 31));
  const folhas = abas.map(aba);
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
      + `</sheets><definedNames>`
      + folhas.map((f, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(nomes[i])}'!${f.filtro}</definedName>`).join("")
      + `</definedNames></workbook>`],
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
