# AGENTS.md — Instruções para o Assistente IA

> Leia este arquivo inteiro antes de qualquer ação. Ele descreve o projeto, o que já foi feito, o que falta e onde estão as credenciais.

---

## O que é este projeto

**Portal B2B Escamax** — portal interno de compras onde as filiais da Escamax consultam o catálogo da VerticalParts e fazem pedidos. Ao finalizar um pedido, o sistema dispara automaticamente:

1. **Pedido de Venda** no Omie da VerticalParts (gera Contas a Receber na VP)
2. **Pedido de Compra** no Omie da filial Escamax que fez o pedido (gera Contas a Pagar na filial)

### Relação entre as empresas
- **VerticalParts** = empresa mãe, vende peças/equipamentos de transporte vertical
- **Escamax** = subsidiária/cliente da VP, empresa de mão de obra, compra peças da VP
- **Filiais Escamax**: Brasília (DF), Florianópolis (SC), Piçarras (SC), Salvador (BA), São Paulo (SP)

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite 5 + Tailwind CSS + React Router DOM |
| Backend | Express.js + JWT + node-cron |
| Banco | Supabase (PostgreSQL) — projeto `hhgvlcskxopryqvhofsg` |
| Catálogo | Omie API (VerticalParts) → sync para tabela `omie_produtos` no Supabase |
| Checkout | Omie API (VP + filial escolhida) — chamadas paralelas |

---

## O que já está implementado ✅

### Autenticação
- Flow: email → código OTP (enviado via Resend, mas sem chave configurada ainda)
- Backdoor: código `123456` sempre funciona em dev
- Emails autorizados: `adm@escamax.com.br`, `tiverticalparts@gmail.com`, `gelson.simoes@verticalparts.com.br`
- Após login → tela de seleção de filial → portal

### Seleção de Filial
- Página `/selecionar-filial` com 5 cards (uma por filial Escamax)
- Filial salva no `localStorage` como `escamax_filial`
- Mostrada na sidebar com botão "Trocar"
- ProtectedRoute redireciona para esta tela se filial não estiver selecionada

### Catálogo de Produtos VerticalParts
- Página `/produtos-vp` lê da tabela Supabase `omie_produtos`
- Tabela populada via sync com a API Omie VP (`ListarProdutos`)
- Sync automático 4x/dia via `node-cron` (06h, 12h, 18h, 23h)
- Botão "Sincronizar Agora" chama `POST /api/produtos-vp/sync` (requer JWT)
- **BUG PENDENTE**: campo `quantidade_estoque` (Omie) está sendo lido mas todos os produtos aparecem com estoque 0 — a Omie pode não usar este módulo de estoque

### Carrinho + Checkout
- CartSidebar existente com campos: finalidade, prioridade, tipo de frete, pagamento
- Filial vem do contexto (`useAuth().filial`) — sem seletor interno no carrinho
- Endpoint: `POST /api/checkout/processar` (requer JWT)
- `checkoutController.js` → chama `omieClient.incluirRequisicaoCompra()` (filial) e `omieClient.incluirPedidoVenda()` (VP)
- `omieClient.js` → `ACQUIRE_KEYS(unidade)` lê as chaves Omie do `.env` por filial

### Backend Omie
- `server/services/omieClient.js` — toda a lógica de chamada à Omie (VP + filiais)
- Inclui: busca de produto por código, clone de produto para filial, IPI, contas correntes
- Chaves lidas do `.env` por variável de ambiente (ver seção Credenciais abaixo)

### Avisos WhatsApp de aprovação (04/07/2026)
- `server/services/whatsappNotifier.js` — aviso UNIDIRECIONAL (site → WhatsApp), sem interação/resposta.
- Reaproveita a mesma instância Evolution já pareada do VP Pós-Venda 360 (`pv360`, mesmo VPS) só como canal de saída.
- Gatilhos: (1) pedido novo entra em aprovação → avisa a 1ª alçada (Gustavo); (2) alçada aprova e o fluxo
  avança para o próximo nível → avisa o próximo aprovador (Michel/Diego). Chamado em `checkoutController.js`
  (após `saveOrder`) e em `routes/orders.js` (`POST /:id/aprovacao/decisao`). Nunca bloqueia a resposta —
  chamada fire-and-forget com `.catch()`, erro só vira log de warning.
- Telefones fixos por nível em `.env` (`WHATSAPP_FONE_GUSTAVO/MICHEL/DIEGO`) — não vêm da tabela `usuarios`
  (ela não tem coluna telefone; os papéis por nível já são fixos e hardcoded em `ALCADAS_PRODUTOS`).

---

## O que FALTA fazer ⚠️

### Prioridade Alta
1. **CNPJs das filiais Escamax** — necessários para o checkout criar o Pedido de Compra corretamente
   - Preencher no `server/.env`: `CNPJ_BRASILIA`, `CNPJ_SAOPAULO`, `CNPJ_FLORIANOPOLIS`, `CNPJ_PICARRAS`, `CNPJ_SALVADOR`
   - Também verificar se `CNPJ_VP=15.822.325/0001-27` está correto

