const logger = require('../utils/logger');
const svc = require('../services/servicosService');
const engine = require('../services/servicoApprovalEngine');
const { registrarLog } = require('../services/auditoriaService');
const {
    avisarServicoAguardandoCeo,
    avisarServicoAnaliseDiretor,
    avisarServicoAnaliseFinanceira,
} = require('../services/whatsappNotifier');

function idAuditoria(solicitationId) {
    return `SRV-${solicitationId}`;
}

async function perfilAtual(req) {
    const { profile } = await engine.papelDoUsuario(req.user?.email);
    if (!profile) throw Object.assign(new Error('Seu usuário ainda não tem perfil no módulo de Requisição de Serviços. Peça para um admin cadastrar em profiles.'), { status: 403 });
    return profile;
}

// Visibilidade por papel — replica em código a mesma regra que estava em RLS,
// já que o backend acessa o Supabase com a service key (bypassa RLS).
function escopoVisibilidade(profile) {
    if (profile.role === 'admin' || profile.role === 'diretor_comercial') {
        return {};
    }
    if (profile.role === 'financeiro') {
        return { filtroStatusIn: ['aprovado_diretor', 'em_analise_financeiro', 'ajuste_pagamento', 'aprovado', 'rejeitado', 'cancelado'] };
    }
    // gerente_filial (ou papel desconhecido): as próprias requisições OU
    // qualquer requisição da própria filial (5 filiais Escamax) — cada
    // filial precisa ver as requisições da filial, não só as que ela mesma
    // abriu (bug corrigido em 11/07/2026, faltava o "OR branch_id" da RLS
    // original).
    return { filtroOrRequesterBranch: { requesterId: profile.id, branchId: profile.branch_id || null } };
}

exports.listar = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitations = await svc.listarSolicitations(escopoVisibilidade(profile));
        res.json(solicitations);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

exports.obter = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });

        const podeVer = profile.role === 'admin'
            || profile.role === 'diretor_comercial'
            || solicitation.requester_id === profile.id
            || (profile.role === 'gerente_filial' && profile.branch_id && solicitation.branch_id === profile.branch_id)
            || (profile.role === 'financeiro' && ['aprovado_diretor', 'em_analise_financeiro', 'ajuste_pagamento', 'aprovado', 'rejeitado', 'cancelado'].includes(solicitation.status));
        if (!podeVer) return res.status(403).json({ error: 'Sem permissão para ver esta requisição.' });

        const [itens, comentarios, anexos, cliente, fornecedor] = await Promise.all([
            svc.listarItens(solicitation.id),
            svc.listarComentarios(solicitation.id),
            svc.listarAnexos(solicitation.id),
            svc.buscarCliente(solicitation.client_id),
            svc.buscarFornecedor(solicitation.supplier_id),
        ]);
        res.json({ ...solicitation, itens, comentarios, anexos, cliente, fornecedor, meuPapel: profile.role, souSolicitante: solicitation.requester_id === profile.id });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

exports.criar = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        if (profile.role !== 'gerente_filial' && profile.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas gerente de filial (ou admin) pode abrir uma Requisição de Serviço.' });
        }

        const {
            title, description, branch_id, justification, is_urgent,
            clientCnpj, clientName, supplierCnpj, supplierName,
            entry_percent, balance_term, service_start_date, itens,
        } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Informe o título da requisição.' });
        }

        const [clientId, supplierId] = await Promise.all([
            svc.buscarOuCriarCliente({ cnpj: clientCnpj, name: clientName }),
            svc.buscarOuCriarFornecedor({ cnpj: supplierCnpj, name: supplierName }),
        ]);

        const solicitation = await svc.criarSolicitation({
            title,
            description: description || null,
            branch_id: branch_id || profile.branch_id || null,
            requester_id: profile.id,
            status: engine.STATUS.RASCUNHO,
            justification: justification || null,
            is_urgent: Boolean(is_urgent),
            client_id: clientId,
            supplier_id: supplierId,
            entry_percent: Number(entry_percent || 0),
            balance_term: balance_term || null,
            service_start_date: service_start_date || null,
        });

        for (const item of (Array.isArray(itens) ? itens : [])) {
            await svc.adicionarItem(solicitation.id, {
                lpu_id: item.lpu_id || null,
                description: item.description,
                quantity: Number(item.quantity || 1),
                unit_price: Number(item.unit_price || 0),
                is_manual: Boolean(item.is_manual),
            });
        }

        await svc.adicionarComentario({ solicitationId: solicitation.id, userId: profile.id, comment: 'Requisição criada.', action: 'criado' });
        await registrarLog({ usuarioEmail: req.user?.email, acao: 'servico.criado', detalhes: { titulo: title }, pedidoId: idAuditoria(solicitation.id) });

        res.status(201).json(solicitation);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

