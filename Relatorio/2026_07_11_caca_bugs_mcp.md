# Relatório de Caça a Bugs — Portal B2B Escamax

> **Data:** 2026-07-11
> **Autor:** Assistente IA (via MCP `VP_Escamax` + leitura do código-fonte)
> **Escopo:** Vasculhamento de dados reais (pedidos, logs, catálogo, estoque) cruzado com o
> código do checkout dual-Omie. Nenhuma alteração foi feita no banco além de 1 log de teste
> (`mcp.teste`, id `781a80dc…`) e sua observação — ambos marcados como descartáveis.

---

## 0. Como cheguei aqui

Puxei via MCP: `pedidos_stats`, os últimos **50 pedidos**, **200 logs de auditoria**, o catálogo
de produtos ativos (~300), estoque VP e estoque Escamax (Piçarras), e o detalhe completo
(`get_pedido`) de 6 pedidos com falha representando cada tipo de erro. Depois cruzei cada
mensagem de erro da Omie com o código atual em `server/services/omieClient.js`,
`checkoutController.js` e `checkoutPreflight.js` para separar **o que já foi corrigido** do
**que ainda está vivo** e do **resíduo financeiro que ninguém limpou**.

**Números gerais:** 51 pedidos no total (fev: 27, mar: 24), R$ 111.695,66. Taxa de sucesso
(compra **e** venda OK): **25 de 51 ≈ 49%**. Ou seja, historicamente **≈ metade dos pedidos
falhou** em pelo menos uma das duas pontas. O último pedido é de **26/03** — o portal está
ocioso há ~3,5 meses (o sync de histórico Omie continua rodando, isso sim, até 03/07).

---

## 1. 🔴 CRÍTICO — 16 Pedidos de Compra órfãos em Piçarras (Contas a Pagar sem Contas a Receber)

O pior achado, e é **dinheiro real**. Em 16 pedidos a compra na filial foi criada com sucesso
(`pedido_compra.status = ok`, com número de pedido Omie) mas a venda na VP **falhou**
(`pedido_venda.status = erro`). Resultado: **Contas a Pagar na filial Piçarras sem a
correspondente Conta a Receber na VerticalParts**.

A compensação automática (cancelar a compra quando a venda falha) só foi adicionada em
**04/07/2026** — todos esses pedidos são de **fev/mar** e portanto **nunca foram compensados**.
Eles continuam vivos no Omie de Piçarras até hoje.

Pior ainda: boa parte é **o mesmo item (VPB-001) reenviado várias vezes** em sequência no dia
05/03 (o usuário reclicou "finalizar" a cada erro de venda), e **cada reenvio gerou um novo
Pedido de Compra**. Piçarras recebeu ~9 pedidos de compra praticamente idênticos do VPB-001.

| # | Pedido | Data | PO Omie (filial) | Valor | Causa da falha na venda |
|---|--------|------|------------------|-------|--------------------------|
| 1 | ESC-1773270444007 | 11/03 | **67** | 7.629,11 | `valor_unitario obrigatório` (item VPEL-014n preço 0) |
| 2 | ESC-1773174796287 | 10/03 | **66** | 3.337,03 | `tag [det] obrigatório` |
| 3 | ESC-1773167578684 | 10/03 | — | 3.337,03 | venda erro |
| 4 | ESC-1772739733392 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 5 | ESC-1772722379590 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 6 | ESC-1772719807471 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 7 | ESC-1772719099885 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 8 | ESC-1772718770628 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 9 | ESC-1772716416899 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 10 | ESC-1772715172839 | 05/03 | — | 3.337,03 | venda erro (VPB-001) |
| 11 | ESC-1772550818739 | 03/03 | — | 259,80 | venda erro |
| 12 | ESC-1772222117369 | 27/02 | — | 180,00 | venda erro |
| 13 | ESC-1772215500785 | 27/02 | — | 180,00 | venda erro |
| 14 | ESC-1771981569202 | 25/02 | **37** | 180,00 | `tag [OBS_INTERNAS]` inválida |
| 15 | ESC-1771981186568 | 25/02 | — | 180,00 | venda erro |
| 16 | ESC-1771981026285 | 25/02 | — | 330,00 | venda erro |

