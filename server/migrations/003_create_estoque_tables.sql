-- Tabelas de estoque (VP + Escamax por filial), populadas pelas Edge Functions
-- supabase/functions/sync-estoque-vp e sync-estoque-escamax (Omie ListarPosEstoque).
-- Já aplicado via Supabase Management API em 07/07/2026 — este arquivo é só documentação/histórico.

create table if not exists estoque_vp (
  codigo text primary key,
  descricao text,
  estoque_fisico numeric not null default 0,
  reservado numeric not null default 0,
  estoque_disponivel numeric not null default 0,
  estoque_minimo numeric not null default 0,
  atualizado_em timestamptz not null default now()
);

create table if not exists estoque_escamax (
  codigo text not null,
  unidade text not null,
  descricao text,
  estoque_fisico numeric not null default 0,
  reservado numeric not null default 0,
  estoque_disponivel numeric not null default 0,
  estoque_minimo numeric not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (codigo, unidade)
);

create index if not exists idx_estoque_escamax_unidade on estoque_escamax (unidade);

alter table estoque_vp enable row level security;
alter table estoque_escamax enable row level security;

drop policy if exists leitura_publica on estoque_vp;
create policy leitura_publica on estoque_vp for select using (true);

drop policy if exists leitura_publica on estoque_escamax;
create policy leitura_publica on estoque_escamax for select using (true);

-- Agendamento (pg_cron + pg_net) — dispara as Edge Functions de hora em hora,
-- 08h-18h, seg-sex (horário comercial), pra não incomodar a Omie fora desse período.
-- create extension if not exists pg_cron with schema extensions;
-- create extension if not exists pg_net with schema extensions;
--
-- select cron.schedule('sync-estoque-vp-horario', '0 8-18 * * 1-5', $$
--   select net.http_post(
--     url := 'https://hhgvlcskxopryqvhofsg.supabase.co/functions/v1/sync-estoque-vp',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
--
-- select cron.schedule('sync-estoque-escamax-horario', '5 8-18 * * 1-5', $$
--   select net.http_post(
--     url := 'https://hhgvlcskxopryqvhofsg.supabase.co/functions/v1/sync-estoque-escamax',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
