const omieClient = require('../services/omieClient');
const { normalizarPlanoPagamento } = require('../services/paymentPlan');
const { criarFluxoAprovacaoProdutos } = require('../services/approvalEngine');
const { avisarNovaAprovacao } = require('../services/whatsappNotifier');
const { appendOrder, findOrderByIdempotencyKey } = require('../services/orderStore');
const { cnpjFiliais, calcularTotalCarrinho, validarCheckoutPreflight } = require('../services/checkoutPreflight');
const { validarEstoqueItens } = require('../services/estoqueService');
const logger = require('../utils/logger');
const { registrarLog } = require('../services/auditoriaService');

async function saveOrder(entry) {
    try {
        await appendOrder(entry);
    } catch (e) {
        logger.error(`Erro ao salvar pedido no histórico: ${e.message}`);
    }
}

exports.preflight = async (req, res) => {
    try {
        const resultado = validarCheckoutPreflight(req.body);
        await validarEstoqueItens(req.body.itens);
        res.json(resultado);
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
};

exports.processar = async (req, res) => {
    logger.info(`API: Recebida requisição de checkout: ${JSON.stringify(req.body)}`);
    const { unidade, itens, finalidade, tipoFrete, prioridade, pagamento, enderecoEntrega, transportadora, pedidoVendaRef, contratoRef, idempotencyKey } = req.body;

    const chaveIdempotencia = String(idempotencyKey || '').trim();
    if (chaveIdempotencia) {
        const existente = await findOrderByIdempotencyKey(chaveIdempotencia);
        if (existente) {
            logger.warn(`Checkout idempotente reutilizado: ${chaveIdempotencia} -> ${existente.id}`);
            return res.status(200).json({
                message: 'Pedido já processado anteriormente para esta chave.',
                reused: true,
                orderId: existente.id,
                pedido_compra: existente.pedido_compra?.numero || null,
                pedido_venda: existente.pedido_venda?.numero || null,
                pagamento: existente.planoPagamento ? {
                    qtdeParcelas: existente.planoPagamento.qtdeParcelas,
                    total: existente.planoPagamento.total,
                } : null,
            });
        }
    }

    let preflight;
    try {
        preflight = validarCheckoutPreflight(req.body);
        await validarEstoqueItens(itens);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    if (finalidade === 'Revenda') {
        const pedidoValidado = await omieClient.consultarPedidoVenda(pedidoVendaRef, unidade);
        if (!pedidoValidado) {
            return res.status(400).json({ error: 'Pedido de Venda inválido ou não encontrado na filial selecionada.' });
        }
        if (!pedidoValidado.valorTotal || pedidoValidado.valorTotal <= 0) {
            return res.status(400).json({ error: 'Pedido de Venda sem valor total positivo para calcular o limite de 70%.' });
        }

        const totalCarrinho = calcularTotalCarrinho(itens);
        const limite = pedidoValidado.limiteCompra70;
        if (totalCarrinho > limite) {
            return res.status(400).json({
                error: 'Compra bloqueada: O valor total do carrinho excede o limite de 70% permitido para esta Proposta.',
                totalCarrinho,
                valorProposta: pedidoValidado.valorTotal,
                limiteCompra70: limite,
            });
        }
    }

    const totalCarrinho = preflight.totalCarrinho;
    const planoPagamento = normalizarPlanoPagamento(pagamento, totalCarrinho);
    const aprovacao = criarFluxoAprovacaoProdutos({ valorTotal: totalCarrinho, origem: 'checkout' });

    // Monta texto de observações para enviar ao Omie
    const pagamentoDesc = `Pagamento: ${planoPagamento.descricao}`;

    // Descrição do frete conforme tipo selecionado
    let freteDesc = null;
    if (tipoFrete === '0' && enderecoEntrega) {
        freteDesc = `Frete CIF (VP entrega) — Endereço: ${enderecoEntrega}`;
    } else if (tipoFrete === '2' && transportadora) {
        const parts = ['Frete Transportadora coleta na VP'];
        if (transportadora.razaoSocial) parts.push(`Razão Social: ${transportadora.razaoSocial}`);
        if (transportadora.cnpj) parts.push(`CNPJ: ${transportadora.cnpj}`);
        freteDesc = parts.join(' — ');
    }

    const observacoes = [
        pedidoVendaRef ? `Ref. Pedido de Venda Escamax: ${pedidoVendaRef}` : null,
        contratoRef ? `Ref. Contrato Escamax: ${contratoRef}` : null,
        finalidade ? `Finalidade: ${finalidade}` : null,
        prioridade ? `Prioridade: ${prioridade}` : null,
        freteDesc || null,
        pagamentoDesc || null,
    ].filter(Boolean).join(' | ');

    const cleanCnpjEscamax = cnpjFiliais()[unidade] || null;
    if (!cleanCnpjEscamax) {
        return res.status(400).json({ error: `Unidade "${unidade}" não configurada. Verifique o CNPJ no .env.` });
    }

    const orderEntry = {
        id: `ESC-${Date.now()}`,
        idempotencyKey: chaveIdempotencia || null,
        criadoEm: new Date().toISOString(),
        unidade,
        pedidoVendaRef: pedidoVendaRef || null,
        contratoRef: contratoRef || null,
        itens,
        finalidade: finalidade || null,
        tipoFrete: tipoFrete || '9',
        prioridade: prioridade || null,
        pagamento: pagamento || null,
        planoPagamento,
        observacoesOmie: observacoes,
        aprovacao,
        // O Pedido de Compra (filial) e o Pedido de Venda (VP) só são criados de fato no
        // Omie quando o fluxo de aprovação for concluído (ver POST /:id/aprovacao/decisao em
        // routes/orders.js) — assim um pedido reprovado nunca chega a existir nas duas
        // contabilidades, e a mercadoria não fica disponível para separação antes da aprovação.
        financeiro: {
            compra: { status: 'pendente', detalhe: 'Aguardando aprovação do fluxo para criar o Pedido de Compra na filial Escamax.' },
            venda: { status: 'pendente', detalhe: 'Aguardando aprovação do fluxo para criar o Pedido de Venda na VerticalParts.' },
        },
        pedido_compra: { numero: null, status: 'pendente', detalhe: null },
        pedido_venda: { numero: null, status: 'pendente', detalhe: null },
    };

    try {
        logger.info(`Checkout B2B recebido: ${unidade} -> aguardando aprovação antes de criar no Omie`);

        await saveOrder(orderEntry);

        avisarNovaAprovacao({
            nivel: aprovacao.alcadas[0].nivel,
            orderId: orderEntry.id,
            unidade,
            valorTotal: totalCarrinho,
        }).then(resultado => registrarLog({
            usuarioEmail: 'sistema',
            acao: resultado.ok ? 'whatsapp.aviso_enviado' : 'whatsapp.aviso_falhou',
            detalhes: { nivel: aprovacao.alcadas[0].nivel, erro: resultado.error || null },
            pedidoId: orderEntry.id,
        })).catch(e => logger.warn(`[whatsapp] Falha ao avisar 1ª alçada do pedido ${orderEntry.id}: ${e.message}`));

        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'pedido.criado',
            detalhes: { unidade, valorTotal: totalCarrinho },
            pedidoId: orderEntry.id,
        });

        return res.json({
            message: 'Pedido enviado para aprovação! Assim que aprovado, ele será criado no Omie automaticamente.',
            orderId: orderEntry.id,
            pagamento: {
                qtdeParcelas: planoPagamento.qtdeParcelas,
                total: planoPagamento.total,
            },
        });

    } catch (error) {
        logger.error(`Erro no processarCheckout: ${error.message}`);
        res.status(500).json({
            error: 'Erro ao registrar o pedido para aprovação.',
            detail: error.message,
        });
    }
};

