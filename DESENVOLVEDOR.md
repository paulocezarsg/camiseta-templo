# Guia técnico · Loja da camiseta da Inauguração do Templo

Este pacote é o site completo, igual ao que está publicado na Vercel. O `README.md` traz o uso (publicação, lista de cadastrados, admin e painel). Este guia é para quem vai manter ou integrar o código.

## Visão geral

- **Sem framework e sem dependências.** As páginas são HTML com JavaScript em módulos ES (`<script type="module">`). As funções do servidor ficam em `api/`, no formato das Vercel Functions com `Request`/`Response` da Web (`export default { fetch }`), e rodam no Node.js 20 ou mais novo (usam `node:crypto` e `node:zlib`).
- **Não há build.** O `package.json` existe só para declarar `"type": "module"`, e o `vercel.json` só liga o `cleanUrls` (endereços sem `.html`: `/admin`, `/obrigado`).
- **Banco de dados:** Upstash Redis, acessado pela API REST (sem cliente instalado).
- **Os mesmos arquivos de regra** (`produto.js` e `correios.js`) são usados pela página e pelo servidor. O servidor sempre recalcula preço, frete e parcelas: o valor que vem do navegador nunca é usado.

## Arquivos

| Caminho | Função |
| --- | --- |
| `index.html` | A loja: capa, compra, sacola e finalização no boleto (CSS e JS no próprio arquivo). |
| `obrigado.html` | Página de pedido recebido (lê `?pedido=` e `?forma=boleto` e o último pedido do `localStorage`). |
| `admin.html` | Acesso admin (baixa a planilha) e painel de pedidos (lista, alteração, cancelamento). |
| `produto.js` | Configuração e regras: evento, textos, vídeo, preço, modelos, tamanhos, medidas, formas de pagamento, retirada, `parcelasDe()`. |
| `correios.js` | Tabela de frete (PAC e SEDEX) por trecho e faixa de peso; `calcularFrete(cep, qtd, dias)`. Origem: `ORIGEM_UF = "SP"`. |
| `fotos/` | Imagens em WebP (e uma JPG para compartilhamento). A galeria da compra segue a lista `PRODUTO.cores[].fotos`. |
| `api/_cadastrados.js` | Lista de nomes completos de quem pode comprar no boleto: os sócios do Núcleo Estrela Bonita (110 nomes). |
| `api/_lib.js` | Utilitários: respostas JSON, erros, leitura do corpo, rota por método, senha (scrypt), Redis REST, limite de tentativas, pedidos. |
| `api/_pedido.js` | Leitura e validação da sacola, cliente, entrega e da lista de cadastrados (busca e conferência). |
| `api/_xlsx.js` | Gerador de `.xlsx` sem dependências (abas de tabela e aba de painel). |
| `api/cadastro.js` | `GET` busca de nomes. |
| `api/boleto.js` | `POST` cria o pedido no boleto. |
| `api/admin.js` | `POST` gera a planilha Excel. |
| `api/painel.js` | `POST` listar, alterar, cancelar e reativar pedidos. |
| `api/checkout.js`, `api/pagbank-webhook.js` | PagBank (Pix e cartão), ligado e desligado em `PAGAMENTO.pagbank.ativo` (`produto.js`). Hoje desligado: a conta aguarda a homologação do PagBank (403 `Allowlist access required`). |

Arquivos que começam com `_` não viram rota na Vercel e não são publicados como arquivo estático.

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `KV_REST_API_URL` e `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`) | Sim | Banco Upstash Redis (REST). Também são aceitas com prefixo (ex.: `STORAGE_KV_REST_API_URL`). Use o token normal, não o "read-only". |
| `ADMIN_SENHA` | Não | Substitui a senha do admin (planilha). Sem ela, vale o hash em `api/admin.js`. |
| `PAINEL_SENHA` | Não | Substitui a senha do painel de pedidos. Sem ela, vale o hash em `api/painel.js`. |
| `PAGBANK_TOKEN` e `PAGBANK_AMBIENTE` | Com o PagBank ligado | Token da conta (Vendas → Integrações → Gerar Token) e `producao` (sem ela, o site usa o sandbox). |
| `SITE_URL` | Não | Endereço público da loja, para o retorno e as notificações do PagBank. Sem ela, vale o endereço de onde veio o pedido. |

As senhas não aparecem em texto no código, só o hash scrypt (`sal:hash` em base64, N=16384, r=8, p=1, 32 bytes). As senhas atuais são as combinadas com o núcleo. Para trocar, defina a variável correspondente na Vercel e faça um redeploy.

## Rotas da API

