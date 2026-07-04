const omieClient = require('../services/omieClient');
const { normalizarPlanoPagamento } = require('../services/paymentPlan');
const { criarFluxoAprovacaoProdutos } = require('../services/approvalEngine');
const { avisarNovaAprovacao } = require('../services/whatsappNotifier');
const { appendOrder, findOrderByIdempotencyKey } = require('../services/orderStore');
const { criarRegistroContasPagarEscamax } = require('../services/financialTrace');
const { cnpjFiliais, calcularTotalCarrinho, validarCheckoutPreflight } = require('../services/checkoutPreflight');
const { etapaVendaProdutoVP } = require('../services/omieStages');
const { montarAuditoriaOmie, montarAuditoriaErro } = require('../services/omieAudit');
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
        aprovacao,
        financeiro: {
            compra: { status: 'pendente', detalhe: 'Aguardando criação do Pedido de Compra na filial Escamax.' },
            venda: { status: 'pendente', detalhe: 'Aguardando criação do Pedido de Venda na VerticalParts.' },
        },
        pedido_compra: { numero: null, status: 'pendente', detalhe: null },
        pedido_venda: { numero: null, status: 'pendente', detalhe: null },
    };

    try {
        const cleanCnpjVP = (process.env.CNPJ_VP || '15.822.325/0001-27').replace(/\D/g, '');
        const cleanCnpjEscamax = cnpjFiliais()[unidade] || null;

        if (!cleanCnpjEscamax) {
            return res.status(400).json({ error: `Unidade "${unidade}" não configurada. Verifique o CNPJ no .env.` });
        }

        logger.info(`Iniciando Checkout B2B: ${unidade} -> VerticalParts (CNPJs limpos)`);

        // 1. Criar Requisição de Compra na Escamax
        let idCompra = null;
        let nCodPedCompra = null;
        try {
            const resCompra = await omieClient.incluirRequisicaoCompra({
                unidade,
                cnpjFornecedor: cleanCnpjVP,
                itens,
                tipoFrete: tipoFrete || '9',
                observacoes,
                finalidade: finalidade || 'Revenda',
                planoPagamento,
            });
            idCompra = resCompra.cNumero || resCompra.nCodPed;
            nCodPedCompra = resCompra.nCodPed || null;
            logger.info(`Requisição de Compra criada na ${unidade}: ${idCompra} (ID: ${nCodPedCompra})`);
            orderEntry.pedido_compra = {
                numero: idCompra,
                codigo: nCodPedCompra,
                codigo_integracao: resCompra.cCodIntPed || resCompra.codigo_pedido_integracao || null,
                status: 'ok',
                detalhe: null,
            };
            orderEntry.financeiro.compra = criarRegistroContasPagarEscamax({
                unidade,
                pedidoCompra: orderEntry.pedido_compra,
                planoPagamento,
                totalPedido: totalCarrinho,
            });
        } catch (errCompra) {
            const detalhe = errCompra.response?.data?.faultstring || errCompra.message;
            orderEntry.pedido_compra = { numero: null, status: 'erro', detalhe };
            orderEntry.financeiro.compra = { status: 'erro', detalhe };
            // Salva parcial e retorna erro
            await saveOrder(orderEntry);
            throw errCompra;
        }

        // 2. Criar Pedido de Venda na VerticalParts
        let idVenda = null;
        let valorIpi = 0;
        try {
            const resVenda = await omieClient.incluirPedidoVenda({
                cnpjCliente: cleanCnpjEscamax,
                itens,
                numeroPedidoCliente: idCompra,
                observacoes,
                planoPagamento,
            });
            idVenda = resVenda.numero_pedido || resVenda.codigo_pedido_omie;
            valorIpi = resVenda.valorIpi || 0;
            const etapaInicialVP = etapaVendaProdutoVP('SEPARAR_ESTOQUE');
            logger.info(`Pedido de Venda criado na VerticalParts: ${idVenda} | IPI: R$${valorIpi.toFixed(2)}`);
            orderEntry.pedido_venda = {
                numero: idVenda,
                codigo: resVenda.codigo_pedido_omie || resVenda.codigo_pedido || null,
                codigo_integracao: resVenda.codigo_pedido_integracao || null,
                etapa: etapaInicialVP.codigo,
                etapa_label: etapaInicialVP.label,
                status: 'ok',
                detalhe: null,
            };
            orderEntry.financeiro.venda = {
                status: 'pedido_venda_criado',
                origem: 'Omie VerticalParts',
                pedidoVendaNumero: idVenda,
                pedidoVendaCodigo: orderEntry.pedido_venda.codigo,
                pedidoVendaIntegracao: orderEntry.pedido_venda.codigo_integracao,
                total: planoPagamento.total,
                qtdeParcelas: planoPagamento.qtdeParcelas,
                criadoEm: new Date().toISOString(),
                observacao: 'Pedido de Venda VP criado com o mesmo plano financeiro usado no Pedido de Compra Escamax.',
            };
        } catch (errVenda) {
            const detalhe = errVenda.response?.data?.faultstring || errVenda.message;
            orderEntry.pedido_venda = { numero: null, status: 'erro', detalhe };
            orderEntry.financeiro.venda = { status: 'erro', detalhe };

            // Compensação: a compra já foi criada na filial mas a venda VP falhou.
            // Cancela a compra para não deixar um Pedido de Compra órfão gerando
            // contas a pagar sem contrapartida. Se o cancelamento também falhar,
            // fica registrado para reconciliação manual.
            if (nCodPedCompra) {
                try {
                    await omieClient.excluirPedidoCompra({ unidade, nCodPed: nCodPedCompra });
                    logger.warn(`Compensação: Pedido de Compra ${idCompra} cancelado na ${unidade} após falha na venda VP.`);
                    orderEntry.pedido_compra.status = 'cancelado_compensacao';
                    orderEntry.pedido_compra.detalhe = 'Cancelado automaticamente porque o Pedido de Venda VP falhou.';
                    orderEntry.financeiro.compra = { status: 'cancelado_compensacao', detalhe: orderEntry.pedido_compra.detalhe };
                } catch (errCancel) {
                    const detalheCancel = errCancel.response?.data?.faultstring || errCancel.message;
                    logger.error(`Compensação FALHOU: Pedido de Compra ${idCompra} segue ativo na ${unidade}. Reconciliar manualmente. Motivo: ${detalheCancel}`);
                    orderEntry.pedido_compra.compensacao = { status: 'falhou', detalhe: detalheCancel, em: new Date().toISOString() };
                }
            }

            await saveOrder(orderEntry);
            throw errVenda;
        }

        // 3. Se há IPI na Proposta Comercial, atualizar o Pedido de Compra com esse valor
        if (valorIpi > 0 && nCodPedCompra) {
            try {
                await omieClient.atualizarDespesasPedidoCompra({ unidade, nCodPed: nCodPedCompra, nValDesp: valorIpi });
                logger.info(`IPI R$${valorIpi.toFixed(2)} adicionado ao Pedido de Compra ${idCompra}`);
            } catch (e) {
                logger.warn(`Não foi possível atualizar IPI no Pedido de Compra: ${e.message}`);
            }
        }

        try {
            const [consultaCompra, consultaVenda] = await Promise.all([
                omieClient.consultarPedidoCompra({
                    unidade,
                    numero: orderEntry.pedido_compra.numero,
                    codigo: orderEntry.pedido_compra.codigo,
                    codigoIntegracao: orderEntry.pedido_compra.codigo_integracao,
                }),
                omieClient.consultarPedidoVendaVP({
                    codigoPedido: orderEntry.pedido_venda.codigo,
                    codigoPedidoIntegracao: orderEntry.pedido_venda.codigo_integracao,
                }),
            ]);
            orderEntry.auditoria_omie = montarAuditoriaOmie({ order: orderEntry, consultaCompra, consultaVenda });
            logger.info(`Auditoria Omie concluída para ${orderEntry.id}: ${orderEntry.auditoria_omie.status}`);
        } catch (error) {
            orderEntry.auditoria_omie = montarAuditoriaErro(error);
            logger.warn(`Auditoria Omie pendente para ${orderEntry.id}: ${orderEntry.auditoria_omie.detalhe}`);
        }

        // Tudo OK — persiste
        await saveOrder(orderEntry);

        avisarNovaAprovacao({
            nivel: aprovacao.alcadas[0].nivel,
            orderId: orderEntry.id,
            unidade,
            valorTotal: totalCarrinho,
        }).catch(e => logger.warn(`[whatsapp] Falha ao avisar 1ª alçada do pedido ${orderEntry.id}: ${e.message}`));

        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'pedido.criado',
            detalhes: { unidade, valorTotal: totalCarrinho },
            pedidoId: orderEntry.id,
        });

        return res.json({
            message: 'Pedidos criados com sucesso!',
            pedido_compra: idCompra,
            pedido_venda: idVenda,
            pagamento: {
                qtdeParcelas: planoPagamento.qtdeParcelas,
                total: planoPagamento.total,
            },
        });

    } catch (error) {
        logger.error(`Erro no processarCheckout: ${error.message}`);
        if (error.response?.data) {
            logger.error(`Detalhe Omie: ${JSON.stringify(error.response.data)}`);
        }
        res.status(500).json({
            error: 'Erro ao processar integração B2B entre as contas Omie.',
            detail: error.message,
            omieDetail: error.response?.data,
            failedUrl: error.config?.url
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