exports.atualizar = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });
        if (!engine.podeEditar(solicitation, profile)) {
            return res.status(403).json({ error: 'Esta requisição não pode ser editada no estado atual (ou por este usuário).' });
        }

        const campos = ['title', 'description', 'branch_id', 'justification', 'is_urgent', 'entry_percent', 'balance_term', 'service_start_date'];
        const patch = {};
        for (const campo of campos) {
            if (req.body[campo] !== undefined) patch[campo] = req.body[campo];
        }
        if (req.body.clientCnpj !== undefined) {
            patch.client_id = await svc.buscarOuCriarCliente({ cnpj: req.body.clientCnpj, name: req.body.clientName });
        }
        if (req.body.supplierCnpj !== undefined) {
            patch.supplier_id = await svc.buscarOuCriarFornecedor({ cnpj: req.body.supplierCnpj, name: req.body.supplierName });
        }

        const atualizado = await svc.atualizarSolicitation(solicitation.id, patch);
        res.json(atualizado);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

exports.adicionarItem = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });
        if (!engine.podeEditar(solicitation, profile)) {
            return res.status(403).json({ error: 'Não é possível adicionar itens nesta requisição.' });
        }
        const { lpu_id, description, quantity, unit_price, is_manual } = req.body;
        if (!description || Number(quantity || 0) <= 0) {
            return res.status(400).json({ error: 'Informe descrição e quantidade positiva.' });
        }
        const item = await svc.adicionarItem(solicitation.id, {
            lpu_id: lpu_id || null,
            description,
            quantity: Number(quantity),
            unit_price: Number(unit_price || 0),
            is_manual: Boolean(is_manual),
        });
        res.status(201).json(item);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

exports.removerItem = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });
        if (!engine.podeEditar(solicitation, profile)) {
            return res.status(403).json({ error: 'Não é possível remover itens desta requisição.' });
        }
        await svc.removerItem(solicitation.id, req.params.itemId);
        res.status(204).end();
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

// Transição genérica: aplica a validação da engine, grava o novo status,
// registra comentário/histórico + log de auditoria, e dispara o aviso de
// WhatsApp adequado ao novo estado.
async function transicionar(req, res, validar, montarNotificacao) {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });

        const { motivo } = req.body;
        const { novoStatus, acao } = validar({ solicitation, profile, email: req.user?.email, decisao: req.body.decisao });

        const atualizado = await svc.atualizarSolicitation(solicitation.id, { status: novoStatus });
        await svc.adicionarComentario({
            solicitationId: solicitation.id,
            userId: profile.id,
            comment: motivo && String(motivo).trim() ? motivo : `Status alterado para ${novoStatus}.`,
            action: acao,
        });
        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: `servico.${acao}`,
            detalhes: { statusAnterior: solicitation.status, novoStatus },
            pedidoId: idAuditoria(solicitation.id),
        });

        if (montarNotificacao) {
            const notif = montarNotificacao(atualizado);
            if (notif) {
                notif.fn(notif.payload).catch(e => logger.warn(`[servicos] aviso WhatsApp falhou (${solicitation.id}): ${e.message}`));
            }
        }

        res.json(atualizado);
    } catch (err) {
        const status = err.status || (/permiss[ãa]o|restrita/i.test(err.message) ? 403 : 400);
        res.status(status).json({ error: err.message });
    }
}

