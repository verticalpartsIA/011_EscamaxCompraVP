-- Módulo "Requisição de Serviços" (contratação de serviço terceirizado).
-- As tabelas em si (branches, profiles, lpu, solicitations, solicitation_items,
-- solicitation_comments, solicitation_attachments, clients, suppliers) já
-- existiam no Supabase antes desta branch (aplicadas manualmente contra o
-- mesmo projeto hhgvlcskxopryqvhofsg). Este arquivo documenta apenas o que
-- foi aplicado nesta branch:
--
-- 1) Novo status "aguardando_ceo": gatilho de segurança obrigatório — toda
--    requisição, ao ser enviada (ou reenviada após ajuste do solicitante),
--    entra em aguardando_ceo antes de seguir para análise comercial/financeira.
ALTER TABLE public.solicitations DROP CONSTRAINT IF EXISTS solicitations_status_check;
ALTER TABLE public.solicitations ADD CONSTRAINT solicitations_status_check CHECK (status IN (
  'rascunho','aguardando_ceo','analise_diretor','ajuste_solicitante',
  'aprovado_diretor','em_analise_financeiro','ajuste_pagamento',
  'aprovado','rejeitado','cancelado'
));

-- 2) Limpeza: remove o schema abandonado da primeira tentativa deste módulo
--    (tabelas em inglês requests/request_items/request_comments/request_history/
--    request_attachments/payment_records/approval_limits/audit_logs/lpu_services).
--    Nenhum código atual referencia essas tabelas — o schema vivo é o em
--    português (solicitations/solicitation_items/...). clients e suppliers
--    NÃO foram removidas: são usadas de fato por solicitations.client_id/
--    supplier_id (FKs solicitations_client_id_fkey / solicitations_supplier_id_fkey).
DROP TABLE IF EXISTS public.payment_records CASCADE;
DROP TABLE IF EXISTS public.request_attachments CASCADE;
DROP TABLE IF EXISTS public.request_history CASCADE;
DROP TABLE IF EXISTS public.request_comments CASCADE;
DROP TABLE IF EXISTS public.request_items CASCADE;
DROP TABLE IF EXISTS public.requests CASCADE;
DROP TABLE IF EXISTS public.approval_limits CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.lpu_services CASCADE;

-- Nota: o bucket de Storage "request-attachments" (ligado à tabela antiga
-- request_attachments) ficou órfão após esta limpeza. Não foi removido aqui
-- (Storage é uma operação separada, potencialmente com arquivos reais) —
-- avaliar manualmente antes de excluir.
