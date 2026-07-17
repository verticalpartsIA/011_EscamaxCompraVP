const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const omieClient = require('../services/omieClient');
const { readOrders, findOrder, updateOrder, appendOrder } = require('../services/orderStore');
const { validarPlanoPagamentoSalvo } = require('../services/paymentPlan');
const { etapaVendaProdutoVP, registrarSincronizacaoEtapa, registrarErroSincronizacaoEtapa } = require('../services/omieStages');
const { montarAuditoriaOmie, montarAuditoriaErro } = require('../services/omieAudit');
const { confirmarEntregaPedido } = require('../services/deliveryConfirmation');
const { registrarLog } = require('../services/auditoriaService');
const { avisarNovaAprovacao, avisarAprovacaoParaDiego } = require('../services/whatsappNotifier');
const { criarPedidosOmie } = require('../services/pedidoOmieService');
const logger = require('../utils/logger');
const {
    criarFluxoAprovacaoProdutos,
    registrarDecisao,
    obterPermissoesAprovacao,
    validarAprovador,
    validarFaturamento,
} = require('../services/approvalEngine');

function calcularValorPedido(order) {
    return (order.itens || []).reduce((acc, item) => {
        return acc + (Number(item.quantidade || 0) * Number(item.preco_unitario || item.preco || 0));
    }, 0);
}

function ensureAprovacao(order) {
    if (order.aprovacao) return order.aprovacao;
    return criarFluxoAprovacaoProdutos({
        valorTotal: calcularValorPedido(order),
        origem: 'historico',
    });
}

function withAprovacao(order) {
    return {
        ...order,
        aprovacao: ensureAprovacao(order),
    };
}