exports.enviar = (req, res) => transicionar(req, res, engine.validarEnviar, (atualizado) => ({
    fn: avisarServicoAguardandoCeo,
    payload: { id: atualizado.id, titulo: atualizado.title, filial: atualizado.branch_id, valorTotal: atualizado.total_value },
}));

exports.decidirCeo = (req, res) => transicionar(req, res, engine.validarDecisaoCeo, (atualizado) => {
    if (atualizado.status !== engine.STATUS.ANALISE_DIRETOR) return null;
    return {
        fn: avisarServicoAnaliseDiretor,
        payload: { id: atualizado.id, titulo: atualizado.title, filial: atualizado.branch_id, valorTotal: atualizado.total_value },
    };
});

exports.decidirDiretor = (req, res) => transicionar(req, res, engine.validarDecisaoDiretor);

exports.iniciarAnaliseFinanceira = (req, res) => transicionar(req, res, engine.validarIniciarAnaliseFinanceira, (atualizado) => ({
    fn: avisarServicoAnaliseFinanceira,
    payload: { id: atualizado.id, titulo: atualizado.title, filial: atualizado.branch_id, valorTotal: atualizado.total_value },
}));

exports.decidirFinanceiro = (req, res) => transicionar(req, res, engine.validarDecisaoFinanceiro);
exports.reenviarFinanceiro = (req, res) => transicionar(req, res, engine.validarReenviarFinanceiro);
exports.cancelar = (req, res) => transicionar(req, res, engine.validarCancelar);

exports.comentar = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });
        const { comment } = req.body;
        if (!comment || !String(comment).trim()) return res.status(400).json({ error: 'Informe o texto do comentário.' });
        const registro = await svc.adicionarComentario({ solicitationId: solicitation.id, userId: profile.id, comment, action: 'comentario' });
        res.status(201).json(registro);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

// ── Anexos (proposta comercial do fornecedor terceirizado etc.) ──
exports.uploadAnexo = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        const solicitation = await svc.buscarSolicitation(req.params.id);
        if (!solicitation) return res.status(404).json({ error: 'Requisição não encontrada.' });
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

        const caminho = `${solicitation.id}/${Date.now()}-${req.file.originalname}`;
        await svc.uploadAnexoStorage(caminho, req.file.buffer, req.file.mimetype);
        const anexo = await svc.registrarAnexo({
            solicitationId: solicitation.id,
            userId: profile.id,
            fileName: req.file.originalname,
            filePath: caminho,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
        });
        res.status(201).json(anexo);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

exports.baixarAnexo = async (req, res) => {
    try {
        await perfilAtual(req);
        const anexos = await svc.listarAnexos(req.params.id);
        const anexo = anexos.find(a => a.id === req.params.attachmentId);
        if (!anexo) return res.status(404).json({ error: 'Anexo não encontrado.' });
        const url = await svc.urlAssinadaAnexo(anexo.file_path);
        res.json({ url });
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

// ── LPU (catálogo de preços de serviço, admin-only via middleware da rota) ──
exports.listarLpu = async (req, res) => {
    try {
        res.json(await svc.listarLpu());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.criarLpu = async (req, res) => {
    try {
        const { code, description, unit, unit_price } = req.body;
        if (!code || !description) return res.status(400).json({ error: 'Informe código e descrição.' });
        const item = await svc.criarLpu({ code, description, unit: unit || 'un', unit_price: Number(unit_price || 0), active: true });
        await registrarLog({ usuarioEmail: req.user?.email, acao: 'servico.lpu_criado', detalhes: { code, description } });
        res.status(201).json(item);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.atualizarLpu = async (req, res) => {
    try {
        const campos = ['description', 'unit', 'unit_price', 'active'];
        const patch = {};
        for (const campo of campos) if (req.body[campo] !== undefined) patch[campo] = req.body[campo];
        const item = await svc.atualizarLpu(req.params.id, patch);
        res.json(item);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ── Filiais (para o formulário de nova requisição) ──
exports.listarBranches = async (req, res) => {
    try {
        res.json(await svc.listarBranches());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.meuPerfil = async (req, res) => {
    try {
        const profile = await perfilAtual(req);
        res.json(profile);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};