**Ação humana necessária:** reconciliar no Omie de Piçarras — cancelar/excluir esses Pedidos de
Compra (e as duplicatas do VPB-001) para não deixar passivo fantasma. Sugiro puxar `get_pedido`
de cada um para pegar o número exato do PO antes de cancelar. **O código novo não vai limpar
isso sozinho** — a compensação só age em pedidos criados de 04/07 em diante.

---

## 2. Os 5 erros de Omie: diagnóstico e status (já corrigidos no código ✅)

Todos os erros de fev/mar têm causa identificada e **já foram consertados**. O pedido de 26/03
(`ESC-1774546740201`, SP) passou nas duas pontas, provando que os fixes funcionam.

| Erro real (mensagem da Omie) | Causa raiz | Status no código atual |
|------------------------------|-----------|------------------------|
| `Categoria não cadastrada [2.01.01]` (SP) | Código de categoria `2.01.01` estava hardcoded; SP/Floripa/Salvador **não têm** essa categoria (só Piçarras e Brasília têm) | ✅ Corrigido — `obterCategoriaCompra(unidade, finalidade)` lê `CATEG_*_{UNIDADE}` do `.env` por filial (`omieClient.js:639`) |
| `Tag [CMODALIDADE] não faz parte de frete_incluir` | Payload de frete mandava campo inexistente | ✅ Corrigido — `frete_incluir` agora só manda `nValFrete`/`nValDesp` (`omieClient.js:746`) |
| `Tag [OBS_INTERNAS] não faz parte de observacoes` | Payload da venda mandava tag errada | ✅ Corrigido — hoje usa `observacoes: { obs_venda }` (`omieClient.js:611`) |
| `Tag [det] obrigatório` | Lista de itens da venda vazia (todos os itens caíram fora) | ✅ Estrutura `det` corrigida (`omieClient.js:602`); ver ⚠️ item 3 abaixo |
| `valor_unitario obrigatório` | Item com preço 0 (VPEL-014n) ia pro payload sem preço | ✅ Preflight agora rejeita item com preço ≤ 0 (`checkoutPreflight.js:26`) |

Outros consertos confirmados no código, dignos de crédito:
- **Idempotência** — `findOrderByIdempotencyKey` bloqueia reenvio com a mesma chave
  (`checkoutController.js:32`). Isso teria evitado as ~9 duplicatas do VPB-001 — **desde que o
  frontend mande uma `idempotencyKey` estável por carrinho** (ver ⚠️ item 4).
- **Compensação** — se a venda VP falha depois da compra criada, cancela a compra
  (documentado no CLAUDE.md, ativo desde 04/07).

---

## 3. 🟠 ALTO — Divergência silenciosa de itens entre Compra e Venda (BUG VIVO)

Ainda vivo no código atual. Nas duas montagens de itens, quando o produto **não é encontrado /
não pôde ser clonado** na filial ou na VP, o código faz `continue` e **segue o pedido sem aquele
item**, apenas logando um warning:

- Venda VP: `omieClient.js:561` → `if (!idVP) continue;`
- Compra filial: `omieClient.js:693-697` → item ignorado se `buscarIdPorCodigo` falha

Consequência: um carrinho de 6 itens pode virar **Pedido de Compra com 5 itens e Pedido de Venda
com 4 itens** — cada ponta perde itens diferentes, sem nenhum erro devolvido ao usuário. A
compra e a venda ficam **com valores e conjuntos de itens divergentes**, o que quebra a premissa
"Contas a Pagar da filial = Contas a Receber da VP" que é a razão de existir do portal.

O preflight tapou o caso de **preço zero** (rejeita o pedido inteiro), mas **não** cobre o caso
de "produto inexistente/não clonável numa das pontas" — esse continua drenando item silenciosamente.

**Recomendação:** se qualquer item for descartado na montagem, **abortar o pedido inteiro** (ou
ao menos falhar antes de criar a compra), em vez de `continue`. Um pedido parcial silencioso é
pior que um pedido que falha visivelmente.

---

## 4. 🟠 ALTO — Estoque negativo é vendável, sem nenhuma trava (BUG VIVO)

O produto **VPEL-151** ("Barreira de Proteção Infravermelha 154 Feixes") está com
`estoque_atual: -28` e `ativo: true` no catálogo. E não é teórico: **foi exatamente esse o item
do único pedido recente que deu certo** (`ESC-1774546740201`, 26/03, SP).