// GET /api/orders/stats — agregação por mês (sem filtro de data)
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const orders = await readOrders();

        const byMonth = {};
        let totalGeral = 0;
        let totalPedidos = 0;

        for (const order of orders) {
            const mes = order.criadoEm?.slice(0, 7) || 'desconhecido'; // YYYY-MM
            if (!byMonth[mes]) {
                byMonth[mes] = { mes, pedidos: 0, valor: 0, ok: 0, erro: 0 };
            }

            const valorPedido = (order.itens || []).reduce((acc, item) => {
                return acc + (Number(item.quantidade || 0) * Number(item.preco_unitario || 0));
            }, 0);

            const compraOk = order.pedido_compra?.status === 'ok';
            const vendaOk = order.pedido_venda?.status === 'ok';

            byMonth[mes].pedidos += 1;
            byMonth[mes].valor += valorPedido;
            byMonth[mes].ok += (compraOk && vendaOk) ? 1 : 0;
            byMonth[mes].erro += (!compraOk || !vendaOk) ? 1 : 0;

            totalGeral += valorPedido;
            totalPedidos += 1;
        }

        // Ordena por mês crescente
        const meses = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));

        res.json({ meses, totalGeral, totalPedidos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/orders?de=YYYY-MM-DD&ate=YYYY-MM-DD
router.get('/', authMiddleware, async (req, res) => {
    try {
        let orders = await readOrders();

        // Filtro opcional por filial — usado pela tela de Aprovações, que deve mostrar
        // só a fila da filial ativa (issue #29). Sem o parâmetro, comportamento não muda
        // (Histórico de Pedidos busca tudo e filtra no client para permitir navegar entre
        // filiais sem trocar a filial ativa da sessão).
        const { de, ate, unidade } = req.query;
        if (unidade) {
            const unidadeUp = String(unidade).toUpperCase();
            orders = orders.filter(o => String(o.unidade || '').toUpperCase() === unidadeUp);
        }
        if (de) {
            const [y, m, d] = de.split('-').map(Number);
            const from = new Date(y, m - 1, d, 0, 0, 0, 0);
            orders = orders.filter(o => new Date(o.criadoEm) >= from);
        }
        if (ate) {
            const [y, m, d] = ate.split('-').map(Number);
            const to = new Date(y, m - 1, d, 23, 59, 59, 999);
            orders = orders.filter(o => new Date(o.criadoEm) <= to);
        }

        // Mais recentes primeiro
        orders.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

        res.json(orders.map(withAprovacao));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const UNIDADES_VALIDAS = ['BRASILIA', 'FLORIANOPOLIS', 'PICARRAS', 'SALVADOR', 'SAOPAULO'];

// POST /api/orders/externo — finaliza o carrinho de fornecedor externo (Outros
// Fornecedores) como um pedido rastreável, seguindo o MESMO fluxo de aprovação
// por alçadas dos pedidos VerticalParts (issues #40/#41/#42: antes o split
// calculava o excedente pra fornecedor externo mas não existia nenhum jeito de
// finalizar/enviar esse excedente pra aprovação — ficava só no estado local do
// navegador, sem rastro nenhum).
//
// Diferença importante pro pedido VP: NÃO cria Pedido de Compra/Venda no Omie
// ao ser aprovado (o fornecedor concorrente não é o mesmo cadastro de fornecedor
// VP na Omie da filial — criar automaticamente exigiria localizar/cadastrar um
// fornecedor novo lá, o que não foi pedido e arriscaria sujar a Omie com um
// cadastro errado). Fica marcado como aprovado, com Contas a Pagar a lançar
// manualmente pelo financeiro — ver `financeiro.compra.detalhe` no pedido.
router.post('/externo', authMiddleware, async (req, res) => {
    try {
        const { unidade, fornecedor, vinculo, itens } = req.body;

        const unidadeUp = String(unidade || '').toUpperCase();
        if (!UNIDADES_VALIDAS.includes(unidadeUp)) {
            return res.status(400).json({ error: `Unidade inválida: ${unidade}` });
        }
        if (!fornecedor?.nome || !String(fornecedor.nome).trim()) {
            return res.status(400).json({ error: 'Informe o nome do fornecedor externo.' });
        }
        if (!Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ error: 'Informe ao menos um item para o fornecedor externo.' });
        }
        const invalidos = itens.filter(i => !i.codigoVP || Number(i.quantidade || 0) <= 0 || Number(i.precoConcorrente || 0) <= 0);
        if (invalidos.length > 0) {
            return res.status(400).json({ error: 'Todos os itens precisam de código VP, quantidade positiva e preço do fornecedor positivo.' });
        }

        const itensPedido = itens.map(i => ({
            codigo: i.codigoVP,
            codigoFornecedor: i.codigoFornecedor || null,
            descricao: i.descricao || i.codigoVP,
            quantidade: Number(i.quantidade),
            preco_unitario: Number(i.precoConcorrente),
            precoVP: Number(i.precoVP || 0),
            motivoEstoque: i.motivoEstoque || 'Estoque insuficiente na VerticalParts para atender a quantidade desejada.',
        }));
        const totalCarrinho = itensPedido.reduce((sum, i) => sum + (i.quantidade * i.preco_unitario), 0);
        const aprovacao = criarFluxoAprovacaoProdutos({ valorTotal: totalCarrinho, origem: 'fornecedor_externo' });

        const orderEntry = {
            id: `EXT-${Date.now()}`,
            tipo: 'fornecedor_externo',
            criadoEm: new Date().toISOString(),
            unidade: unidadeUp,
            fornecedor: { nome: String(fornecedor.nome).trim() },
            vinculo: vinculo || null,
            itens: itensPedido,
            finalidade: null,
            aprovacao,
            financeiro: {
                compra: { status: 'pendente', detalhe: 'Aguardando aprovação do fluxo. Compra em fornecedor externo — sem integração automática ao Omie; lançar Contas a Pagar manualmente após a aprovação.' },
                venda: { status: 'nao_aplicavel', detalhe: 'Compra em fornecedor externo — não gera Pedido de Venda na VerticalParts.' },
            },
            pedido_compra: { numero: null, status: 'pendente', detalhe: null },
            pedido_venda: { numero: null, status: 'nao_aplicavel', detalhe: null },
        };

        await appendOrder(orderEntry);

        avisarNovaAprovacao({
            nivel: aprovacao.alcadas[0].nivel,
            orderId: orderEntry.id,
            unidade: unidadeUp,
            valorTotal: totalCarrinho,
        }).then(resultado => registrarLog({
            usuarioEmail: 'sistema',
            acao: resultado.ok ? 'whatsapp.aviso_enviado' : 'whatsapp.aviso_falhou',
            detalhes: { nivel: aprovacao.alcadas[0].nivel, erro: resultado.error || null },
            pedidoId: orderEntry.id,
        })).catch(e => logger.warn(`[whatsapp] Falha ao avisar 1ª alçada do pedido externo ${orderEntry.id}: ${e.message}`));

        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'pedido_externo.criado',
            detalhes: { unidade: unidadeUp, fornecedor: orderEntry.fornecedor.nome, valorTotal: totalCarrinho },
            pedidoId: orderEntry.id,
        });

        res.status(201).json(orderEntry);
    } catch (err) {
        logger.error(`[orders/externo] Erro: ${err.message}`);
        res.status(500).json({ error: 'Erro ao registrar o pedido para fornecedor externo.' });
    }
});

router.get('/aprovacoes/permissoes', authMiddleware, async (req, res) => {
    try {
        res.json(await obterPermissoesAprovacao(req.user?.email));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id/aprovacao', authMiddleware, async (req, res) => {
    try {
        const order = await findOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const aprovacao = ensureAprovacao(order);
        res.json({ id: order.id, pedido_compra: order.pedido_compra, pedido_venda: order.pedido_venda, aprovacao });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/auditoria-omie', authMiddleware, async (req, res) => {
    try {
        const order = await findOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

        if (order.pedido_compra?.status !== 'ok' || order.pedido_venda?.status !== 'ok') {
            return res.status(409).json({
                error: 'Auditoria Omie bloqueada: compra e venda precisam estar criadas com sucesso.',
            });
        }

        if (!order.planoPagamento) {
            return res.status(409).json({
                error: 'Auditoria Omie bloqueada: pedido sem plano de pagamento salvo.',
            });
        }

        try {
            const [consultaCompra, consultaVenda] = await Promise.all([
                omieClient.consultarPedidoCompra({
                    unidade: order.unidade,
                    numero: order.pedido_compra.numero,
                    codigo: order.pedido_compra.codigo,
                    codigoIntegracao: order.pedido_compra.codigo_integracao,
                }),
                omieClient.consultarPedidoVendaVP({
                    codigoPedido: order.pedido_venda.codigo,
                    codigoPedidoIntegracao: order.pedido_venda.codigo_integracao,
                }),
            ]);
            const auditoria = montarAuditoriaOmie({ order, consultaCompra, consultaVenda });
            const updated = await updateOrder(req.params.id, current => ({
                ...current,
                auditoria_omie: auditoria,
            }));
            return res.json({ id: updated.id, auditoria_omie: updated.auditoria_omie });
        } catch (error) {
            const auditoria = montarAuditoriaErro(error);
            const updated = await updateOrder(req.params.id, current => ({
                ...current,
                auditoria_omie: auditoria,
            }));
            return res.status(202).json({ id: updated.id, auditoria_omie: updated.auditoria_omie });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/aprovacao/decisao', authMiddleware, async (req, res) => {
    try {
        const { nivel, decisao, motivo } = req.body;
        const usuario = req.user?.email || 'sistema';
        await validarAprovador(usuario, nivel);

        let aprovouFluxo = false;
        const updated = await updateOrder(req.params.id, order => {
            const aprovacao = ensureAprovacao(order);
            order.aprovacao = registrarDecisao(aprovacao, { nivel, decisao, usuario, motivo });
            aprovouFluxo = order.aprovacao.status === 'aprovado';
            return order;
        });

        if (!updated) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const decisaoNormalizada = String(decisao).toLowerCase();

        await registrarLog({
            usuarioEmail: usuario,
            acao: decisaoNormalizada === 'reprovar' ? 'pedido.reprovado' : 'pedido.alcada_aprovada',
            detalhes: { nivel, motivo },
            pedidoId: req.params.id,
        });

        if (decisaoNormalizada === 'aprovar' && !aprovouFluxo && updated.aprovacao?.alcadaAtual) {
            avisarNovaAprovacao({
                nivel: updated.aprovacao.alcadaAtual,
                orderId: updated.id,
                unidade: updated.unidade,
                valorTotal: calcularValorPedido(updated),
            }).then(resultado => registrarLog({
                usuarioEmail: 'sistema',
                acao: resultado.ok ? 'whatsapp.aviso_enviado' : 'whatsapp.aviso_falhou',
                detalhes: { nivel: updated.aprovacao.alcadaAtual, erro: resultado.error || null },
                pedidoId: updated.id,
            })).catch(e => logger.warn(`[whatsapp] Falha ao avisar próxima alçada do pedido ${updated.id}: ${e.message}`));
        }

        // Aviso de acompanhamento para o Diego: ele deve saber sempre que Gustavo (nível 1)
        // ou Michel (nível 2) aprovar uma etapa — independente de ele já ser o próximo da
        // fila (nesse caso recebe os dois avisos, com textos diferentes) ou de o fluxo
        // já estar totalmente concluído.
        if (decisaoNormalizada === 'aprovar' && Number(nivel) !== 3) {
            avisarAprovacaoParaDiego({
                nivel: Number(nivel),
                orderId: updated.id,
                unidade: updated.unidade,
                valorTotal: calcularValorPedido(updated),
                aprovadoPor: usuario,
            }).then(resultado => registrarLog({
                usuarioEmail: 'sistema',
                acao: resultado.ok ? 'whatsapp.aviso_diego_enviado' : 'whatsapp.aviso_diego_falhou',
                detalhes: { nivel: Number(nivel), erro: resultado.error || null },
                pedidoId: updated.id,
            })).catch(e => logger.warn(`[whatsapp] Falha ao avisar Diego sobre aprovação do pedido ${updated.id}: ${e.message}`));
        }

        if (!aprovouFluxo) {
            return res.json({ id: updated.id, aprovacao: updated.aprovacao });
        }

        // Pedido de fornecedor externo (issues #40/#41/#42): aprovado totalmente, mas
        // NÃO passa pelo gatilho de criação no Omie abaixo — esse bloco é específico do
        // fluxo VerticalParts (Pedido de Compra na filial + Pedido de Venda na VP, a
        // mesma empresa dos dois lados). Fornecedor externo não tem esse par; fica
        // marcado como aprovado, com Contas a Pagar a lançar manualmente pelo financeiro.
        if (updated.tipo === 'fornecedor_externo') {
            await registrarLog({
                usuarioEmail: 'sistema',
                acao: 'pedido_externo.aprovado',
                detalhes: { unidade: updated.unidade, fornecedor: updated.fornecedor?.nome },
                pedidoId: updated.id,
            });
            return res.json({ id: updated.id, aprovacao: updated.aprovacao, financeiro: updated.financeiro });
        }

        // Fluxo totalmente aprovado agora: é este o gatilho para criar de fato o Pedido de
        // Compra (filial) e o Pedido de Venda (VP) no Omie — antes disso o pedido só existia
        // no portal/Supabase, para não sujar as duas contabilidades com pedidos reprovados.
        let comOmie = updated;
        if (comOmie.pedido_venda?.status !== 'ok') {
            try {
                const resultadoOmie = await criarPedidosOmie({
                    unidade: updated.unidade,
                    itens: updated.itens,
                    tipoFrete: updated.tipoFrete,
                    observacoes: updated.observacoesOmie,
                    finalidade: updated.finalidade,
                    planoPagamento: updated.planoPagamento,
                    totalCarrinho: calcularValorPedido(updated),
                });
                comOmie = await updateOrder(req.params.id, current => ({
                    ...current,
                    pedido_compra: resultadoOmie.pedido_compra,
                    pedido_venda: resultadoOmie.pedido_venda,
                    financeiro: resultadoOmie.financeiro,
                    auditoria_omie: resultadoOmie.auditoria_omie,
                }));
                await registrarLog({
                    usuarioEmail: 'sistema',
                    acao: 'pedido.criado_omie',
                    detalhes: { unidade: updated.unidade },
                    pedidoId: updated.id,
                });
            } catch (errOmie) {
                const parcial = errOmie.pedidoOmieParcial;
                const comFalha = await updateOrder(req.params.id, current => ({
                    ...current,
                    pedido_compra: parcial?.pedido_compra || current.pedido_compra,
                    pedido_venda: parcial?.pedido_venda || current.pedido_venda,
                    financeiro: parcial?.financeiro || current.financeiro,
                }));
                logger.error(`Falha ao criar pedidos no Omie após aprovação final de ${updated.id}: ${errOmie.message}`);
                await registrarLog({
                    usuarioEmail: 'sistema',
                    acao: 'pedido.erro_criacao_omie',
                    detalhes: { unidade: updated.unidade, erro: errOmie.message },
                    pedidoId: updated.id,
                });
                return res.status(202).json({
                    id: comFalha.id,
                    aprovacao: comFalha.aprovacao,
                    pedido_compra: comFalha.pedido_compra,
                    pedido_venda: comFalha.pedido_venda,
                    erro_omie: errOmie.message,
                });
            }
        }

        if (comOmie.pedido_venda?.status !== 'ok') {
            return res.json({ id: comOmie.id, aprovacao: comOmie.aprovacao, pedido_venda: comOmie.pedido_venda });
        }

        const etapaOperacional = etapaVendaProdutoVP('SEPARAR_ESTOQUE');
        let resultadoSync = { skipped: true, reason: 'Pedido VP já criado na etapa operacional de separação.' };

        const codigoPedido = comOmie.pedido_venda?.codigo;
        const codigoPedidoIntegracao = comOmie.pedido_venda?.codigo_integracao;
        let syncStatus = 'ok';

        if (comOmie.pedido_venda?.etapa !== etapaOperacional.codigo && (codigoPedido || codigoPedidoIntegracao)) {
            try {
                resultadoSync = await omieClient.trocarEtapaPedidoVendaVP({
                    codigoPedido,
                    codigoPedidoIntegracao,
                    etapa: etapaOperacional.codigo,
                });
            } catch (error) {
                syncStatus = 'erro';
                const syncedError = await updateOrder(req.params.id, current => registrarErroSincronizacaoEtapa(current, {
                    origem: 'aprovacao.final',
                    etapaLocal: current.aprovacao?.etapaAtual,
                    etapaOmie: etapaOperacional,
                    error,
                }));
                return res.status(202).json({
                    id: syncedError.id,
                    aprovacao: syncedError.aprovacao,
                    pedido_venda: syncedError.pedido_venda,
                    sync: {
                        status: syncStatus,
                        detalhe: syncedError.pedido_venda?.etapa_sync_detalhe,
                    },
                });
            }
        } else if (!codigoPedido && !codigoPedidoIntegracao) {
            resultadoSync = { skipped: true, reason: 'Pedido VP sem código interno/integrado salvo para sincronizar etapa operacional.' };
        }

        const synced = await updateOrder(req.params.id, current => registrarSincronizacaoEtapa(current, {
            origem: 'aprovacao.final',
            etapaLocal: current.aprovacao?.etapaAtual,
            etapaOmie: etapaOperacional,
            resultado: resultadoSync,
        }));

        res.json({ id: synced.id, aprovacao: synced.aprovacao, pedido_venda: synced.pedido_venda, sync: resultadoSync });
    } catch (err) {
        const status = /sem permissão/i.test(err.message || '') ? 403 : 400;
        res.status(status).json({ error: err.message });
    }
});

// Confirmação manual (override) — uso excepcional. O caminho normal é automático,
// disparado pelo webhook /api/webhooks/sac/entrega-confirmada quando o SAC Pós-Venda 360
// registra a entrega física da mercadoria.
router.post('/:id/confirmar-entrega', authMiddleware, async (req, res) => {
    try {
        await validarFaturamento(req.user?.email);

        if (req.body?.confirmarFaturamento !== true) {
            return res.status(400).json({
                error: 'Confirmação obrigatória: marque explicitamente que a entrega foi conferida e que o pedido VP pode ir para Faturar.',
            });
        }

        const resultado = await confirmarEntregaPedido(req.params.id, {
            origem: 'manual_portal',
            detalhe: `Confirmado manualmente por ${req.user?.email || 'usuário'} no portal Escamax.`,
        });

        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'pedido.entrega_confirmada_manual',
            pedidoId: req.params.id,
        });

        res.json(resultado);
    } catch (err) {
        const detail = err.response?.data?.faultstring || err.response?.data?.message || err.message;
        const status = err.status || (/sem permissão/i.test(detail)
            ? 403
            : /Faturamento bloqueado/i.test(detail)
                ? 409
                : 500);
        res.status(status).json({
            error: status === 500 ? 'Erro ao confirmar entrega e mover pedido VP para Faturar.' : detail,
            detail,
        });
    }
});

module.exports = router;
