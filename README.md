# Loja da camiseta · Inauguração do Templo do Núcleo Estrela Bonita

Landing page de venda da camiseta comemorativa da inauguração do templo do **Núcleo Estrela Bonita** (2027), publicada em **camiseta.cruzeirogestao.com.br**. A Cruzeiro Gestão aparece como vendedora, no rodapé.

- A camiseta é **amarela** (cor única), em dois modelos: **Básica** (adulto, PP ao G5) e **Infantil** (2 a 10 anos). A pessoa escolhe **modelo, tamanho e quantidade**, pode juntar modelos e tamanhos diferentes na **sacola** e escolhe a **retirada grátis no núcleo** (já marcada) ou o **frete dos Correios** (PAC e SEDEX, com valor e prazo, digitando o CEP).
- O pagamento é no **boleto em até 3x**, só para quem está na **lista de cadastrados** do núcleo: a pessoa acha o próprio nome, escolhe as parcelas e, na hora de confirmar, digita o nome e sobrenome. Pix e cartão (PagBank) estão desligados e **não aparecem** na loja.
- O **acesso admin** pede a senha e baixa na hora uma **planilha Excel** com todos os pedidos.

## Como publicar (GitHub + Vercel)

Esta pasta é o site inteiro: páginas, fotos e as funções do servidor (`api/`). Não há nada para instalar nem compilar.

### 1. GitHub

- **Repositório novo só para a loja:** crie o repositório no GitHub e envie **o conteúdo desta pasta** (o `index.html`, o `package.json` e a pasta `api` ficam na raiz do repositório).
- **Ou** use este mesmo repositório (`Concursos`), onde a loja está na pasta `camiseta`.

### 2. Vercel: criar o projeto

1. Na Vercel, **Add New → Project** e importe o repositório.
2. **Framework Preset:** *Other*. Não mexa em Build Command, Output Directory nem Install Command (deixe em branco).
3. **Root Directory:** deixe em branco se o site está na raiz do repositório; se usar o repositório `Concursos`, escolha `camiseta`.
4. Clique em **Deploy**. A loja já abre, mas **o pedido no boleto e o admin só funcionam depois do passo 3**.

### 3. Vercel: banco de dados (obrigatório)

Os pedidos ficam guardados num banco Redis. Sem ele, o boleto avisa a pessoa para tentar mais tarde e não registra nada.