2. **Testar checkout end-to-end** — com filial real selecionada, adicionar produto ao carrinho e finalizar
   - Verificar logs do backend para erros de Omie
   - Endpoint de diagnóstico: `GET /api/checkout/diag?unidade=BRASILIA`

3. **Estoque real** — o campo `quantidade_estoque` da `ListarProdutos` está zerado para todos os produtos VP
   - Tentamos `PosicaoEstoque` mas é por produto individual (sem bulk)
   - Tentamos `ListarPosEstoque` com parâmetros `nPagina/nRegPorPagina/dDataPosicao` — pode funcionar mas fomos rate-limitados
   - Endpoint correto para estoque bulk: `estoque/consulta/` call `ListarPosEstoque` (verificar nome exato do call)

### Prioridade Média
4. **Resend API Key** — sem ela o OTP não chega por email (funciona pelo console do servidor e pelo backdoor 123456)
   - Adicionar `RESEND_API_KEY=re_...` no `server/.env`

5. **Edge Function Supabase** — deploy de `sync-omie-produtos` para sync serverless sem depender do backend Express rodando
   - MCP Supabase autenticado mas ferramenta `deploy_edge_function` ainda retorna "no permission"
   - Alternativa: usar o Supabase Dashboard para criar a Edge Function manualmente

6. **Merge PR para main** — branch atual: `feat/reskin-verticalparts`

### Prioridade Baixa
7. **Rotacionar GitHub token** — token antigo foi exposto em conversa de chat e revogado; novo token salvo em `credenciais.md`

---

## Credenciais

> As credenciais reais estão em `credenciais.md` (git-ignored, na raiz do projeto).
> NUNCA commitar esse arquivo. NUNCA expor chaves no frontend.

### Onde cada chave é usada

| Variável no `.env` | Serviço | Para quê |
|-------------------|---------|----------|
| `OMIE_APP_KEY` / `OMIE_APP_SECRET` | Omie VP | Checkout — Pedido de Venda |
| `OMIE_VP_APP_KEY` / `OMIE_VP_APP_SECRET` | Omie VP | Sync catálogo `omie_produtos` |
| `OMIE_BRASILIA_KEY` / `OMIE_BRASILIA_SECRET` | Omie Escamax Brasília | Checkout — Pedido de Compra |
| `OMIE_SAOPAULO_KEY` / ... | Omie Escamax SP | Checkout |
| `OMIE_FLORIANOPOLIS_KEY` / ... | Omie Escamax Floripa | Checkout |
| `OMIE_PICARRAS_KEY` / ... | Omie Escamax Piçarras | Checkout |
| `OMIE_SALVADOR_KEY` / ... | Omie Escamax Salvador | Checkout |
| `SUPABASE_URL` | Supabase | Leitura do catálogo (frontend + backend) |
| `SUPABASE_SERVICE_KEY` | Supabase | Write (sync) |
| `CNPJ_VP` | — | Localizar VP como fornecedor nas filiais |
| `CNPJ_BRASILIA` etc. | — | Localizar filial como cliente na VP |
| `EVOLUTION_URL` / `EVOLUTION_APIKEY` / `EVOLUTION_INSTANCE` | Evolution API (instância `pv360`) | Envio de aviso WhatsApp de aprovação |
| `WHATSAPP_FONE_GUSTAVO` / `_MICHEL` / `_DIEGO` | — | Telefone (DDI+DDD+número, só dígitos) de cada alçada |

### Supabase
- Projeto: `hhgvlcskxopryqvhofsg`
- Tabela criada: `omie_produtos` (RLS ativa, policy `leitura_publica` para SELECT)
- PAT MASTER e demais chaves: ver `credenciais.md` seção 3

---

## Arquivos-chave

```
server/
  .env                          ← credenciais (git-ignored)
  server.js                     ← entry point, rotas, cron
  controllers/
    authController.js           ← OTP, backdoor 123456, emails autorizados
    checkoutController.js       ← orquestra dual-Omie (compra + venda)
  services/
    omieClient.js               ← toda a lógica de chamada à Omie API
    omieVPSync.js               ← sync ListarProdutos → Supabase omie_produtos
  routes/
    produtosVP.js               ← POST /api/produtos-vp/sync
    checkout.js                 ← POST /api/checkout/processar

client/src/
  context/AuthContext.jsx       ← auth + filial selecionada
  pages/
    FilialSelectPage.jsx        ← tela de seleção de filial (pós-login)
    ProdutosVPPage.jsx          ← catálogo VP (lê Supabase)
    LoginPage.jsx               ← email + OTP
  components/
    Sidebar.jsx                 ← nav + indicador de filial ativa
    CartSidebar.jsx             ← carrinho + checkout (filial do contexto)

credenciais.md                  ← SEGREDO — git-ignored
server/migrations/
  001_create_omie_produtos.sql  ← SQL da tabela omie_produtos (já aplicado)
```

---

## Como rodar localmente

```bash
# Backend
cd server && node server.js        # porta 3000

# Frontend
cd client && npm run dev           # porta 5173
```

Login: `gelson.simoes@verticalparts.com.br` + código `123456`

---

## Branch atual

```
feat/reskin-verticalparts
```

PR pendente de merge para `main`.
