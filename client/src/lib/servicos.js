// Helpers de acesso ao módulo "Requisição de Serviços" — tudo passa pelo
// backend Express (/api/servicos/*), com o mesmo JWT do restante do portal.
// Nenhuma chamada direta ao Supabase a partir do frontend neste módulo.

function authHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, { method = 'GET', body, isFormData = false } = {}) {
    const resp = await fetch(`/api/servicos${path}`, {
        method,
        headers: isFormData ? authHeaders() : { 'Content-Type': 'application/json', ...authHeaders() },
        body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Erro ${resp.status}`);
    return data;
}

export const meuPerfilServicos = () => api('/perfil');
export const listarBranchesServicos = () => api('/branches');

export const listarLpu = () => api('/lpu');
export const criarLpu = (item) => api('/lpu', { method: 'POST', body: item });
export const atualizarLpu = (id, patch) => api(`/lpu/${id}`, { method: 'PATCH', body: patch });

export const listarRequisicoes = () => api('/');
export const obterRequisicao = (id) => api(`/${id}`);
export const criarRequisicao = (dados) => api('/', { method: 'POST', body: dados });
export const atualizarRequisicao = (id, patch) => api(`/${id}`, { method: 'PATCH', body: patch });

export const adicionarItemRequisicao = (id, item) => api(`/${id}/itens`, { method: 'POST', body: item });
export const removerItemRequisicao = (id, itemId) => api(`/${id}/itens/${itemId}`, { method: 'DELETE' });

export const comentarRequisicao = (id, comment) => api(`/${id}/comentarios`, { method: 'POST', body: { comment } });

export async function enviarAnexoRequisicao(id, file) {
    const form = new FormData();
    form.append('arquivo', file);
    return api(`/${id}/anexos`, { method: 'POST', body: form, isFormData: true });
}
export const urlAnexoRequisicao = (id, attachmentId) => api(`/${id}/anexos/${attachmentId}/url`);

export const enviarRequisicao = (id) => api(`/${id}/enviar`, { method: 'POST' });
export const decidirCeo = (id, decisao, motivo) => api(`/${id}/decisao-ceo`, { method: 'POST', body: { decisao, motivo } });
export const decidirDiretor = (id, decisao, motivo) => api(`/${id}/decisao-diretor`, { method: 'POST', body: { decisao, motivo } });
export const iniciarAnaliseFinanceira = (id) => api(`/${id}/iniciar-analise-financeira`, { method: 'POST' });
export const decidirFinanceiro = (id, decisao, motivo) => api(`/${id}/decisao-financeiro`, { method: 'POST', body: { decisao, motivo } });
export const reenviarFinanceiro = (id) => api(`/${id}/reenviar-financeiro`, { method: 'POST' });
export const cancelarRequisicao = (id, motivo) => api(`/${id}/cancelar`, { method: 'POST', body: { motivo } });