1. No projeto, abra a aba **Storage → Create Database** e escolha **Upstash for Redis** (o plano **Free** é suficiente).
2. Conecte o banco ao projeto (Production, Preview e Development). As variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` são criadas sozinhas. Se a tela pedir um prefixo para as variáveis, pode usar qualquer um: a loja encontra as variáveis com ou sem prefixo.
3. Vá em **Deployments**, abra o último deploy e clique em **Redeploy** (as variáveis só valem para deploys feitos depois delas).

### 4. Domínio

Em **Settings → Domains**, adicione `camiseta.cruzeirogestao.com.br`. No DNS do domínio `cruzeirogestao.com.br`, crie o registro que a Vercel pedir (normalmente um `CNAME` de `camiseta` para o endereço indicado pela Vercel).

### 5. Conferir antes de divulgar

1. Abra a loja, escolha uma camiseta, finalize com o seu nome da lista e confirme o pedido (uma vez com retirada e outra pelos Correios).
2. Abra `/admin` (botão **Acesso admin** no rodapé), digite a senha do admin e confira os pedidos na planilha.
3. Confira o estado de postagem (`ORIGEM_UF`) e a tabela de frete em `correios.js`.

Os pedidos de teste ficam na planilha (marcados com a data e o nome). Para apagar, use o painel do Upstash (aba **Data Browser**) ou crie um banco novo antes de abrir as vendas.

## Como funciona a compra no boleto

1. Na finalização, a pessoa digita pelo menos 3 letras do nome e escolhe o seu na lista (acentos e maiúsculas não importam; "marcelo mart" acha "Marcelo Martinatti").
2. Escolhe em quantas vezes: **1x, 2x ou 3x**. Cada opção mostra o valor do boleto; quando o centavo não divide, ele vai na primeira parcela (R$ 100,00 em 3x = R$ 33,34 + R$ 33,33 + R$ 33,33).
3. Com a **retirada no núcleo** (já marcada), não preenche endereço. Se preferir **Correios**, digita o CEP e completa o endereço.
4. Na hora de confirmar, aparece o campo **Confirme o seu nome e sobrenome**. É pedido a cada pedido e precisa de pelo menos duas palavras; **não há conferência** com o nome escolhido na lista: o que a pessoa digitou vai para a planilha, na coluna **Nome confirmado**.
5. Clica em **Confirmar pedido**: o pedido fica registrado e a pessoa vê a página de pedido recebido, com o número do pedido e o valor de cada parcela.

O valor vai no **boleto do mês subsequente** da pessoa (parcelado, cada parcela no boleto de um mês); o núcleo lança a partir da planilha do admin. O site não gera boleto bancário. A página de pedido recebido mostra a estampa da camiseta, o número do pedido, as parcelas e esse aviso.

**Lista de cadastrados:** fica em `api/_cadastrados.js`, com o **nome completo** de cada pessoa, um por linha (110 nomes, da planilha do núcleo). Para incluir alguém, acrescente uma linha; para corrigir um nome, edite a linha e faça o deploy de novo (no GitHub, basta salvar a alteração). A lista não é publicada como arquivo: a busca devolve no máximo 8 nomes por vez, só para quem digitou pelo menos 3 letras.

```js
export const CADASTRADOS = [
  "Christian Santos de Santana",
  "Luis Carlos",
  // ...
];
```

**Configuração:** o bloco `PAGAMENTO` em `produto.js` liga e desliga as formas de pagamento e guarda os textos (`publico`, `aviso`, `semNome`) e o máximo de parcelas (`parcelasMax: 3`).

## Acesso admin

No rodapé da loja há o botão **Acesso admin**, que abre `/admin`. A tela só pede a **senha** (a combinada com o núcleo; maiúsculas e minúsculas contam); com a senha certa, a planilha **Excel** (`pedidos-camiseta-AAAA-MM-DD-HHhMM.xlsx`) é baixada na hora, com todos os pedidos. Não há painel.

A planilha tem três abas, com o cabeçalho fixo e filtro em cada coluna:

- **Pedidos:** um pedido por linha — data e hora (de Brasília), número do pedido, forma de pagamento, status, **nome** (o escolhido na lista), **nome confirmado** (como a pessoa digitou), peças, itens, valor das camisetas, entrega (retirada ou Correios PAC/SEDEX), frete, total, número de parcelas, o valor de cada parcela, prazo, CEP e endereço completo. No fim, a linha de totais.
- **Itens:** uma linha por item (modelo, tamanho, cor, quantidade e valores), para separar as camisetas.
- **Tamanhos:** quantas camisetas há de cada modelo e tamanho, para a produção.

**Senha:** fica guardada no servidor como hash (nunca vai para a página). Para trocar, defina a variável `ADMIN_SENHA` na Vercel (**Settings → Environment Variables**) com a senha nova e faça um redeploy. São permitidas 10 tentativas a cada 15 minutos por endereço de internet.

## Textos e vídeo

Tudo em `produto.js`:

- **`TEXTOS`**: um bloco para Marcelo Martinatti e outro para Christian Santana, na seção "Palavras". Em cada um: `paragrafos` (um item por parágrafo), `titulo` (opcional) e `papel` (opcional, aparece abaixo do nome).
- **`VIDEO`**: hoje com o vídeo `https://youtu.be/Acw1NEagnQA`. Para trocar, cole outro link do YouTube em `youtube` **ou** o caminho de um arquivo em `arquivo` (ex.: `fotos/video.mp4`). O vídeo só carrega quando a pessoa toca no play e toca dentro da própria página.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `produto.js` | **Tudo o que se edita no dia a dia**: evento, preço, parcelas, formas de pagamento, retirada, cores, tamanhos, medidas e textos. A página e o servidor leem este mesmo arquivo. |
| `correios.js` | Calculadora de frete: estado de origem, tabela de preços e prazos do PAC e do SEDEX. Usada pela página (valor na hora) e pelo servidor (valor cobrado), então os dois sempre batem. |
| `index.html` | A loja (capa, compra, templo, vídeo, estampa, palavras, tabela de medidas, como comprar — só no computador —, sacola e finalização). No celular, uma barra de compra fixa aparece a partir da escolha do modelo e do tamanho, com a escolha, o valor e o botão **Comprar**, que leva direto à sacola. |
| `obrigado.html` | Página de pedido recebido, com as parcelas e os próximos passos. |
| `admin.html` | Acesso admin: senha e download da planilha. |
| `api/_cadastrados.js` | **Lista de cadastrados** (nomes completos). |
| `api/cadastro.js` | Busca de nomes na lista. |
| `api/boleto.js` | Registra o pedido no boleto: confere o nome na lista, recalcula preço e frete no servidor, divide em parcelas e guarda no banco com o nome confirmado. |
| `api/admin.js` e `api/_xlsx.js` | Confere a senha e gera a planilha Excel (sem dependências). |
| `api/_lib.js`, `api/_pedido.js` | Funções compartilhadas (arquivos com `_` não viram rota na Vercel). |
| `api/checkout.js`, `api/pagbank-webhook.js` | PagBank (Pix e cartão), desligado por enquanto. |
| `package.json`, `vercel.json` | Configuração da Vercel (módulos JavaScript e endereços sem `.html`). |