exports.diagnosticar = async (req, res) => {
    const { unidade } = req.query;
    if (!unidade) return res.status(400).json({ error: 'Unidade é obrigatória' });

    try {
        const cleanCnpjVP = (process.env.CNPJ_VP || '15.822.325/0001-27').replace(/\D/g, '');
        const cleanCnpjEscamax = cnpjFiliais()[unidade] || null;

        const results = {
            unidade,
            vp_fornecedor_na_filial: null,
            filial_cliente_na_vp: null,
            api_status: {}
        };

        // 1. Verificar VP na Filial
        try {
            const f = await omieClient.consultarFornecedor(cleanCnpjVP, unidade);
            results.vp_fornecedor_na_filial = f ? `SIM (Cód: ${f.codigo_fornecedor_omie})` : 'NÃO ENCONTRADO (VerticalParts precisa ser cadastrada como Fornecedor na Filial)';
        } catch (e) { results.api_status.filial = e.message; }

        // 2. Verificar Filial na VP
        try {
            const c = await omieClient.consultarCliente(cleanCnpjEscamax, 'VP');
            results.filial_cliente_na_vp = c ? `SIM (Cód: ${c.codigo_cliente_omie})` : 'NÃO ENCONTRADO (Filial precisa ser cadastrada como Cliente na VerticalParts)';
        } catch (e) { results.api_status.vp = e.message; }

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
