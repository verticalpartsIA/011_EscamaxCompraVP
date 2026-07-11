// Rótulos e cores do status da Requisição de Serviço — mesma paleta de
// badges usada no resto do portal (bg-x-50/text-x-700).
export const STATUS_LABELS = {
    rascunho: 'Rascunho',
    aguardando_ceo: 'Aguardando Aval do CEO',
    analise_diretor: 'Análise do Diretor Comercial',
    ajuste_solicitante: 'Ajuste Solicitado',
    aprovado_diretor: 'Aprovado pelo Diretor',
    em_analise_financeiro: 'Análise Financeira',
    ajuste_pagamento: 'Ajuste de Pagamento',
    aprovado: 'Aprovado',
    rejeitado: 'Rejeitado',
    cancelado: 'Cancelado',
};

export const STATUS_CLASSES = {
    rascunho: 'bg-neutral-100 text-neutral-600',
    aguardando_ceo: 'bg-amber-50 text-amber-700 border border-amber-200',
    analise_diretor: 'bg-blue-50 text-blue-700',
    ajuste_solicitante: 'bg-orange-50 text-orange-700',
    aprovado_diretor: 'bg-indigo-50 text-indigo-700',
    em_analise_financeiro: 'bg-purple-50 text-purple-700',
    ajuste_pagamento: 'bg-amber-50 text-amber-700',
    aprovado: 'bg-green-50 text-green-700',
    rejeitado: 'bg-red-50 text-red-700',
    cancelado: 'bg-neutral-100 text-neutral-500',
};

export const ACTION_LABELS = {
    criado: 'Criação',
    enviado: 'Enviado para o CEO',
    aprovado_ceo: 'Aprovado pelo CEO',
    ajuste_solicitado_ceo: 'CEO pediu ajuste',
    rejeitado_ceo: 'Rejeitado pelo CEO',
    aprovado_diretor: 'Aprovado pelo Diretor Comercial',
    ajuste_solicitado_diretor: 'Diretor pediu ajuste',
    rejeitado_diretor: 'Rejeitado pelo Diretor Comercial',
    analise_financeira: 'Análise financeira iniciada',
    ajuste_pagamento_solicitado: 'Financeiro pediu ajuste de pagamento',
    reenviado_financeiro: 'Reenviado ao financeiro',
    aprovado: 'Aprovação final',
    rejeitado: 'Rejeitado',
    cancelado: 'Cancelado',
    comentario: 'Comentário',
};

export function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
