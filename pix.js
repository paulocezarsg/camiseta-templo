/* Pix estático (BR Code / "copia e cola") com a chave do núcleo. Usado pelo servidor (api/pix.js), que monta o código
   de cada pedido. O QR Code é desenhado na página a partir deste mesmo texto.
   O código não é uma cobrança criada pelo banco: o pagamento não é confirmado sozinho. O núcleo confere o Pix
   no extrato (valor, data e o identificador txid) e confirma no painel de pedidos. */

// Texto ASCII em maiúsculas, sem acentos (o formato mede o tamanho em bytes)
const ascii = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").trim();

function tlv(id, valor) {
  const v = String(valor);
  if (v.length > 99) throw new Error(`Campo ${id} do Pix grande demais.`);
  return id + String(v.length).padStart(2, "0") + v;
}

// CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos
export function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/* O txid do Pix sai do número do pedido (só letras e números, até 25): é o que se procura no extrato. */
export const txidDoPedido = (ref) => String(ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 25);

/* recebedor: { chave, nome, cidade }; valor em centavos; txid: 1 a 25 caracteres A-Z/0-9 */
export function pixCopiaECola({ recebedor, valor, txid }) {
  const chave = String(recebedor?.chave || "").trim();
  const nome = ascii(recebedor?.nome).slice(0, 25);
  const cidade = ascii(recebedor?.cidade).toUpperCase().slice(0, 15);
  if (!chave || !nome || !cidade) throw new Error("Configure a chave, o nome e a cidade do recebedor do Pix.");
  if (!/^[A-Z0-9]{1,25}$/.test(txid || "")) throw new Error("O txid do Pix deve ter de 1 a 25 letras maiúsculas ou números.");
  if (!Number.isInteger(valor) || valor <= 0) throw new Error("Valor do Pix inválido.");
  const campos =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", (valor / 100).toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", nome) +
    tlv("60", cidade) +
    tlv("62", tlv("05", txid));
  const semCrc = campos + "6304";
  return semCrc + crc16(semCrc);
}
