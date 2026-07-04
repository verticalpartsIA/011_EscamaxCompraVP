const ALCADAS_PRODUTOS = [
    {
        nivel: 1,
        papel: 'Gustavo',
        valorMin: 0.01,
        valorMax: 3000,
    },
    {
        nivel: 2,
        papel: 'Michel',
        valorMin: 3000.01,
        valorMax: 5000,
    },
    {
        nivel: 3,
        papel: 'Diego',
        valorMin: 5000.01,
        valorMax: Infinity,
    },
];

const ETAPAS_KANBAN_PRODUTOS = {
    SOLICITADO: { codigo: '00', label: 'Solicitado' },
    EM_APROVACAO: { codigo: '01', label: 'Em Aprovação' },
    APROVADO: { codigo: '02', label: 'Aprovado' },
    ENVIADO: { codigo: '03', label: 'Enviado' },
    ENTREGUE: { codigo: '04', label: 'Entregue' },
    FATURAR: { codigo: '05', label: 'Faturar' },
    CANCELADO: { codigo: '99', label: 'Cancelado/Reprovado' },
};

const { buscarUsuarioPorEmail, normalizarEmail } = require('./usuariosService');

// Permissões agora vêm da tabela `usuarios` (gerenciada em "Convidar Usuário"),
// não mais de variáveis de ambiente. alcada_nivel identifica Gustavo(1)/Michel(2)/
// Diego(3); is_admin dá acesso a Logs/Convite e à alçada de faturamento manual.
async function obterPermissoesAprovacao(email) {
    const emailNormalizado = normalizarEmail(email);
    const usuario = await buscarUsuarioPorEmail(emailNormalizado);

    if (!usuario || !usuario.ativo) {
        return { email: emailNormalizado, admin: false, niveis: [], podeFaturar: false, usuario: null };
    }

    return {
        email: emailNormalizado,
        admin: Boolean(usuario.is_admin),
        niveis: usuario.alcada_nivel ? [Number(usuario.alcada_nivel)] : [],
        podeFaturar: Boolean(usuario.is_admin),
        usuario,
    };
}

async function validarAprovador(email, nivel) {
    const permissoes = await obterPermissoesAprovacao(email);
    if (!permissoes.niveis.includes(Number(nivel))) {
        throw new Error(`Usuário sem permissão para decidir a ${nivel}ª alçada.`);
    }
    return permissoes;
}

async function validarFaturamento(email) {
    const permissoes = await obterPermissoesAprovacao(email);
    if (!permissoes.podeFaturar) {
        throw new Error('Usuário sem permissão para confirmar entrega e mover o pedido para Faturar.');
    }
    return permissoes;
}

function obterAlcadasNecessarias(valorTotal) {
    const valor = Number(valorTotal || 0);
    if (valor <= 0) {
        throw new Error('Valor total inválido para cálculo de alçadas.');
    }

    const ultimaAlcada = ALCADAS_PRODUTOS.find(alcada => valor >= alcada.valorMin && valor <= alcada.valorMax);
    const nivelMaximo = ultimaAlcada?.nivel || 3;
    return ALCADAS_PRODUTOS.filter(alcada => alcada.nivel <= nivelMaximo);
}

function criarFluxoAprovacaoProdutos({ valorTotal, origem = 'checkout' }) {
    const alcadas = obterAlcadasNecessarias(valorTotal);
    return {
        modulo: 'Produtos',
        origem,
        valorTotal: Number(valorTotal || 0),
        status: 'em_aprovacao',
        etapaAtual: ETAPAS_KANBAN_PRODUTOS.EM_APROVACAO.codigo,
        etapaLabel: ETAPAS_KANBAN_PRODUTOS.EM_APROVACAO.label,
        alcadaAtual: alcadas[0].nivel,
        alcadas: alcadas.map(alcada => ({
            nivel: alcada.nivel,
            papel: alcada.papel,
            status: 'pendente',
            aprovadoEm: null,
            aprovadoPor: null,
            motivoReprovacao: null,
        })),
        historico: [
            {
                evento: 'fluxo.iniciado',
                etapa: ETAPAS_KANBAN_PRODUTOS.EM_APROVACAO.codigo,
                criadoEm: new Date().toISOString(),
            },
        ],
    };
}