Nem o `checkoutPreflight` nem o `omieClient` checam saldo de estoque antes de criar o pedido — só
validam preço > 0 e quantidade > 0 (`checkoutPreflight.js:26`). Ou seja, dá para vender/comprar
item com estoque negativo à vontade. Outros produtos ativos aparecem zerados também.

**Recomendação:** decidir a política (bloquear, avisar, ou permitir backorder consciente) e
implementar a checagem no preflight usando a tabela de estoque real (`list_estoque_vp`), que está
atualizada (10/07 18h) — não o campo `estoque_atual` do catálogo, que é a fonte furada (item 6).

---

## 5. 🟡 MÉDIO — Sem teto/sanidade de quantidade

O pedido `ESC-1771957762729` tinha o item **VP-1379 com quantidade 28.300** (a R$0,235125 =
~R$6.653). Passou pela validação (que só exige quantidade > 0). Provavelmente erro de digitação /
campo de quantidade sem limite na UI. Convém um teto de sanidade e/ou confirmação para
quantidades muito altas no `validarItens`.

---

## 6. 🟡 MÉDIO — Catálogo com `estoque_atual` furado (fonte de verdade divergente)

Confirmado o bug já conhecido do CLAUDE.md: em `list_omie_produtos` o `estoque_atual` vem
**0 ou negativo** para quase tudo (herança do `ListarProdutos`). Mas existe a tabela de estoque
**correta e atualizada** exposta por `list_estoque_vp` / `list_estoque_escamax` (atualização
diária, última 10/07 18h). Ou seja, o dado bom **já existe** numa tabela; o catálogo/dashboard é
que continuam lendo o campo errado. **Recomendação:** apontar catálogo e qualquer checagem de
estoque para a tabela de estoque rateado, e parar de exibir/usar `omie_produtos.estoque_atual`.

---

## 7. 🟢 BAIXO / Observações

- **Auditoria cega no período crítico:** `get_pedido` de todos os pedidos de fev/mar retorna
  `logs_auditoria: []`. A tabela `logs_auditoria` só passou a registrar em 04/07, então **não há
  rastro** dos 26 pedidos que falharam além do próprio registro do pedido. Para trás é perda
  total; para frente está coberto.
- **Logins de sonda/teste:** houve tentativas falhas de `agente.ia@vpsistema.com` (3x),
  `teste@teste.com` (2x) e o típico erro de digitação `adm@escamax.com.brr` (4x, "r" dobrado, do
  Diego, seguido de sucesso). Nada alarmante, mas **não há sinal de rate-limit/lockout** — todas
  as tentativas foram aceitas para processamento. Vale considerar um limitador.
- **Preços = transferência 75%:** confirmado que `preco_unitario = 0,75 × preco_original` (desconto
  fixo de 25% VP→Escamax). Consistente em toda a base — não é bug, é regra de negócio; anoto só
  para quem for auditar valores.

---

## 8. Resumo priorizado (o que fazer)

| Prio | Item | Tipo | Ação |
|------|------|------|------|
| 🔴 | 16 POs órfãos em Piçarras (§1) | Resíduo financeiro | **Humano:** cancelar no Omie Piçarras; código novo não limpa |
| 🟠 | Divergência silenciosa de itens (§3) | Bug vivo (código) | Abortar pedido se algum item for descartado, em vez de `continue` |
| 🟠 | Estoque negativo vendável (§4) | Bug vivo (código) | Checar saldo real no preflight |
| 🟡 | Sem teto de quantidade (§5) | Bug vivo (código) | Teto de sanidade em `validarItens` |
| 🟡 | `estoque_atual` do catálogo furado (§6) | Dado | Usar tabela de estoque rateado como fonte |
| 🟢 | Sem rate-limit de login (§7) | Segurança | Avaliar limitador/lockout |
| ✅ | 5 erros Omie fev/mar (§2) | Já corrigido | Nenhuma — só validar em produção com 1 pedido real |

**Nota final:** os fixes de código (categoria por filial, frete, payload de venda, idempotência,
compensação, preflight) estão bons e o pedido de 26/03 provou que funcionam. Mas **nenhum pedido
novo foi feito desde então** — recomendo um pedido-piloto real por filial (principalmente SP e
Salvador, que nunca tiveram um pedido OK e dependem do `CATEG_*` no `.env`) antes de considerar o
checkout confiável em produção.
