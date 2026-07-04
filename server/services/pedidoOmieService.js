const omieClient = require('./omieClient');
const { criarRegistroContasPagarEscamax } = require('./financialTrace');
const { etapaVendaProdutoVP } = require('./omieStages');
const { montarAuditoriaOmie, montarAuditoriaErro } = require('./omieAudit');
const { cnpjFiliais } = require('./checkoutPreflight');
const logger = require('../utils/logger');

// Cria o Pedido de Compra (filial Escamax) e o Pedido de Venda (VerticalParts) no Omie.
// Chamado SOMENTE quando o fluxo de aprovação é concluído (todas as alçadas necessárias
// aprovaram) — antes disso o pedido existe apenas no portal/Supabase, sem nenhum
// lançamento financeiro real nas duas contabilidades. Isso evita que um pedido reprovado
// vire lixo no Omie (Pedido de Compra/Venda órfão) e evita que a mercadoria seja
// operacionalmente separada antes da aprovação.
async function criarPedidosOmie({ unidade, itens, tipoFrete, observacoes, finalidade, planoPagamento, totalCarrinho }) {
    const cleanCnpjVP = (process.env.CNPJ_VP || '15.822.325/0001-27').replace(/\D/g, '');
    const cleanCnpjEscamax = cnpjFiliais()[unidade] || null;

    if (!cleanCnpjEscamax) {
        throw new Error(`Unidade "${unidade}" não configurada. Verifique o CNPJ no .env.`);
    }

    const resultado = {
        pedido_compra: { numero: null, status: 'pendente', detalhe: null },
        pedido_venda: { numero: null, status: 'pendente', detalhe: null },
        financeiro: {
            compra: { status: 'pendente', detalhe: null },
            venda: { status: 'pendente', detalhe: null },
        },
        auditoria_omie: null,
    };

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
        resultado.pedido_compra = {
            numero: idCompra,
            codigo: nCodPedCompra,
            codigo_integracao: resCompra.cCodIntPed || resCompra.codigo_pedido_integracao || null,
            status: 'ok',
            detalhe: null,
        };
        resultado.financeiro.compra = criarRegistroContasPagarEscamax({
            unidade,
            pedidoCompra: resultado.pedido_compra,
            planoPagamento,
            totalPedido: totalCarrinho,
        });
    } catch (errCompra) {
        const detalhe = errCompra.response?.data?.faultstring || errCompra.message;
        resultado.pedido_compra = { numero: null, status: 'erro', detalhe };
        resultado.financeiro.compra = { status: 'erro', detalhe };
        throw Object.assign(errCompra, { pedidoOmieParcial: resultado });
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
        resultado.pedido_venda = {
            numero: idVenda,
            codigo: resVenda.codigo_pedido_omie || resVenda.codigo_pedido || null,
            codigo_integracao: resVenda.codigo_pedido_integracao || null,
            etapa: etapaInicialVP.codigo,
            etapa_label: etapaInicialVP.label,
            status: 'ok',
            detalhe: null,
        };
        resultado.financeiro.venda = {
            status: 'pedido_venda_criado',
            origem: 'Omie VerticalParts',
            pedidoVendaNumero: idVenda,
            pedidoVendaCodigo: resultado.pedido_venda.codigo,
            pedidoVendaIntegracao: resultado.pedido_venda.codigo_integracao,
            total: planoPagamento.total,
            qtdeParcelas: planoPagamento.qtdeParcelas,
            criadoEm: new Date().toISOString(),
            observacao: 'Pedido de Venda VP criado com o mesmo plano financeiro usado no Pedido de Compra Escamax.',
        };
    } catch (errVenda) {
        const detalhe = errVenda.response?.data?.faultstring || errVenda.message;
        resultado.pedido_venda = { numero: null, status: 'erro', detalhe };
        resultado.financeiro.venda = { status: 'erro', detalhe };

        // Compensação: a compra já foi criada na filial mas a venda VP falhou.
        if (nCodPedCompra) {
            try {
                await omieClient.excluirPedidoCompra({ unidade, nCodPed: nCodPedCompra });
                logger.warn(`Compensação: Pedido de Compra ${idCompra} cancelado na ${unidade} após falha na venda VP.`);
                resultado.pedido_compra.status = 'cancelado_compensacao';
                resultado.pedido_compra.detalhe = 'Cancelado automaticamente porque o Pedido de Venda VP falhou.';
                resultado.financeiro.compra = { status: 'cancelado_compensacao', detalhe: resultado.pedido_compra.detalhe };
            } catch (errCancel) {
                const detalheCancel = errCancel.response?.data?.faultstring || errCancel.message;
                logger.error(`Compensação FALHOU: Pedido de Compra ${idCompra} segue ativo na ${unidade}. Reconciliar manualmente. Motivo: ${detalheCancel}`);
                resultado.pedido_compra.compensacao = { status: 'falhou', detalhe: detalheCancel, em: new Date().toISOString() };
            }
        }

        throw Object.assign(errVenda, { pedidoOmieParcial: resultado });
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

    // 4. Auditoria Omie (best-effort, não bloqueia)
    try {
        const [consultaCompra, consultaVenda] = await Promise.all([
            omieClient.consultarPedidoCompra({
                unidade,
                numero: resultado.pedido_compra.numero,
                codigo: resultado.pedido_compra.codigo,
                codigoIntegracao: resultado.pedido_compra.codigo_integracao,
            }),
            omieClient.consultarPedidoVendaVP({
                codigoPedido: resultado.pedido_venda.codigo,
                codigoPedidoIntegracao: resultado.pedido_venda.codigo_integracao,
            }),
        ]);
        resultado.auditoria_omie = montarAuditoriaOmie({ order: { ...resultado, planoPagamento }, consultaCompra, consultaVenda });
    } catch (error) {
        resultado.auditoria_omie = montarAuditoriaErro(error);
        logger.warn(`Auditoria Omie pendente para pedido de compra ${idCompra}: ${resultado.auditoria_omie.detalhe}`);
    }

    return resultado;
}

module.exports = { criarPedidosOmie };