Todas respondem JSON (exceto a planilha), com `{ error }` e o status HTTP em caso de erro (às vezes com `campo`, indicando o campo com problema). Métodos não usados recebem `405`.

### `GET /api/cadastro?busca=texto`
Busca na lista de cadastrados (mínimo de 3 letras, sem acento e sem maiúsculas; cada palavra digitada é o começo de uma palavra do nome). Responde `{ pronta, resultados: [{ id, nome }] }`, no máximo 8.

### `POST /api/boleto`
```json
{ "itens": [{ "cor": "amarela", "modelo": "basica", "tamanho": "G", "qtd": 1 }],
  "cadastro": "marcelo-martinatti", "parcelas": 3, "frete": "RETIRADA",
  "endereco": null, "confirmacao": "Marcelo Martinatti" }
```
`frete`: `RETIRADA`, `PAC` ou `SEDEX` (com `endereco: { cep, rua, numero, complemento, bairro, cidade, uf }`). `confirmacao` é o nome e sobrenome digitados pela pessoa (pelo menos duas palavras, sem conferência com a lista). Responde `{ referencia, total, parcelas: [centavos...] }`. Sem banco configurado, responde `503` e não registra.

### `POST /api/checkout` (PagBank)
```json
{ "itens": [{ "cor": "amarela", "modelo": "basica", "tamanho": "G", "qtd": 1 }],
  "cliente": { "nome": "Maria da Silva", "email": "maria@exemplo.com", "celular": "11987654321", "cpf": "12345678909" },
  "frete": "RETIRADA", "endereco": null }
```
Cria um checkout no PagBank (`POST /checkouts`, com Pix, cartão de crédito em até 3x sem juros e débito), grava o pedido com status `aguardando` e responde `{ url, referencia }`; a página leva a pessoa para `url`. Na volta, o PagBank abre `/obrigado?pedido=<referência>`.

### `POST /api/pagbank-webhook`
Recebe os avisos do PagBank (o endereço vai em cada checkout, nada a configurar no painel). Confere o cabeçalho `x-authenticity-token` (= sha256 de `PAGBANK_TOKEN + "-" + corpo`) e grava no pedido o status (`pago`, `em análise`, `aguardando`, `recusado`, `cancelado`) e o pagamento (`metodo`, `parcelas`, `valor`, `pagoEm`, `ordemId`).

### `POST /api/admin`
`{ "senha": "..." }` → arquivo `.xlsx` (`Content-Disposition` com o nome `pedidos-camiseta-AAAA-MM-DD-HHhMM.xlsx` e o cabeçalho `X-Pedidos` com a quantidade). Abas: **Painel**, **Pedidos**, **Itens**, **Tamanhos** e **Por pessoa**. Entram só os pedidos que valem: no boleto (fora os cancelados) e PagBank com status `pago` ou `em análise`.

### `POST /api/painel`
Todas as ações levam `senha` (a do painel).
- `{ "acao": "listar" }` → `{ pedidos, cadastrados }` (todos os pedidos, inclusive cancelados, do mais recente para o mais antigo, e a lista de nomes).
- `{ "acao": "alterar", "ref", "por", "dados": { nome, itens, entrega, endereco, parcelas, observacao } }` → `{ pedido }`. Só pedidos no boleto e não cancelados. `por` é o nome de quem altera; `dados.nome` é o comprador (um nome exato da lista); `dados.entrega` é `RETIRADA`, `PAC` ou `SEDEX`. Total e parcelas são recalculados.
- `{ "acao": "cancelar", "ref", "por", "motivo" }` → `{ pedido }`.
- `{ "acao": "reativar", "ref", "por" }` → `{ pedido }`.

### Limites por endereço de internet
| Chave | Limite |
| --- | --- |
| `cam:busca:IP` | 600 buscas a cada 10 minutos |
| `cam:boleto:IP` | 120 pedidos por hora |
| `cam:tentativas:IP` | 10 tentativas de senha do admin a cada 15 minutos |
| `cam:painel-erros:IP` | 10 senhas erradas do painel a cada 15 minutos (só as erradas contam) |

## Dados (Upstash Redis)

Todas as chaves da loja começam com `cam:`. O mesmo banco pode ser compartilhado com outros sistemas, desde que eles não usem esse prefixo.

- `cam:pedido:<referência>`: o pedido em JSON.
- `cam:pedidos`: conjunto ordenado (`ZADD`) com as referências, pontuadas pela data de criação.
- As demais (`cam:busca:*`, `cam:boleto:*`, `cam:tentativas:*`, `cam:painel-erros:*`) são contadores com prazo de validade.