function registrarDecisao(fluxo, { nivel, decisao, usuario, motivo = '' }) {
    if (!fluxo || fluxo.status !== 'em_aprovacao') {
        throw new Error('Fluxo de aprovação não está aberto para decisão.');
    }
    if (Number(nivel) !== Number(fluxo.alcadaAtual)) {
        throw new Error(`A decisão esperada é da ${fluxo.alcadaAtual}ª alçada.`);
    }

    const alcada = fluxo.alcadas.find(item => Number(item.nivel) === Number(nivel));
    if (!alcada) throw new Error(`Alçada ${nivel} não pertence a este fluxo.`);

    if (!String(motivo || '').trim()) {
        throw new Error('Justificativa obrigatória: todo aprovador precisa justificar a decisão (aprovar ou reprovar).');
    }

    const decisaoNormalizada = String(decisao || '').toLowerCase();
    if (decisaoNormalizada === 'reprovar') {
        alcada.status = 'reprovado';
        alcada.aprovadoPor = usuario || null;
        alcada.motivoReprovacao = motivo || null;
        fluxo.status = 'reprovado';
        fluxo.etapaAtual = ETAPAS_KANBAN_PRODUTOS.CANCELADO.codigo;
        fluxo.etapaLabel = ETAPAS_KANBAN_PRODUTOS.CANCELADO.label;
        fluxo.historico.push({
            evento: 'fluxo.reprovado',
            nivel,
            usuario: usuario || null,
            motivo: motivo || null,
            criadoEm: new Date().toISOString(),
        });
        return fluxo;
    }

    if (decisaoNormalizada !== 'aprovar') {
        throw new Error('Decisão inválida. Use aprovar ou reprovar.');
    }

    alcada.status = 'aprovado';
    alcada.aprovadoEm = new Date().toISOString();
    alcada.aprovadoPor = usuario || null;
    alcada.justificativa = motivo;
    fluxo.historico.push({
        evento: 'alcada.aprovada',
        nivel,
        usuario: usuario || null,
        justificativa: motivo,
        criadoEm: new Date().toISOString(),
    });

    const proxima = fluxo.alcadas.find(item => item.status === 'pendente');
    if (proxima) {
        fluxo.alcadaAtual = proxima.nivel;
        return fluxo;
    }

    fluxo.status = 'aprovado';
    fluxo.alcadaAtual = null;
    fluxo.etapaAtual = ETAPAS_KANBAN_PRODUTOS.APROVADO.codigo;
    fluxo.etapaLabel = ETAPAS_KANBAN_PRODUTOS.APROVADO.label;
    fluxo.historico.push({
        evento: 'fluxo.aprovado',
        etapa: ETAPAS_KANBAN_PRODUTOS.APROVADO.codigo,
        criadoEm: new Date().toISOString(),
    });
    return fluxo;
}

function confirmarEntrega(fluxo, meta = {}) {
    const atualizado = {
        ...fluxo,
        etapaAtual: ETAPAS_KANBAN_PRODUTOS.FATURAR.codigo,
        etapaLabel: ETAPAS_KANBAN_PRODUTOS.FATURAR.label,
        historico: [
            ...(fluxo?.historico || []),
            {
                evento: 'produto.entregue',
                etapa: ETAPAS_KANBAN_PRODUTOS.ENTREGUE.codigo,
                origem: meta.origem || 'manual_portal',
                detalhe: meta.detalhe || null,
                criadoEm: new Date().toISOString(),
            },
            {
                evento: 'financeiro.faturar.solicitado',
                etapa: ETAPAS_KANBAN_PRODUTOS.FATURAR.codigo,
                criadoEm: new Date().toISOString(),
            },
        ],
    };
    return atualizado;
}

module.exports = {
    ALCADAS_PRODUTOS,
    ETAPAS_KANBAN_PRODUTOS,
    obterAlcadasNecessarias,
    criarFluxoAprovacaoProdutos,
    registrarDecisao,
    confirmarEntrega,
    obterPermissoesAprovacao,
    validarAprovador,
    validarFaturamento,
};
