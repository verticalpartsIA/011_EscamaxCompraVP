# Conector MCP para o Claude

O Portal Escamax (AprovacaoCompra) expõe um servidor MCP remoto (Streamable
HTTP) via Supabase Edge Function, permitindo que o Claude (claude.ai, Claude
Desktop ou Claude Code) consulte pedidos, estoque, catálogo Omie e auditoria
diretamente em conversa.

## Endpoint

```
https://hhgvlcskxopryqvhofsg.supabase.co/functions/v1/mcp-server
```

Código-fonte: `supabase/functions/mcp-server/index.ts`.

## Autenticação: chave na URL (sem OAuth)

O domínio compartilhado `*.supabase.co` aplica CSP sandbox em HTML servido
por Edge Functions, o que impede qualquer tela de login OAuth de renderizar
ou submeter formulário (mesmo problema encontrado nos outros conectores MCP
da VerticalParts). Por isso este servidor não implementa OAuth: a
autenticação é só uma chave compartilhada, aceita via query string `?key=`
(ou header `Authorization: Bearer`, para outros clientes MCP).

O token não é uma variável de ambiente Deno — ele é validado contra o hash
(SHA-256) guardado na tabela `public.mcp_api_keys`
(migration `supabase/migrations/20260711000000_mcp_api_keys.sql`), com RLS
habilitado sem policies (só o `service_role` consegue ler). O valor em texto
puro nunca é persistido em lugar nenhum — inclusive este arquivo não o
contém; foi comunicado apenas diretamente para quem configurou o conector.

Para gerar um novo token e revogar o antigo:

```sql
update public.mcp_api_keys set active = false where label = 'claude-web-connector';
insert into public.mcp_api_keys (label, token_hash) values ('novo-label', '<sha256-hex-do-novo-token>');
```

## Como conectar no claude.ai

1. Configurações → Conectores → Adicionar conector → Adicionar conector personalizado.
2. **Nome:** `Portal Escamax`
3. **URL do servidor MCP remoto** (a URL inteira, incluindo `?key=`):
   ```
   https://hhgvlcskxopryqvhofsg.supabase.co/functions/v1/mcp-server?key=<token-de-acesso>
   ```
4. Deixe os campos de OAuth Client ID/Secret em branco e clique em Adicionar.

## Ferramentas disponíveis

**Leitura:** `list_pedidos`, `get_pedido`, `pedidos_stats`, `list_usuarios`,
`list_logs_auditoria`, `list_log_observacoes`, `list_estoque_vp`,
`list_estoque_escamax`, `list_omie_produtos`, `list_compras_historico`.

**Escrita (limitada, ver abaixo):** `add_log_observacao`,
`registrar_log_auditoria`.

## Escopo deliberadamente restrito a leitura

Este portal cria **pedidos reais** em duas contas Omie diferentes: uma
Requisição/Pedido de Compra na filial Escamax e um Pedido de Venda na
VerticalParts. Essa criação não acontece no checkout — ela é disparada
automaticamente quando um pedido passa pelas 3 alçadas de aprovação
(`approvalEngine.js` / rota `POST /:id/aprovacao/decisao`), e a confirmação
de entrega física move o pedido de venda para a etapa "Faturar" no Omie
(`confirmarEntregaPedido` / webhook do SAC Pós-Venda 360).

Por isso, nenhuma ferramenta MCP aqui:
- decide uma alçada de aprovação (o que poderia disparar a criação real dos
  pedidos no Omie);
- confirma entrega/faturamento;
- convida ou edita usuário (`convidarUsuario` dispara e-mail real via
  Supabase Auth e cria conta em `usuarios`).

As duas ferramentas de escrita expostas (`add_log_observacao`,
`registrar_log_auditoria`) só adicionam anotações ao log de auditoria — não
alteram `pedidos`, não tocam Omie e não têm efeito além de registro
informativo. Se no futuro for necessário expor ferramentas que criem pedidos
ou decidam aprovações, isso deve ser uma decisão explícita e separada, dado
o impacto financeiro em duas empresas.

Todas as ações de escrita usam o `service_role` do Supabase. Não há
diferenciação de papel por usuário — qualquer portador do token pode
executar qualquer ferramenta disponível (mesmo estando restritas a
leitura/anotação). Trate o token com o mesmo cuidado que uma credencial de
administrador do sistema.

## Notas sobre o schema

O projeto Supabase `hhgvlcskxopryqvhofsg` contém, além das tabelas usadas
pelo Portal Escamax (`pedidos`, `estoque_vp`, `estoque_escamax`,
`omie_produtos`, `compras_historico_vp`, `usuarios`, `logs_auditoria`,
`log_observacoes`), um outro conjunto de tabelas não relacionado
(`branches`, `profiles`, `requests`, `solicitations`, `approval_limits`,
`lpu`, `suppliers`, `clients`, etc.) que não é referenciado em nenhum lugar
do código deste repositório — parece ser de um outro sistema que
compartilha o mesmo projeto Supabase. As ferramentas MCP deste conector não
tocam nessas tabelas.