Para zerar só os dados da loja, sem mexer em outros sistemas do mesmo banco, no CLI do Upstash:
```
EVAL "local k = redis.call('KEYS', 'cam:*') for i = 1, #k do redis.call('DEL', k[i]) end return #k" 0
```

### Formato de um pedido
Valores em centavos e datas em milissegundos (UTC).
```json
{
  "ref": "CG-MW9XWMO1C337-RETIRADA",
  "criadoEm": 1794266190145,
  "status": "aguardando-boleto",
  "forma": "boleto",
  "cliente": { "nome": "Marcelo Martinatti", "cadastroId": "marcelo-martinatti", "nomeConfirmado": "Marcelo Martinatti" },
  "itens": [{ "cor": "Amarela", "modelo": "Básica", "tamanho": "G", "qtd": 2, "unitario": 10000 }],
  "pecas": 2,
  "entrega": { "tipo": "RETIRADA", "valor": 0 },
  "subtotal": 20000,
  "total": 20000,
  "pagamento": { "metodo": "BOLETO", "parcelas": 3, "valores": [6668, 6666, 6666] },
  "entregue": false,
  "observacao": "Pediu mais uma peça",
  "historico": [{ "em": 1794266190145, "status": "aguardando-boleto" }],
  "alteracoes": [{ "em": 1794266190815, "por": "Maria", "mudancas": [{ "campo": "Parcelamento", "de": "1x", "para": "3x" }] }]
}
```
- `status`: `aguardando-boleto` (registrado) ou `cancelado`. No PagBank: `aguardando`, `pago`, `em análise`, `recusado`, `cancelado`.
- `entrega` pelos Correios: `{ "tipo": "PAC", "valor": 2090, "prazo": 8, "endereco": { "cep": "01310100", ... } }`.
- `observacao` e `alteracoes` só aparecem depois de uma alteração pelo painel. Cada alteração guarda quem fez, quando e o que mudou (de → para).
- Cancelado: `"cancelamento": { "em", "por", "motivo" }`. O campo sai ao reativar.
- O `ref` termina em `-RETIRADA` quando o pedido foi feito com retirada (o sufixo não muda se a entrega for alterada depois).

## Regras de negócio

- **Preço:** `PRODUTO.preco` (R$ 100,00); um modelo pode ter `preco` próprio.
- **Cartão (PagBank):** até 3x (`PRODUTO.parcelasMax`), todas sem juros para o cliente (`PRODUTO.parcelasSemJuros`).
- **Parcelas no boleto:** 1x a 3x (`PAGAMENTO.boleto.parcelasMax`). `parcelasDe(total, n)` divide em centavos e o que sobra vai na **primeira** parcela (R$ 100,00 em 3x = 33,34 + 33,33 + 33,33).
- **Boleto do mês subsequente:** a 1ª parcela entra no boleto do mês seguinte ao pedido (horário de Brasília) e as demais nos meses depois. É assim que a aba "Por pessoa" soma o valor de cada mês.
- **Entrega:** retirada no núcleo (grátis, já marcada) ou Correios pela tabela de `correios.js` (peso por peça em `PRODUTO.pacote`; prazo = trecho + `diasParaPostar`).
- **Limite:** 30 peças por pedido (`PRODUTO.maxPorPedido`).
- **Lista de cadastrados:** a página nunca recebe a lista inteira, só os nomes que batem com a busca. O painel (com senha) recebe a lista inteira para escolher o comprador.

## Rodar no computador

Com o [Vercel CLI](https://vercel.com/docs/cli):
```bash
vercel link        # liga a pasta ao projeto
vercel env pull    # traz as variáveis do banco
vercel dev         # http://localhost:3000
```
A página abre sem banco (a busca de nomes e o frete funcionam), mas registrar pedidos, baixar a planilha e o painel precisam das variáveis do Upstash.

## Levar para outra plataforma

- **As páginas** são arquivos estáticos e funcionam em qualquer hospedagem, desde que `/api/...` aponte para as funções e `/admin` e `/obrigado` sirvam os `.html` correspondentes.
- **Cada arquivo de `api/`** exporta `default { fetch(request) }` e devolve um `Response`. Em outro servidor Node (Express, Fastify, Next.js e similares), basta chamar esse `fetch` com um `Request` montado a partir da requisição e devolver a resposta. Não há estado em memória: tudo fica no Redis.
- **Os módulos de regra** (`produto.js`, `correios.js`) ficam na raiz e são importados com caminho relativo (`../produto.js`) pelas funções. Mantenha essa estrutura ou ajuste os imports.
