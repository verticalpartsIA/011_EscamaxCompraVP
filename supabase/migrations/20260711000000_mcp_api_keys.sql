-- Chaves de acesso para o servidor MCP remoto (conector do Claude).
-- Armazena apenas o hash SHA-256 do token; o valor em texto puro nunca é persistido.
create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text not null unique,
  created_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone,
  active boolean not null default true
);

alter table public.mcp_api_keys enable row level security;
-- Sem policies: acesso somente via service_role (usado pela Edge Function), que ignora RLS.

-- Explícito de propósito: neste projeto, tabelas novas não recebem GRANT
-- automático para service_role via default privileges (bug já visto no
-- projeto pv360, onde a ausência deste GRANT causava 500 em toda
-- requisição porque o PostgREST recusava a query de autenticação).
grant select, insert, update, delete on public.mcp_api_keys to service_role;
