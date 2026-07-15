# CLAUDE.md — Instruções para o Assistente IA

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

### Autenticação (reescrita em 03–04/07/2026 — NÃO é mais OTP)
- Flow: e-mail + **senha** via **Supabase Auth** (`server/services/usuariosService.js`) — sem OTP, sem backdoor `123456` (removido).
- Login só funciona para quem tem perfil **ativo** na tabela `usuarios` (Supabase), não basta ter conta no Auth.
- Acesso só para domínios `@escamax.com.br` e `@verticalparts.com.br`, liberado por **convite** (tela `/usuarios/convidar`, admin-only) — envia e-mail via Supabase Auth (SMTP Hostinger `suporte@vpsistema.com`).
- Aceite do convite/redefinição de senha: `/aceitar-convite?token_hash=...&type=...` — o token é trocado por sessão via `supabase.auth.verifyOtp()` no **JavaScript da página**, de propósito (não no link direto do e-mail), para não ser consumido por scanners de segurança corporativos (ex.: Microsoft Safe Links) que pré-visitam links antes do usuário clicar.
- **Alçadas de aprovação são nominais**, não mais por variável de ambiente: Gustavo (nível 1, até R$3.000), Michel (nível 2, até R$5.000), Diego/`adm@escamax.com.br` (nível 3, acima disso) — tudo na tabela `usuarios` (`alcada_nivel`, `is_admin`).
- Justificativa é **obrigatória para aprovar E reprovar** (antes só reprovar exigia).
- Após login → tela de seleção de filial → portal (isso não mudou).

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
- **Saldo de estoque (corrigido em 11/07/2026)**: o campo `estoque_atual` de `omie_produtos` vem furado do
  `ListarProdutos` (0/negativo pra quase tudo) e NÃO é mais usado na UI. Fonte de verdade do saldo:
  tabela `estoque_vp` (`estoque_disponivel`), populada de hora em hora pela Edge Function
  `sync-estoque-vp` (`ListarPosEstoque`). Helper no frontend: `client/src/lib/estoqueVP.js`.
  No backend, `server/services/estoqueService.js` valida saldo no preflight, no checkout e na aprovação
  final — política: **bloquear** item sem saldo (prefixos rastreados: VPEL/VPER/VPB; fora deles só warning).

### Carrinho + Checkout
- CartSidebar existente com campos: finalidade, prioridade, tipo de frete, pagamento
- Filial vem do contexto (`useAuth().filial`) — sem seletor interno no carrinho
- Endpoint: `POST /api/checkout/processar` (requer JWT)
- `checkoutController.js` → chama `omieClient.incluirRequisicaoCompra()` (filial) e `omieClient.incluirPedidoVenda()` (VP)
- `omieClient.js` → `ACQUIRE_KEYS(unidade)` lê as chaves Omie do `.env` por filial
- **Hardening (11/07/2026)**: (1) item que não pode entrar no pedido (não encontrado/não clonável/sem
  preço) **aborta o pedido inteiro** em vez de seguir sem o item — compra e venda nunca divergem do
  carrinho; (2) validação de saldo (`estoqueService.js`) no preflight/checkout/aprovação; (3) teto de
  quantidade por item (`CHECKOUT_QTD_MAX_ITEM`, default 1000); (4) rate-limit de login: 5 falhas do
  mesmo e-mail em 15 min bloqueiam por 15 min (`LOGIN_MAX_FALHAS`/`LOGIN_JANELA_MINUTOS`).