As funções seguem o formato das Vercel Functions com `Request`/`Response` da Web (`export default { fetch }`), rodam no Node.js e não usam nenhuma biblioteca externa.

## Modelos, tamanhos e preço

Em `produto.js`, no bloco `PRODUTO.modelos`, cada modelo tem os seus tamanhos e as medidas da peça (tórax e comprimento, em centímetros):

| Modelo | Tamanhos |
| --- | --- |
| Básica (adulto) | PP, P, M, G, GG, G1, G3, G5 |
| Infantil (2 a 10 anos) | 2, 4, 6, 8, 10 |

Os dois modelos custam o `preco` do produto (R$ 100,00). Para cobrar outro valor num modelo, acrescente `preco` nele (em centavos, ex.: `preco: 8000`).

## Retirada grátis no núcleo

A opção **Retirada no Núcleo Estrela Bonita** aparece junto do frete, grátis e sem CEP, e **já vem marcada**; quem digita o CEP passa para os Correios. Com a retirada, o pedido não pede endereço, sai sem frete e o número do pedido termina em `-RETIRADA`. Os textos ficam no bloco `RETIRADA` em `produto.js`; `ativa: false` esconde a opção.

## Frete (calculadora dos Correios)

1. O estado do CEP de destino sai das faixas de CEP de cada UF; a cidade aparece pelo ViaCEP, quando ele responde.
2. O trecho é **estadual**, **regional** ou **nacional 1, 2 ou 3** (regiões cada vez mais distantes).
3. O peso é o da embalagem (`pacote` em `produto.js`) vezes a quantidade de peças, e o preço sai da faixa de peso do trecho.
4. O prazo mostrado é o prazo do trecho mais `diasParaPostar`.

**Antes de vender:** troque `ORIGEM_UF` em `correios.js` pelo estado de onde as camisetas serão postadas e confira a tabela no simulador oficial dos Correios ([Calcule preços e prazos](https://www.correios.com.br/enviar)). Os Correios reajustam os preços uma vez por ano, normalmente em abril.

## Imagens

Ficam em `fotos/`, em WebP (e uma JPG para compartilhamento em redes sociais):

| Arquivo | Onde aparece |
| --- | --- |
| `capa-modelo.webp` | Capa: o modelo, os raios dourados e a camiseta de costas. |
| `camiseta-frente.webp`, `camiseta-costas.webp`, `camiseta-modelo-frente.webp`, `camiseta-modelo-lado.webp` | Galeria da compra, nesta ordem. |
| `marcelo.webp`, `christian.webp` | Retratos na seção "Palavras". |
| `templo-traco.webp` | O templo a traço, esmaecido no fundo da capa. |
| `estampa.webp` | A arte da frente, em traço com fundo transparente. |
| `templo-fachada.webp`, `templo-salao.webp`, `templo-salao-fundo.webp` | Seção "O templo", chamada final e capa do vídeo. |
| `compartilhar.jpg` | Imagem que aparece quando o link é compartilhado (WhatsApp, Instagram etc.). |

## Testar no computador (opcional)

Com o [Vercel CLI](https://vercel.com/docs/cli) instalado e o projeto ligado (`vercel link`), rode `vercel env pull` para trazer as variáveis do banco e depois `vercel dev`. Abra `http://localhost:3000`.

## Pix e cartão (PagBank), quando a conta for liberada

O código do PagBank já está pronto, mas desligado: enquanto `pagbank.ativo` for `false` em `produto.js`, a opção não aparece na loja e a rota do checkout recusa o pedido. Para ligar:

1. No PagBank, gere o token com permissão para criar checkout (`checkout.create`).
2. Na Vercel, defina as variáveis abaixo e troque `pagbank.ativo` para `true` em `produto.js`. A pessoa passa a escolher entre o boleto e o Pix/cartão.

| Variável | Valor |
| --- | --- |
| `PAGBANK_TOKEN` | Token da conta PagBank (no painel: *Venda online → Integrações → Gerar token*). Para testes, o token do ambiente sandbox. |
| `PAGBANK_AMBIENTE` | `sandbox` para testes ou `producao` para vender de verdade. Padrão: `sandbox`. |
| `SITE_URL` | Opcional. Endereço público da loja (`https://camiseta.cruzeirogestao.com.br`), usado no retorno e nas notificações. |

O PagBank hospeda a tela de pagamento (os dados do cartão nunca passam pelo nosso servidor) e avisa o pagamento em `api/pagbank-webhook.js`, que atualiza o pedido na planilha.