- **Gate "Atendimento a Contrato" por Categoria, não mais por tags (15/07/2026)**: o carrinho só libera
  para um contrato cujo Omie resolve a Categoria como `3.101 - Contrato de Manutenção Com Peças` ou
  `3.102 - Contrato de Manutenção Parcial Peças` — `3.103 - Sem Peças` (ou qualquer outra) bloqueia com
  "❌ Para essa modalidade de contrato não está autorizado a fazer o pedido." Substituiu a checagem antiga
  das tags `Contrato com peças`/`Contrato Parcial com Peças` no cadastro do cliente (`consultarContratoAutorizado`
  em `omieClient.js`). **O código Omie da categoria (`cCodCateg`) não é estável entre filiais** — o mesmo
  código colide com modalidades diferentes em filiais diferentes (confirmado ao vivo) — por isso a
  modalidade é resolvida pelo prefixo `3.10x` na *descrição* da categoria via `ConsultarCategoria`, não
  pelo código numérico direto. O checkout revalida o contrato no servidor antes de criar os pedidos (antes
  confiava só no `contratoRef` do frontend). Ver issue [#26](https://github.com/verticalpartsIA/011_EscamaxCompraVP/issues/26).

### Backend Omie
- `server/services/omieClient.js` — toda a lógica de chamada à Omie (VP + filiais)
- Inclui: busca de produto por código, clone de produto para filial, IPI, contas correntes
- Chaves lidas do `.env` por variável de ambiente (ver seção Credenciais abaixo)
- `omiePost()` tem retry automático quando a Omie responde "Consumo redundante detectado" — extrai o
  "aguarde N segundos" da própria mensagem de erro e tenta de novo (até 4x) antes de propagar o erro

### Persistência de pedidos (migrado em 04/07/2026 — NÃO é mais `data/orders.json`)
- `server/services/orderStore.js` agora lê/escreve na tabela `pedidos` do Supabase (schema: `id`, `criado_em`,
  `unidade`, `idempotency_key`, `versao`, `dados` jsonb). O objeto completo do pedido vive em `dados`.
- Concorrência otimista via `versao`: `updateOrder()` relê e reaplica automaticamente (até 3x) se outro
  processo gravou no meio do caminho — dois updates simultâneos no mesmo pedido não se sobrescrevem mais.
- Migração histórica em `server/migrations/002_migrar_orders_json.js` (idempotente, já rodada 1x).
- **Compensação no checkout**: se o Pedido de Venda VP falhar depois da compra já criada na filial, o sistema
  cancela a compra automaticamente (`omieClient.excluirPedidoCompra`) para não deixar contas a pagar órfãs.
  Se a própria compensação falhar, fica marcado em `pedido_compra.compensacao` para reconciliação manual.

### Logs de auditoria e indagação (04/07/2026)
- Tabela `logs_auditoria` no Supabase registra login, criação de pedido, decisão de alçada, entrega confirmada,
  convite de usuário e envio (ou falha) do aviso de WhatsApp.
- Página `/logs` (admin-only): cada log pode ter uma thread de observação (`log_observacoes`) — só quem tem
  `alcada_nivel = 3` (hoje, Diego) pode **abrir** uma indagação; depois de aberta, qualquer participante da
  conversa pode responder (réplica/tréplica), sem e-mail fixo hardcoded no código.

### Requisição de Serviços — contratação de serviço terceirizado (11/07/2026)
- Módulo nativo migrado do protótipo `admescamax/approval-hub` (Lovable) — reescrito 100% como
  código próprio (sem TypeScript/shadcn/Lovable, no padrão JS/Tailwind do resto do `client/`).
  Nenhum vestígio da Lovable neste repositório (sem `lovable-tagger`, sem comentários/config dela).
- **Propósito**: controle financeiro da matriz (VerticalParts) sobre gastos da Escamax com
  fornecedores terceirizados de serviço (não é peça VP — usa seu próprio catálogo de preços `lpu`,
  separado de `omie_produtos`). Cliente final e fornecedor terceirizado são CNPJs distintos
  (`clients`/`suppliers`, upsert por CNPJ via BrasilAPI), sem relação com o Omie.
- **Backend Express** (`server/routes/servicos.js`, `controllers/servicosController.js`,
  `services/servicosService.js` + `servicoApprovalEngine.js`) — mesmo padrão do checkout de peças:
  todas as escritas passam pelo Node com a Supabase service key (sem RLS client-side, sem sessão
  Supabase no frontend). Tabelas já existiam no mesmo projeto Supabase (`branches`, `profiles`,
  `lpu`, `solicitations`, `solicitation_items`, `solicitation_comments`, `solicitation_attachments`,
  `clients`, `suppliers`) — provisionadas antes desta branch, já com as 5 filiais e os mesmos
  usuários da tabela `usuarios`.
- **Papéis do módulo** vêm de `profiles.role` (admin/gerente_filial/diretor_comercial/financeiro) —
  é uma tabela diferente de `usuarios` (alçadas de peças), mesmo Supabase Auth por baixo.
- **Gatilho de segurança (gate do CEO)**: toda requisição, ao ser enviada (ou reenviada após ajuste
  do solicitante), entra obrigatoriamente em `aguardando_ceo` antes de seguir para diretor comercial
  e financeiro. Aprovador designado via `.env` (`SERVICOS_CEO_EMAIL`, hoje `adm@escamax.com.br` —
  Diego). Não aceita qualquer admin como substituto: é um aprovador nomeado, não um papel.
- Fluxo completo: `rascunho → aguardando_ceo → analise_diretor → aprovado_diretor →
  em_analise_financeiro → aprovado` (com `ajuste_solicitante`/`ajuste_pagamento`/`rejeitado`/
  `cancelado` como desvios). Migração `server/migrations/004_servicos_status_ceo.sql`.
- Aviso de WhatsApp por etapa (CEO/diretor/financeiro) em `whatsappNotifier.js`
  (`WHATSAPP_FONE_SERVICOS_CEO/DIRETOR/FINANCEIRO`, com fallback pros fones já usados no fluxo de peças).
- Sidebar: item **"Requisição Serviços"**; LPU (catálogo de preços) fica em admin, sub-item separado.
- **Limpeza de schema**: removidas as 9 tabelas do protótipo abandonado em inglês (`requests`,
  `request_items`, `request_comments`, `request_history`, `request_attachments`, `payment_records`,
  `approval_limits`, `audit_logs`, `lpu_services`) — nenhum código as referenciava. `clients` e
  `suppliers` foram mantidas: são usadas de verdade por `solicitations.client_id`/`supplier_id`.
- **Não testado em produção real** (sem a service key real neste ambiente de sessão) — recomendo
  um teste-piloto manual (rascunho → enviar → decisão do CEO) antes de considerar confiável.

### Backend em produção (Hostinger, cPanel/Passenger)
- Deploy do **frontend** é automático via GitHub → Hostinger (Vite build, `client/` como raiz).
- **Dois domínios, um backend só**: o domínio que o time usa de fato é `escamaxcompravp1.vpsistema.com`
  (com "1") — seu `public_html/.htaccess` tem `PassengerAppRoot` apontando pra
  `~/domains/escamaxcompravp.vpsistema.com/nodejs/` (sem "1"), que é onde o código realmente mora.
  `escamaxcompravp.vpsistema.com` sozinho não roteia `/api` (seu `.htaccess` não tem `PassengerBaseURI`) —
  testar health check ali dá 404. Teste sempre em `https://escamaxcompravp1.vpsistema.com/api/health`.
- **Deploy do backend é manual e NÃO é `git pull`** (verificado em 15/07/2026 — ver issue
  [#27](https://github.com/verticalpartsIA/011_EscamaxCompraVP/issues/27)): a pasta `nodejs/` está dentro de
  um repositório git, mas ele aponta pro repo **errado** (`vprequisicoes`, projeto sem relação) com raiz na
  **home inteira da conta de hospedagem** (`/home/u969661049`, que hospeda vários outros domínios/sites).
  Um `git pull`/`git reset` ali arrisca mexer em arquivos de outros sites. Até alguém corrigir essa
  configuração, o processo seguro é: copiar cada arquivo alterado individualmente via SFTP ou
  `curl -o <arquivo> https://raw.githubusercontent.com/verticalpartsIA/011_EscamaxCompraVP/<commit>/server/<caminho>`,
  depois `touch tmp/restart.txt`. Fazer backup dos arquivos antigos antes de sobrescrever.
- **Deploys manuais historicamente ficam incompletos** — já aconteceu de arquivos novos referenciados por um
  commit nunca chegarem a ser copiados (`server/utils/httpAgent.js` e `fetchComKeepAlive.js` da issue #25
  ficaram faltando até 15/07/2026, e derrubavam o boot do Node com `MODULE_NOT_FOUND` assim que outro arquivo
  passou a importá-los). Ao fazer deploy manual, é mais seguro comparar a lista completa de arquivos do
  backend (`git ls-tree -r --name-only <commit> -- server/`) contra o que existe de fato na pasta `nodejs/`
  antes de reiniciar, não só copiar os arquivos que mudaram no commit que motivou o deploy.
- Health check em produção é `GET /api/health` (não `/health` — o Passenger só roteia `/api/*` para o Node;
  qualquer outra coisa cai no fallback estático do SPA). Depois de reiniciar (`touch tmp/restart.txt`), o
  Passenger recarrega o processo de forma preguiçosa — a primeira requisição pode responder 503 por alguns
  segundos até o boot terminar; espere ~15s antes de considerar falha.

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

3. ~~**Estoque real**~~ — RESOLVIDO em 11/07/2026: catálogo, checkout e split multi-vendor agora usam a
   tabela `estoque_vp` (sync horária via Edge Function `sync-estoque-vp` / `ListarPosEstoque`), com
   bloqueio de venda sem saldo no backend (`estoqueService.js`) e na UI. Ver Relatorio/2026_07_11_caca_bugs_mcp.md §9.

### Prioridade Média
4. **Resend API Key** — sem ela o OTP não chega por email (funciona pelo console do servidor e pelo backdoor 123456)
   - Adicionar `RESEND_API_KEY=re_...` no `server/.env`

5. **Edge Function Supabase** — deploy de `sync-omie-produtos` para sync serverless sem depender do backend Express rodando
   - MCP Supabase autenticado mas ferramenta `deploy_edge_function` ainda retorna "no permission"
   - Alternativa: usar o Supabase Dashboard para criar a Edge Function manualmente

6. **Merge PR para main** — branch atual: `feat/reskin-verticalparts` (PR aberto, ver seção Branch atual)
6.1. **Migrar segredos do `.env` para o Cofre Central de Credenciais** — já existe o papel `svc_escamax`
   provisionado (Supabase Vault, projeto `vpsistema`, doc em `verticalpartsIA/001_vpsistema` →
   `Instruções/COFRE_CREDENCIAIS.md`), mas o backend ainda lê tudo direto de `process.env`.
6.2. **Corrigir o git da pasta `nodejs/` de produção** — hoje aponta pro repo errado (`vprequisicoes`) com
   raiz na home inteira da conta de hospedagem, tornando `git pull` inseguro ali. Ver issue
   [#27](https://github.com/verticalpartsIA/011_EscamaxCompraVP/issues/27) para diagnóstico e sugestão de correção.
6.3. **Terminar o deploy do keep-alive HTTPS (issue #25)** — `server/utils/httpAgent.js` e
   `fetchComKeepAlive.js` já foram deployados (15/07/2026, eram um blocker de boot), mas os outros ~10
   arquivos que passariam a *usar* esse agente (`orderStore.js`, `omieVPSync.js`, `estoqueService.js`,
   `comprasHistoricoSync.js`, `auditoriaService.js`, `whatsappNotifier.js`, `usuariosService.js`,
   `servicosService.js`, `routes/comprasHistorico.js`, entre outros) não tiveram o conteúdo verificado —
   podem ainda estar na versão antiga (`node-fetch` puro, sem risco, só sem o ganho de performance).

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
    authController.js           ← login e-mail+senha via Supabase Auth
    checkoutController.js       ← orquestra dual-Omie (compra + venda) + compensação
  services/
    omieClient.js               ← toda a lógica de chamada à Omie API (com retry redundante)
    omieVPSync.js                ← sync ListarProdutos → Supabase omie_produtos
    orderStore.js                ← pedidos no Supabase (tabela `pedidos`, concorrência otimista)
    usuariosService.js           ← convite, autenticação, papéis (tabela `usuarios`)
    auditoriaService.js          ← logs_auditoria + log_observacoes
    whatsappNotifier.js           ← aviso de aprovação via WhatsApp (Evolution/pv360)
  routes/
    produtosVP.js               ← POST /api/produtos-vp/sync
    checkout.js                 ← POST /api/checkout/processar
    usuarios.js                  ← convite de usuários (admin-only)
    logs.js                      ← logs de auditoria + observações (admin-only)
  migrations/
    002_migrar_orders_json.js    ← migração única orders.json → tabela pedidos (já rodada)

tools/omie-diagnostico/          ← scripts avulsos de investigação da API Omie (histórico, não é código de produção)

client/src/
  context/AuthContext.jsx       ← auth + filial selecionada
  pages/
    FilialSelectPage.jsx        ← tela de seleção de filial (pós-login)
    ProdutosVPPage.jsx          ← catálogo VP (lê Supabase)
    LoginPage.jsx               ← e-mail + senha
    AceitarConvitePage.jsx       ← criação de senha após convite/redefinição
    ConvidarUsuarioPage.jsx      ← convite de usuário (admin-only)
    LogsPage.jsx                  ← logs de auditoria + thread de observação (admin-only)
  components/
    Sidebar.jsx                 ← nav + indicador de filial ativa (Logs/Convidar só para admin)
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

Login: e-mail + senha de um usuário já convidado (ver tabela `usuarios` no Supabase). Não há mais backdoor.

---

## Branch atual

```
feat/reskin-verticalparts
```

Todas as features relevantes (reskin, aprovação por alçadas, auth por senha, aviso WhatsApp) estão nessa
branch, nunca mergeada para `main` — `main` está bem defasada em relação ao que roda em produção. PR aberto
para revisão/merge.
