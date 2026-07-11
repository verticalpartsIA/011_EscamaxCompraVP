const axios = require('axios');
const logger = require('../utils/logger');
const { etapaVendaProdutoVP } = require('./omieStages');

const OMIE_API_URL = 'https://app.omie.com.br/api/v1/';

const omieHttp = axios.create({
    baseURL: OMIE_API_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
});

const appKeyVP = () => process.env.OMIE_APP_KEY;
const appSecretVP = () => process.env.OMIE_APP_SECRET;

const ACQUIRE_KEYS = (unidade = 'VP') => {
    const filiais = {
        PICARRAS:      { key: process.env.OMIE_PICARRAS_KEY,      secret: process.env.OMIE_PICARRAS_SECRET },
        BRASILIA:      { key: process.env.OMIE_BRASILIA_KEY,      secret: process.env.OMIE_BRASILIA_SECRET },
        SAOPAULO:      { key: process.env.OMIE_SAOPAULO_KEY,      secret: process.env.OMIE_SAOPAULO_SECRET },
        FLORIANOPOLIS: { key: process.env.OMIE_FLORIANOPOLIS_KEY, secret: process.env.OMIE_FLORIANOPOLIS_SECRET },
        SALVADOR:      { key: process.env.OMIE_SALVADOR_KEY,      secret: process.env.OMIE_SALVADOR_SECRET },
    };
    return filiais[unidade] || { key: appKeyVP(), secret: appSecretVP() };
};

const useMock = () => !appKeyVP() || appKeyVP() === 'YOUR_OMIE_APP_KEY';

// Cache simples para estoque (15 min)
const cacheEstoque = { data: null, lastFetch: 0 };

// ─── Helper: chamada simples à Omie ──────────────────────────────────────────
// Helper para limpar CNPJ (deixar só números)
const limparCNPJ = (cnpj) => (cnpj || '').replace(/\D/g, '');

// Helper: converte código VP para código Filial Escamax (VP → FORESC)
// Ex: VPEL-010 → FORESCEL-010, VPB-3003 → FORESCB-3003, VP-Handrail → FORESC-Handrail
const codigoFilial = (codigoVP) => {
    if (!codigoVP) return codigoVP;
    // Substitui o prefixo VP (case-insensitive) por FORESC
    return codigoVP.replace(/^VP/i, 'FORESC');
};

// A Omie limita chamadas consecutivas pela mesma app_key ("Consumo redundante
// detectado. Aguarde N segundos..."). Extrai o N segundos da própria mensagem
// de erro para saber exatamente quanto esperar antes de tentar de novo.
function segundosDeEsperaRedundante(faultstring) {
    const m = /[Aa]guarde\s+(\d+)\s+segundos?/.exec(faultstring || '');
    return m ? Math.max(1, Number(m[1])) : null;
}

const MAX_TENTATIVAS_REDUNDANTE = 4;

async function omiePost(endpoint, call, param, unidade = 'VP', _tentativa = 1) {
    const { key, secret } = ACQUIRE_KEYS(unidade);

    // Constrói a URL final de forma absoluta e segura
    const baseUrl = 'https://app.omie.com.br/api/v1';
    let path = endpoint;
    if (!path.startsWith('/')) path = '/' + path;
    if (!path.endsWith('/')) path = path + '/';

    const fullUrl = `${baseUrl}${path}`;

    logger.info(`[Omie Call] Unidade: ${unidade} | Call: ${call} | URL: ${fullUrl}`);
    console.log(`[BACKEND] Omie Call: ${call} para ${unidade}`);

    try {
        const { data } = await axios.post(fullUrl, {
            call,
            app_key: key,
            app_secret: secret,
            param: [param],
        }, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`[BACKEND] Omie Success: ${call}`);
        return data;
    } catch (err) {
        const status = err.response?.status || 'desconhecido';
        const faultstring = err.response?.data?.faultstring || '';
        const errorData = err.response?.data ? JSON.stringify(err.response.data) : 'Sem dados';

        const espera = segundosDeEsperaRedundante(faultstring);
        if (espera !== null && _tentativa <= MAX_TENTATIVAS_REDUNDANTE) {
            logger.warn(`[Omie Redundante] ${unidade} - ${call}: aguardando ${espera}s antes de tentar de novo (tentativa ${_tentativa}/${MAX_TENTATIVAS_REDUNDANTE}).`);
            await new Promise(resolve => setTimeout(resolve, espera * 1000));
            return omiePost(endpoint, call, param, unidade, _tentativa + 1);
        }

        logger.error(`[Omie Error] ${unidade} - ${call}: Status ${status} | Erro: ${err.message}`);
        console.error(`[BACKEND ERROR] Omie Call Failed: ${call} | Status: ${status} | Error: ${err.message}`);
        console.error(`[BACKEND ERROR] Details: ${errorData}`);

        if (err.response?.data) {
            logger.error(`[Omie Detail] ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

// ─── ListarProdutos com paginação ─────────────────────────────────────────────
// Usa pagina / registros_por_pagina / total_de_paginas (padrão Omie /geral/)
async function listarTodosProdutos() {
    let pagina = 1;
    let totalPaginas = 1;
    let todos = [];

    do {
        const data = await omiePost('geral/produtos/', 'ListarProdutos', {
            pagina,
            registros_por_pagina: 500,   // máximo suportado pelo Omie
            apenas_importado_api: 'N',
            filtrar_apenas_omiepdv: 'N',
        });

        if (pagina === 1) {
            const total = data.total_de_registros || 0;
            totalPaginas = data.total_de_paginas || Math.ceil(total / 500) || 1;
            logger.info(`Omie ListarProdutos: ${total} produtos, ${totalPaginas} páginas`);
        }

        todos = todos.concat(data.produto_servico_cadastro || []);
        pagina++;
    } while (pagina <= totalPaginas);

    return todos;
}

// ─── ListarPosEstoque com paginação ──────────────────────────────────────────
// ATENÇÃO: este endpoint usa nPagina / nRegPorPagina / nTotPag (diferente!)
async function listarPosicaoEstoque() {
    let nPagina = 1;
    let todos = [];
    const hoje = new Date().toLocaleDateString('pt-BR');

    try {
        do {
            logger.info(`Omie: Buscando estoque página ${nPagina}...`);
            const data = await omiePost('estoque/consulta/', 'ListarPosEstoque', {
                nPagina,
                nRegPorPagina: 50,
                dDataPosicao: hoje,
                cExibeTodos: 'N',
            });

            const items = data.produtos || [];
            todos = todos.concat(items);

            const nTotalPaginas = data.nTotPaginas || 0;

            // Continua enquanto houver páginas informadas pela Omie
            if (nPagina < nTotalPaginas) {
                nPagina++;
            } else {
                break;
            }

            // Segurança: não passar de 200 páginas (10.000 registros)
            if (nPagina > 200) break;
        } while (true);
    } catch (err) {
        logger.error(`Erro ao listarPosicaoEstoque: ${err.message}`);
    }

    return todos;
}

// ─── listarTodos: produtos VP com estoque > 0 (com cache) ────────────────────
exports.listarTodos = async () => {
    if (useMock()) {
        logger.info('Omie: usando Mock data');
        return mockOmieDb.filter(p => p.saldo_estoque > 0);
    }

    // Retorna do cache se ainda válido
    const CACHE_TTL_MS = 15 * 60 * 1000;
    if (cacheEstoque.data && Date.now() - cacheEstoque.lastFetch < CACHE_TTL_MS) {
        logger.info(`Omie: retornando ${cacheEstoque.data.length} produtos do cache`);
        return cacheEstoque.data;
    }

    try {
        const [produtosCadastro, posicaoEstoque] = await Promise.all([
            listarTodosProdutos(),
            listarPosicaoEstoque(),
        ]);

        logger.info(`Omie: ${produtosCadastro.length} produtos em cadastro, ${posicaoEstoque.length} itens em estoque`);

        // Mapa: nCodProd → saldo (campo correto confirmado pelo Omie DEBUG)
        const estoqueMap = new Map();
        for (const pos of posicaoEstoque) {
            const id = pos.nCodProd || pos.codigo_produto;
            const qtd = pos.nSaldo ?? pos.fisico ?? pos.quantidade ?? 0;
            if (id) {
                const totalAtual = estoqueMap.get(id) || 0;
                estoqueMap.set(id, totalAtual + qtd);
            }
        }

        // Filtra todos os produtos VerticalParts (prefixo VP) com estoque > 0
        const PREFIXOS_EXCLUIDOS = ['VPAT', 'VPMP', 'VPCON', 'VPIN', 'VP-E', 'VP-P', 'VPKIT-', 'VPPKIT-'];
        const resultado = produtosCadastro
            .filter(p => {
                // Filtra apenas ativos
                if (p.inativo === 'S') return false;

                const codigoReal = (p.codigo || p.codigo_produto_servico || '').toString().toUpperCase();
                if (!codigoReal.startsWith('VP')) return false;

                // Exclui códigos internos que não são produtos de revenda
                if (PREFIXOS_EXCLUIDOS.some(prefix => codigoReal.startsWith(prefix))) return false;

                const id = p.codigo_produto;
                const saldo = estoqueMap.get(id) || 0;
                return saldo > 0;
            })
            .map(p => {
                const id = p.codigo_produto;
                const saldo = estoqueMap.get(id) || 0;

                const imgObj = (p.imagens || []).find(i => i.cPrincipal === 'S') || (p.imagens || [])[0];
                const urlImg = imgObj ? imgObj.url_imagem : null;

                return {
                    ...p,
                    saldo_estoque: saldo,
                    url_imagem: urlImg
                };
            });

        logger.info(`Omie: ${resultado.length} produtos VerticalParts com estoque encontrados`);

        // Salva no cache se trouxe algo
        if (resultado.length > 0) {
            cacheEstoque.data = resultado;
            cacheEstoque.lastFetch = Date.now();
        }
        return resultado;

    } catch (error) {
        const detail = error.response?.data
            ? JSON.stringify(error.response.data)
            : error.message;
        logger.error(`Omie listarTodos error: ${detail}`);

        // Se temos dados em cache (mesmo que expirados), devolve-os em vez de falhar.
        // Isto garante que o portal funcione durante instabilidades do Omie.
        if (cacheEstoque.data && cacheEstoque.data.length > 0) {
            const ageMin = Math.round((Date.now() - cacheEstoque.lastFetch) / 60000);
            logger.warn(`Omie indisponível — retornando ${cacheEstoque.data.length} produtos do cache (${ageMin} min atrás)`);
            return cacheEstoque.data;
        }

        throw new Error('Falha ao listar produtos da Omie');
    }
};

// Helper: Busca ID do produto pelo código (SKU) em uma conta específica
// Se não encontrar na Piçarras, busca na VP e cria na Piçarras
async function buscarIdPorCodigo(codigo, unidade = 'VP') {
    try {
        // 1. VerticalParts (VP): busca cirúrgica sem varrer o catálogo inteiro
        if (unidade === 'VP') {
            // Tenta 1: ConsultarProduto por codigo_produto_integracao (1 chamada, O(1))
            try {
                const res = await omiePost('geral/produtos/', 'ConsultarProduto', {
                    codigo_produto_integracao: codigo
                }, 'VP');
                if (res.codigo_produto) {
                    logger.info(`Omie: ${codigo} encontrado na VP via ConsultarProduto (ID: ${res.codigo_produto})`);
                    return res.codigo_produto;
                }
            } catch (e) {
                logger.info(`Omie: ConsultarProduto VP ${codigo}: ${e.response?.data?.faultstring || e.message}`);
            }

            // Tenta 1b: ConsultarProduto por codigo (SKU) — muitos produtos têm
            // codigo_produto_integracao vazio na Omie, mas o campo codigo (SKU) sempre existe.
            // Também O(1), evita cair na varredura paginada cara (Tenta 3) na maioria dos casos.
            try {
                const res = await omiePost('geral/produtos/', 'ConsultarProduto', {
                    codigo
                }, 'VP');
                if (res.codigo_produto) {
                    logger.info(`Omie: ${codigo} encontrado na VP via ConsultarProduto por SKU (ID: ${res.codigo_produto})`);
                    return res.codigo_produto;
                }
            } catch (e) {
                logger.info(`Omie: ConsultarProduto VP (por SKU) ${codigo}: ${e.response?.data?.faultstring || e.message}`);
            }

            // Tenta 2: cache em memória já populado (zero custo de API)
            if (cacheEstoque.data && cacheEstoque.data.length > 0) {
                const p = cacheEstoque.data.find(x => (x.codigo || '').toLowerCase() === (codigo || '').toLowerCase());
                if (p) {
                    logger.info(`Omie: ${codigo} encontrado no cache VP (ID: ${p.codigo_produto})`);
                    return p.codigo_produto;
                }
            }

            // Tenta 3: ListarProdutos VP por todas as páginas para achar pelo código SKU (já que VP pode não ter estoque)
            try {
                let pagLookup = 1;
                let totalPags = 1;
                do {
                    const resVP = await omiePost('geral/produtos/', 'ListarProdutos', {
                        pagina: pagLookup, registros_por_pagina: 500,
                        apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
                    }, 'VP');
                    const items = resVP.produto_servico_cadastro || [];
                    totalPags = resVP.total_de_paginas || 1;
                    const found = items.find(x => (x.codigo || '').toLowerCase() === (codigo || '').toLowerCase());
                    if (found) {
                        logger.info(`Omie: ${codigo} encontrado na VP via ListarProdutos p${pagLookup} (ID: ${found.codigo_produto})`);
                        return found.codigo_produto;
                    }
                    if (pagLookup >= totalPags) break;
                    pagLookup++;
                } while (true);
            } catch (e) {
                logger.warn(`Omie: ListarProdutos página a página VP ${codigo} falhou: ${e.message}`);
            }

            logger.warn(`Omie: ${codigo} NÃO encontrado na VP (ConsultarProduto + cache + listagem)`);
            return null;
        }

        // 2. Filial: Tenta localizar pelo Código SKU convertido (FORESC)
        const codFilial = codigoFilial(codigo);
        logger.info(`Omie: Buscando produto na filial ${unidade} com código ${codFilial} (original VP: ${codigo})`);

        // Passo 2a: ConsultarProduto por codigo_produto_integracao
        try {
            const data = await omiePost('geral/produtos/', 'ConsultarProduto', {
                codigo_produto_integracao: codFilial
            }, unidade);
            if (data.codigo_produto) {
                logger.info(`Omie: Produto ${codFilial} encontrado em ${unidade} via ConsultarProduto (ID: ${data.codigo_produto})`);
                return data.codigo_produto;
            }
        } catch (e) {
            logger.info(`Omie: ConsultarProduto ${unidade} para ${codFilial}: ${e.response?.data?.faultstring || e.message}`);
        }

        // Passo 2a-bis: ConsultarProduto por codigo (SKU) — mesmo caso da VP, muitos produtos
        // não têm codigo_produto_integracao preenchido, mas o SKU sempre existe. O(1).
        try {
            const dataSku = await omiePost('geral/produtos/', 'ConsultarProduto', {
                codigo: codFilial
            }, unidade);
            if (dataSku.codigo_produto) {
                logger.info(`Omie: Produto ${codFilial} encontrado em ${unidade} via ConsultarProduto por SKU (ID: ${dataSku.codigo_produto})`);
                return dataSku.codigo_produto;
            }
        } catch (e) {
            // Client-103 = produto não cadastrado com esse código de integração — normal, tentamos Listar
            logger.info(`Omie: ConsultarProduto ${unidade} para ${codFilial}: ${e.response?.data?.faultstring || e.message}`);
        }

        // Passo 2b: ListarProdutos na Filial por todas as páginas
        try {
            let pagLookup = 1;
            let totalPagsFilial = 1;
            do {
                const res = await omiePost('geral/produtos/', 'ListarProdutos', {
                    pagina: pagLookup, registros_por_pagina: 500,
                    apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
                }, unidade);
                const items = res.produto_servico_cadastro || [];
                totalPagsFilial = res.total_de_paginas || 1;
                if (pagLookup === 1) logger.info(`Omie: ListarProdutos ${unidade}: ${res.total_de_registros || items.length} produtos, ${totalPagsFilial} páginas`);
                const p = items.find(x => (x.codigo || '').toLowerCase() === codFilial.toLowerCase());
                if (p) {
                    logger.info(`Omie: Produto ${codFilial} encontrado em ${unidade} via ListarProdutos p${pagLookup} (ID: ${p.codigo_produto})`);
                    return p.codigo_produto;
                }
                if (pagLookup >= totalPagsFilial) break;
                pagLookup++;
            } while (true);
            logger.info(`Omie: Produto ${codFilial} não encontrado em ${unidade} após ${totalPagsFilial} páginas`);
        } catch (e) {
            logger.warn(`Omie: ListarProdutos ${unidade} falhou: ${e.message}`);
        }

        // 3. Se ainda não achou na Filial, busca na VP via ConsultarProduto (funciona mesmo sem estoque)
        // e clona para a Filial
        if (unidade !== 'VP') {
            // ConsultarProduto na VP — parâmetro correto é codigo_produto_integracao
            let detVP = null;
            try {
                detVP = await omiePost('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: codigo }, 'VP');
                logger.info(`Omie: ConsultarProduto VP retornou produto ${codigo} para clonar em ${unidade}`);
            } catch (e) {
                logger.warn(`Omie: ConsultarProduto VP falhou para ${codigo}: ${e.response?.data?.faultstring || e.message} — buscando via ListarProdutos VP`);
            }

            // Fallback: ListarProdutos VP (catálogo completo, sem filtro de estoque)
            if (!detVP) {
                try {
                    let pagVP = 1, totalPagsVP = 1;
                    do {
                        const resVP = await omiePost('geral/produtos/', 'ListarProdutos', {
                            pagina: pagVP, registros_por_pagina: 500,
                            apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
                        }, 'VP');
                        const items = resVP.produto_servico_cadastro || [];
                        totalPagsVP = resVP.total_de_paginas || 1;
                        const found = items.find(x => (x.codigo || '').toLowerCase() === (codigo || '').toLowerCase());
                        if (found) { detVP = found; logger.info(`Omie: ${codigo} encontrado na VP via ListarProdutos p${pagVP} para clonar em ${unidade}`); break; }
                        if (pagVP >= totalPagsVP) break;
                        pagVP++;
                    } while (true);
                } catch (e) {
                    logger.warn(`Omie: ListarProdutos VP falhou ao buscar ${codigo} para clone: ${e.message}`);
                }
            }

            // Último fallback: cache listarTodos (só produtos com estoque > 0)
            if (!detVP) {
                const todosVP = await exports.listarTodos();
                detVP = todosVP.find(x => (x.codigo || '').toLowerCase() === (codigo || '').toLowerCase()) || null;
                if (detVP) logger.info(`Omie: ${codigo} encontrado via cache listarTodos para clonar`);
            }

            if (!detVP) {
                logger.error(`Omie: Produto ${codigo} NÃO encontrado na VP via ConsultarProduto nem no cache — não é possível clonar para ${unidade}`);
                return null;
            }

            try {
                // Tenta IncluirProduto na Filial com código FORESC
                logger.info(`Omie: Clonando produto ${codigo} (VP) → ${codFilial} (${unidade})`);
                const resNovo = await omiePost('geral/produtos/', 'IncluirProduto', {
                    codigo_produto_integracao: codFilial,
                    codigo: codFilial,
                    descricao: detVP.descricao,
                    unidade: detVP.unidade || 'UN',
                    ncm: detVP.ncm,
                    valor_unitario: detVP.valor_unitario
                }, unidade);

                // Omie retorna o ID do novo produto em nCodProd (campo real da Omie)
                const novoId = resNovo.nCodProd || resNovo.codigo_produto || resNovo.codigo_produto_omie;
                logger.info(`Omie: Produto ${codFilial} clonado com sucesso para ${unidade} (ID: ${novoId})`);
                return novoId || null;
            } catch (err) {
                const faultstring = err.response?.data?.faultstring || err.response?.data?.message || '';
                const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                logger.warn(`Omie: IncluirProduto ${codigo} em ${unidade} falhou: ${errDetail}`);

                // Qualquer erro que indique que o produto já existe na Filial
                // (Client-142: "código X já está sendo utilizada", ou código de integração duplicado, etc)
                const isDuplicata = faultstring.includes('já está sendo utilizada') ||
                    faultstring.includes('descrição informada já está') ||
                    faultstring.includes('código de integração') ||
                    faultstring.includes('código produto') ||
                    faultstring.includes('já cadastrado') ||
                    faultstring.includes('já existe') ||
                    faultstring.includes('duplicad') ||
                    faultstring.includes('already') ||
                    faultstring.toLowerCase().includes(codFilial.toLowerCase());

                if (isDuplicata) {
                    // Tenta extrair ID numérico longo do faultstring
                    const matchId = faultstring.match(/(\d{7,})/);
                    if (matchId) {
                        const idExistente = parseInt(matchId[1], 10);
                        logger.info(`Omie: Produto ${codFilial} já existe em ${unidade} (ID do erro: ${idExistente})`);
                        return idExistente;
                    }

                    // Tenta extrair código SKU do erro
                    const matchCodigo = faultstring.match(/código ([A-Z0-9\-\.]+)\.?['"\s]/);
                    const codigoBusca = (matchCodigo ? matchCodigo[1] : null) || codFilial;

                    // Fallback final: ListarProdutos na filial buscando pelo código extraido ou FORESC
                    logger.info(`Omie: Buscando ${codFilial} em ${unidade} via ListarProdutos (produto já existe, buscando ID)...`);
                    try {
                        let pagFb = 1;
                        do {
                            const resFallback = await omiePost('geral/produtos/', 'ListarProdutos', {
                                pagina: pagFb, registros_por_pagina: 500,
                                apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N', inativo: 'N'
                            }, unidade);
                            const items = resFallback.produto_servico_cadastro || [];
                            const p = items.find(x =>
                                (x.codigo || '').toLowerCase() === codigoBusca.toLowerCase() ||
                                (x.codigo || '').toLowerCase() === codFilial.toLowerCase()
                            );
                            if (p) {
                                logger.info(`Omie: Produto ${codFilial} localizado em ${unidade} via ListarProdutos (ID: ${p.codigo_produto})`);
                                return p.codigo_produto;
                            }
                            const totalPag = resFallback.total_de_paginas || 1;
                            if (pagFb >= totalPag) break;
                            pagFb++;
                        } while (true);
                    } catch (e) { logger.warn(`Omie: ListarProdutos fallback ${unidade} falhou: ${e.message}`); }
                }

                logger.error(`Omie: Não foi possível inserir nem localizar ${codFilial} em ${unidade}: ${errDetail}`);
                return null;
            }
        }

        return null;
    } catch (error) {
        // Erro genérico
        return null;
    }
}

// ─── incluirPedidoVenda (VP) ──────────────────────────────────────────────────
exports.incluirPedidoVenda = async ({ cnpjCliente, itens, numeroPedidoCliente, observacoes = '', planoPagamento = null }) => {
    // 1. Localiza o cliente pelo CNPJ na VerticalParts
    const clientes = await omiePost('geral/clientes/', 'ListarClientes', {
        pagina: 1,
        registros_por_pagina: 1,
        clientesFiltro: {
            cnpj_cpf: cnpjCliente
        }
    }, 'VP');

    const codCliente = clientes.clientes_cadastro?.[0]?.codigo_cliente_omie;
    if (!codCliente) throw new Error(`Cliente com CNPJ ${cnpjCliente} não encontrado na VerticalParts`);

    // 1.1 Busca a conta corrente do Santander (ou a primeira ativa se não achar)
    const contasResponse = await omiePost('geral/contacorrente/', 'ListarContasCorrentes', {
        pagina: 1,
        registros_por_pagina: 50
    }, 'VP');

    const lista = contasResponse.ListarContasCorrentes || [];

    // Tenta encontrar a conta do Santander que não esteja bloqueada
    // Prioridade 1: Exatamente "BANCO SANTANDER"
    // Prioridade 2: Qualquer uma que contenha "SANTANDER"
    // Prioridade 3: Qualquer uma que não esteja bloqueada
    let contaEscolhida = lista.find(c => (c.descricao || '').toUpperCase() === 'BANCO SANTANDER' && (c.bloqueado || 'N') === 'N');

    if (!contaEscolhida) {
        contaEscolhida = lista.find(c => (c.descricao || '').toUpperCase().includes('SANTANDER') && (c.bloqueado || 'N') === 'N');
    }

    if (!contaEscolhida) {
        contaEscolhida = lista.find(c => (c.bloqueado || 'N') === 'N');
    }

    const codContaCorrente = contaEscolhida ? contaEscolhida.nCodCC : 0;
    const nomeConta = contaEscolhida ? contaEscolhida.descricao : 'Nenhuma conta ativa encontrada';

    logger.info(`Conta selecionada: ${nomeConta} (ID: ${codContaCorrente})`);

    // 2. Monta os itens (precisa do codigo_produto_omie da VP)
    // Se QUALQUER item não puder entrar, o pedido inteiro aborta: um Pedido de
    // Venda parcial silencioso divergiria do Pedido de Compra da filial e
    // quebraria a premissa "Contas a Pagar filial = Contas a Receber VP".
    const itensFormatados = [];
    const itensDescartadosVenda = [];
    for (const item of itens) {
        const idVP = await buscarIdPorCodigo(item.codigo, 'VP');
        if (!idVP) {
            itensDescartadosVenda.push(`${item.codigo} (produto não encontrado na VerticalParts)`);
            continue;
        }

        const nValUnit = item.preco_unitario || item.preco_original || item.preco || null;
        if (!nValUnit || nValUnit <= 0) {
            itensDescartadosVenda.push(`${item.codigo} (sem preço unitário válido: ${nValUnit})`);
            continue;
        }

        itensFormatados.push({
            ide: {
                codigo_item_integracao: item.codigo
            },
            produto: {
                codigo_produto: idVP,
                quantidade: item.quantidade,
                valor_unitario: nValUnit
            }
        });
    }

    if (itensDescartadosVenda.length > 0) {
        const detalhe = itensDescartadosVenda.join('; ');
        logger.error(`Omie: Pedido de Venda VP abortado — itens que não puderam ser incluídos: ${detalhe}`);
        throw new Error(`Pedido de Venda abortado para não divergir do Pedido de Compra. Itens com problema: ${detalhe}`);
    }
    if (itensFormatados.length === 0) {
        throw new Error('Nenhum item válido para criar o Pedido de Venda na VerticalParts.');
    }

    // Identificador único para evitar erro "ID não informado"
    const integrationId = `ESC-${Date.now()}`;

    const etapaInicial = etapaVendaProdutoVP('SEPARAR_ESTOQUE');

    // 3. Inclui o pedido de venda na VP na fase "Separar Estoque / Produção"
    //    Confirmado via ListarEtapasFaturamento (etapafat) para OP:11 Venda de Produto:
    //      10 = Proposta Comercial
    //      20 = Separar Estoque / Produção  ← fase correta
    //      50 = Faturar
    //      60 = Faturado
    //      70 = Entrega
    //      80 = Pedido de Venda
    const result = await omiePost('produtos/pedido/', 'IncluirPedido', {
        cabecalho: {
            codigo_pedido_integracao: integrationId,
            codigo_cliente: codCliente,
            data_previsao: new Date().toLocaleDateString('pt-BR'),
            etapa: etapaInicial.codigo,
            codigo_parcela: planoPagamento?.omieVenda?.codigo_parcela || '999',
            qtde_parcelas: planoPagamento?.omieVenda?.qtde_parcelas || 1,
        },
        det: itensFormatados,
        informacoes_adicionais: {
            codigo_categoria: '1.01.01',
            codigo_conta_corrente: codContaCorrente,
            numero_pedido_cliente: numeroPedidoCliente,
            consumidor_final: 'N',
            enviar_email: 'N',
        },
        ...(planoPagamento?.omieVenda?.lista_parcelas ? { lista_parcelas: planoPagamento.omieVenda.lista_parcelas } : {}),
        ...(observacoes ? { observacoes: { obs_venda: observacoes } } : {}),
    }, 'VP');

    // 4. Número do pedido gerado pelo Omie após IncluirPedido
    // Nota: AlterarPedido NÃO existe na API /produtos/pedido/ do Omie.
    // Os dados adicionais são passados já no IncluirPedido acima.
    const numPedido = result.numero_pedido;

    // 5. Consulta o pedido criado para obter o valor de IPI calculado pelo cenário fiscal da VP
    // Parâmetro correto: nCodPed (inteiro), não codigo_pedido
    let valorIpi = 0;
    if (result.codigo_pedido_omie) {
        try {
            const detalhes = await omiePost('produtos/pedido/', 'ConsultarPedido', {
                nCodPed: result.codigo_pedido_omie
            }, 'VP');
            // Resposta envolve o pedido em pedido_venda_produto; campo IPI é valor_IPI (maiúsculo)
            valorIpi = detalhes?.pedido_venda_produto?.total_pedido?.valor_IPI ?? 0;
            if (valorIpi > 0) logger.info(`Omie VP: IPI do pedido ${numPedido}: R$${valorIpi.toFixed(2)}`);
        } catch (e) {
            logger.warn(`Não foi possível obter IPI do pedido VP: ${e.message}`);
        }
    }

    return { ...result, codigo_pedido_integracao: integrationId, valorIpi };
};

// ─── Helper: obtém a categoria de compra baseada na finalidade × unidade ───────
function obterCategoriaCompra(unidade, finalidade) {
    // Mapeia finalidade → variável .env: CATEG_REVENDA_{UNIDADE} ou CATEG_APLICACAO_{UNIDADE}
    const tipo = (finalidade || '').toLowerCase().includes('aplica') ? 'APLICACAO' : 'REVENDA';
    const envKey = `CATEG_${tipo}_${unidade}`;
    const codigo = process.env[envKey];

    if (codigo) {
        logger.info(`Omie: Categoria de compra para ${unidade} (${finalidade}): ${codigo} [${envKey}]`);
        return codigo;
    }

    // Fallback: tenta a outra finalidade da mesma unidade
    const tipoAlt = tipo === 'REVENDA' ? 'APLICACAO' : 'REVENDA';
    const fallback = process.env[`CATEG_${tipoAlt}_${unidade}`];
    if (fallback) {
        logger.warn(`Omie: ${envKey} não configurada, usando ${`CATEG_${tipoAlt}_${unidade}`}: ${fallback}`);
        return fallback;
    }

    // Sem categoria configurada para nenhuma finalidade desta unidade: falha alto em vez de
    // adivinhar um código. Um fallback silencioso já causou pedido travado com "Categoria não
    // cadastrada" na Omie (ver issue #2) — categoria de despesa é específica de cada filial,
    // não existe um código universal seguro para chutar.
    throw new Error(
        `Omie: categoria de compra não configurada para a unidade "${unidade}" (finalidade "${finalidade}"). ` +
        `Defina CATEG_REVENDA_${unidade} e/ou CATEG_APLICACAO_${unidade} no .env antes de criar pedidos para esta filial.`
    );
}

// ─── incluirRequisicaoCompra (Escamax Filial) ─────────────────────────────────
exports.incluirRequisicaoCompra = async ({ unidade, cnpjFornecedor, itens, tipoFrete = '9', observacoes = '', valorIpi = 0, finalidade = 'Revenda', planoPagamento = null }) => {
    // 1. Localiza o fornecedor (VP) pelo CNPJ na filial Escamax usando o endpoint unificado 'geral/clientes/'
    const dados = await omiePost('geral/clientes/', 'ListarClientes', {
        pagina: 1,
        registros_por_pagina: 1,
        clientesFiltro: {
            cnpj_cpf: cnpjFornecedor
        }
    }, unidade);

    const codFornecedor = dados.clientes_cadastro?.[0]?.codigo_cliente_omie;
    if (!codFornecedor) throw new Error(`Fornecedor ${cnpjFornecedor} não encontrado na unidade ${unidade}. Verifique se a VerticalParts está cadastrada como Cliente/Fornecedor.`);

    // 2. Monta os itens (precisa do codigo_produto_omie da Filial)
    // Item que não pôde ser localizado/clonado ABORTA o pedido inteiro — antes o
    // código seguia sem o item (continue) e a compra saía divergente do carrinho
    // e da venda VP, sem nenhum erro visível ao usuário.
    const itensFormatados = [];
    const itensDescartadosCompra = [];
    logger.info(`Omie: Montando ${itens.length} itens para Requisição de Compra em ${unidade}`);

    // Usa o cache em memória para IPI — sem chamar listarTodos() (evita ListarProdutos + ListarPosEstoque)
    const cacheVP = cacheEstoque.data || [];


    for (const item of itens) {
        logger.info(`Omie: Buscando produto ${item.codigo} para ${unidade}...`);
        const idFilial = await buscarIdPorCodigo(item.codigo, unidade);
        if (!idFilial) {
            logger.error(`Omie: Produto ${item.codigo} não encontrado e não pôde ser clonado para ${unidade}. Verifique se o produto existe na VP e se tem código de integração correto.`);
            itensDescartadosCompra.push(`${item.codigo} (não encontrado/clonável em ${unidade})`);
            continue;
        }
        logger.info(`Omie: Produto ${item.codigo} encontrado em ${unidade} com ID: ${idFilial}`);

        // Extrai alíquota IPI do produto VP (campo perc_ipi ou aliq_ipi)
        const prodVP = cacheVP.find(p => (p.codigo || '').toLowerCase() === item.codigo.toLowerCase());
        const percIpi = prodVP?.perc_ipi ?? prodVP?.aliq_ipi ?? 0;
        if (percIpi > 0) logger.info(`Omie: Produto ${item.codigo} — IPI ${percIpi}%`);

        // Preço unitário: usa preco_unitario (VP custo) ou fallbacks
        const nValUnit = item.preco_unitario || item.preco_original || item.preco || null;
        if (!nValUnit || nValUnit <= 0) {
            itensDescartadosCompra.push(`${item.codigo} (sem preço unitário válido: ${nValUnit})`);
            continue;
        }

        itensFormatados.push({
            nCodProd: idFilial,
            nQtde: item.quantidade,
            nValUnit,
            ...(percIpi > 0 ? { pIpi: percIpi } : {}),
        });
    }

    if (itensDescartadosCompra.length > 0) {
        const detalhe = itensDescartadosCompra.join('; ');
        logger.error(`Omie: Pedido de Compra em ${unidade} abortado — itens que não puderam ser incluídos: ${detalhe}`);
        throw new Error(`Pedido de Compra abortado para não divergir do carrinho. Itens com problema: ${detalhe}`);
    }
    if (itensFormatados.length === 0) {
        logger.error(`Omie: Nenhum item válido para incluir na Requisição de Compra em ${unidade}`);
        throw new Error('Nenhum item válido encontrado para criar o pedido de compra na filial');
    }

    // Identificador único para a requisição de compra
    const integrationId = `PUR-${Date.now()}`;
    logger.info(`Omie: Enviando IncluirPedCompra para ${unidade} com ${itensFormatados.length} itens | Frete: ${tipoFrete} | Obs: ${observacoes}`);

    // 3. Obtém a categoria de compra baseada na finalidade × unidade
    const cCodCateg = obterCategoriaCompra(unidade, finalidade);

    // 4. Inclui o pedido de compra (usando tags exatas da Omie: cabecalho_incluir / frete_incluir / produtos_incluir)
    if (valorIpi > 0) logger.info(`Omie: Adicionando IPI R$${valorIpi.toFixed(2)} como Outras Despesas no pedido de compra`);
    const result = await omiePost('produtos/pedidocompra/', 'IncluirPedCompra', {
        cabecalho_incluir: {
            cCodIntPed: integrationId,
            nCodFor: codFornecedor,
            dDtPrevisao: new Date().toLocaleDateString('pt-BR'),
            cCodParc: planoPagamento?.omieCompra?.cCodParc || '999',
            nQtdeParc: planoPagamento?.omieCompra?.nQtdeParc || 1,
            cCodCateg,
            nCodCC: 0,
            ...(observacoes ? { cObs: observacoes } : {}),
        },
        // Aba "Frete e Outras Despesas" no Omie
        frete_incluir: {
            nValFrete: 0,
            ...(valorIpi > 0 ? { nValDesp: valorIpi } : {}),
        },
        produtos_incluir: itensFormatados,
        ...(planoPagamento?.omieCompra?.parcelas_incluir ? { parcelas_incluir: planoPagamento.omieCompra.parcelas_incluir } : {}),
    }, unidade);

    return { ...result, cCodIntPed: integrationId };
};

exports.trocarEtapaPedidoVendaVP = async ({ codigoPedido, codigoPedidoIntegracao, etapa }) => {
    if (!codigoPedido && !codigoPedidoIntegracao) {
        throw new Error('Informe codigoPedido ou codigoPedidoIntegracao para trocar a etapa do pedido de venda.');
    }
    if (!etapa) {
        throw new Error('Informe a etapa destino do pedido de venda.');
    }

    return await omiePost('produtos/pedido/', 'TrocarEtapaPedido', {
        ...(codigoPedido ? { codigo_pedido: Number(codigoPedido) } : {}),
        ...(codigoPedidoIntegracao ? { codigo_pedido_integracao: codigoPedidoIntegracao } : {}),
        etapa,
    }, 'VP');
};

exports.marcarPedidoVendaVPParaFaturar = async ({ codigoPedido, codigoPedidoIntegracao }) => {
    const etapaFaturar = etapaVendaProdutoVP('FATURAR');
    return exports.trocarEtapaPedidoVendaVP({
        codigoPedido,
        codigoPedidoIntegracao,
        etapa: etapaFaturar.codigo,
    });
};


// ─── atualizarDespesasPedidoCompra ───────────────────────────────────────────
// Atualiza o Pedido de Compra com o valor de IPI como "Outras Despesas"
exports.atualizarDespesasPedidoCompra = async ({ unidade, nCodPed, nValDesp }) => {
    return await omiePost('produtos/pedidocompra/', 'AlterarPedCompra', {
        cabecalho_alterar: { nCodPed },
        frete_alterar: { nValDesp },
    }, unidade);
};

// ─── excluirPedidoCompra ─────────────────────────────────────────────────────
// Usado na compensação do checkout: se o Pedido de Venda VP falhar depois da
// compra já criada na filial, a compra é removida para não gerar contas a
// pagar sem contrapartida.
exports.excluirPedidoCompra = async ({ unidade, nCodPed }) => {
    return await omiePost('produtos/pedidocompra/', 'ExcluirPedCompra', { nCodPed }, unidade);
};

exports.consultarPedidoCompra = async ({ unidade, numero, codigo, codigoIntegracao }) => {
    const filtros = [];
    if (codigo) filtros.push({ nCodPed: Number(codigo) });
    if (numero) filtros.push({ cNumero: String(numero) });
    if (codigoIntegracao) filtros.push({ cCodIntPed: String(codigoIntegracao) });

    if (filtros.length === 0) {
        throw new Error('Informe número, código ou código de integração do pedido de compra.');
    }

    let ultimoErro = null;
    for (const filtro of filtros) {
        try {
            return await omiePost('produtos/pedidocompra/', 'ConsultarPedCompra', filtro, unidade);
        } catch (error) {
            ultimoErro = error;
        }
    }

    throw ultimoErro || new Error('Pedido de compra não encontrado.');
};

// ─── pesquisarPedidosCompra: lista TODOS os pedidos de compra da filial ──────
// Usa o call PesquisarPedCompra (produtos/pedidocompra/). Campos confirmados
// empiricamente contra a API real: nPagina, nRegsPorPagina, dDataInicial/dDataFinal
// (formato DD/MM/AAAA), flags lExibirPedidos* para trazer todas as situações.
exports.pesquisarPedidosCompra = async ({ unidade, pagina = 1, registrosPorPagina = 100, dataInicial, dataFinal }) => {
    return await omiePost('produtos/pedidocompra/', 'PesquisarPedCompra', {
        nPagina: pagina,
        nRegsPorPagina: registrosPorPagina,
        lExibirPedidosPendentes: 'S',
        lExibirPedidosFaturados: 'S',
        lExibirPedidosRecebidos: 'S',
        lExibirPedidosCancelados: 'S',
        lExibirPedidosEncerrados: 'S',
        lExibirPedidosRecParciais: 'S',
        lExibirPedidosFatParciais: 'S',
        ...(dataInicial ? { dDataInicial: dataInicial } : {}),
        ...(dataFinal ? { dDataFinal: dataFinal } : {}),
    }, unidade);
};

// ─── listarPedidosVendaVP: lista TODOS os pedidos de venda da VerticalParts ──
// Usa o call ListarPedidos (produtos/pedido/) na conta da própria VP. Campos
// confirmados empiricamente: pagina, registros_por_pagina (máx. 100 por página),
// filtrar_por_data_de / filtrar_por_data_ate (formato DD/MM/AAAA). Não existe
// filtro por cliente nesta chamada — o filtro é feito no código, por codigo_cliente.
exports.listarPedidosVendaVP = async ({ pagina = 1, registrosPorPagina = 100, dataInicial, dataFinal }) => {
    return await omiePost('produtos/pedido/', 'ListarPedidos', {
        pagina,
        registros_por_pagina: registrosPorPagina,
        ...(dataInicial ? { filtrar_por_data_de: dataInicial } : {}),
        ...(dataFinal ? { filtrar_por_data_ate: dataFinal } : {}),
    }, 'VP');
};

exports.consultarPedidoVendaVP = async ({ codigoPedido, codigoPedidoIntegracao }) => {
    const filtros = [];
    if (codigoPedido) filtros.push({ nCodPed: Number(codigoPedido) });
    if (codigoPedidoIntegracao) filtros.push({ codigo_pedido_integracao: String(codigoPedidoIntegracao) });

    if (filtros.length === 0) {
        throw new Error('Informe código interno ou código de integração do pedido de venda VP.');
    }

    let ultimoErro = null;
    for (const filtro of filtros) {
        try {
            return await omiePost('produtos/pedido/', 'ConsultarPedido', filtro, 'VP');
        } catch (error) {
            ultimoErro = error;
        }
    }

    throw ultimoErro || new Error('Pedido de venda VP não encontrado.');
};

function extrairValorTotalPedido(pedido) {
    const totalPedido = pedido?.total_pedido || pedido?.pedido_venda_produto?.total_pedido || {};
    return Number(
        totalPedido.valor_total_pedido ??
        totalPedido.valor_total ??
        totalPedido.valor_mercadorias ??
        totalPedido.valor_total_geral ??
        totalPedido.nValorTotal ??
        0
    ) || 0;
}

// ─── consultarPedidoVenda: valida pedido de venda da filial Escamax ───────────
exports.consultarPedidoVenda = async (numeroPedido, unidade) => {
    const numeroInt = parseInt(numeroPedido, 10);
    if (isNaN(numeroInt)) throw new Error('Número do pedido inválido');

    const data = await omiePost('produtos/pedido/', 'ListarPedidos', {
        pagina: 1,
        registros_por_pagina: 1,
        numero_pedido_de: numeroInt,
        numero_pedido_ate: numeroInt,
        apenas_resumo: 'N',
    }, unidade);

    const pedidos = data.pedido_venda_produto || [];
    if (pedidos.length === 0) return null;

    const pedido = pedidos[0];
    const cab = pedido.cabecalho || {};
    const info = pedido.informacoes_adicionais || {};

    // Garante que o número retornado bate com o buscado
    const numRetornado = parseInt(cab.numero_pedido, 10);
    if (numRetornado && numRetornado !== numeroInt) return null;

    const vendedor =
        info.nome_vendedor ||
        info.vendedor ||
        cab.nome_vendedor ||
        null;

    let valorTotal = extrairValorTotalPedido(pedido);
    const codigoPedidoOmie = cab.codigo_pedido || cab.codigo_pedido_omie || cab.nCodPed;
    if (!valorTotal && codigoPedidoOmie) {
        try {
            const detalhes = await omiePost('produtos/pedido/', 'ConsultarPedido', {
                nCodPed: Number(codigoPedidoOmie),
            }, unidade);
            valorTotal = extrairValorTotalPedido(detalhes);
        } catch (e) {
            logger.warn(`Omie: não foi possível consultar total do pedido ${numeroPedido}: ${e.message}`);
        }
    }

    return {
        numero: cab.numero_pedido || numeroPedido,
        vendedor,
        valorTotal,
        limiteCompra70: Number((valorTotal * 0.7).toFixed(2)),
    };
};

const TAGS_CONTRATO_COM_PECAS = [
    'contrato com pecas',
    'cto com pecas',
    'contrato parcial com pecas',
    'cto parcial com pecas',
];

function normalizarTextoOmie(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function extrairContratoCadastro(response) {
    return response?.contratoCadastro || response?.contrato_cadastro || response || null;
}

async function consultarContratoPorChave(numeroContrato, unidade) {
    const trimmed = String(numeroContrato || '').trim();

    if (/^\d+$/.test(trimmed)) {
        try {
            const porCodigo = await omiePost('servicos/contrato/', 'ConsultarContrato', {
                contratoChave: { nCodCtr: Number(trimmed) },
            }, unidade);
            const contrato = extrairContratoCadastro(porCodigo);
            if (contrato?.cabecalho) return contrato;
        } catch (e) {
            logger.info(`Omie: ConsultarContrato nCodCtr=${trimmed} em ${unidade}: ${e.response?.data?.faultstring || e.message}`);
        }
    }

    try {
        const porIntegracao = await omiePost('servicos/contrato/', 'ConsultarContrato', {
            contratoChave: { cCodIntCtr: trimmed },
        }, unidade);
        const contrato = extrairContratoCadastro(porIntegracao);
        if (contrato?.cabecalho) return contrato;
    } catch (e) {
        logger.info(`Omie: ConsultarContrato cCodIntCtr=${trimmed} em ${unidade}: ${e.response?.data?.faultstring || e.message}`);
    }

    return null;
}

async function listarContratoPorNumero(numeroContrato, unidade) {
    const alvo = normalizarTextoOmie(numeroContrato);
    let pagina = 1;
    let totalPaginas = 1;

    do {
        const data = await omiePost('servicos/contrato/', 'ListarContratos', {
            pagina,
            registros_por_pagina: 50,
            apenas_importado_api: 'N',
            cExibeObs: 'S',
            cExibirProdutos: 'S',
            cExibirInfoCadastro: 'S',
        }, unidade);

        totalPaginas = Number(data.total_de_paginas || 1);
        const contratos = data.contratoCadastro || [];
        const encontrado = contratos.find(contrato => {
            const cab = contrato.cabecalho || {};
            return [
                cab.cNumCtr,
                cab.nCodCtr,
                cab.cCodIntCtr,
            ].some(valor => normalizarTextoOmie(valor) === alvo);
        });

        if (encontrado) return encontrado;
        pagina++;
    } while (pagina <= totalPaginas);

    return null;
}

exports.consultarContratoComPecas = async (numeroContrato, unidade) => {
    const numero = String(numeroContrato || '').trim();
    if (!numero) throw new Error('Número do contrato obrigatório');

    const contrato =
        await consultarContratoPorChave(numero, unidade) ||
        await listarContratoPorNumero(numero, unidade);

    if (!contrato?.cabecalho) return null;

    const cab = contrato.cabecalho;
    const codigoCliente = cab.nCodCli;
    if (!codigoCliente) {
        throw new Error(`Contrato ${numero} encontrado, mas sem cliente vinculado`);
    }

    const tagsResponse = await omiePost('geral/clientetag/', 'ListarTags', {
        nCodCliente: Number(codigoCliente),
    }, unidade);

    const tags = (tagsResponse.tagsLista || tagsResponse.tags || [])
        .map(tag => String(tag.tag || tag.cTag || tag.nomeTag || '').trim())
        .filter(Boolean);

    const tagValida = tags.find(tag => TAGS_CONTRATO_COM_PECAS.includes(normalizarTextoOmie(tag))) || null;

    return {
        valido: Boolean(tagValida),
        numero: cab.cNumCtr || numero,
        codigo: cab.nCodCtr || null,
        codigoIntegracao: cab.cCodIntCtr || null,
        codigoCliente,
        situacao: cab.cCodSit || null,
        tags,
        tagValida,
    };
};

// ─── Helpers Consulta ─────────────────────────────────────────────────────────

exports.consultarCliente = async (cnpj, unidade = 'VP') => {
    const data = await omiePost('geral/clientes/', 'ListarClientes', {
        pagina: 1,
        registros_por_pagina: 1,
        clientesFiltro: {
            cnpj_cpf: cnpj
        }
    }, unidade);
    return data.clientes_cadastro?.[0];
};

exports.consultarFornecedor = async (cnpj, unidade = 'VP') => {
    const data = await omiePost('geral/clientes/', 'ListarClientes', {
        pagina: 1,
        registros_por_pagina: 1,
        clientesFiltro: {
            cnpj_cpf: cnpj
        }
    }, unidade);
    return data.clientes_cadastro?.[0];
};

// ─── consultarProduto: busca por termo ───────────────────────────────────────
exports.consultarProduto = async (termo) => {
    if (useMock()) {
        const t = termo.toLowerCase();
        return mockOmieDb.filter(p =>
            p.codigo.toLowerCase().includes(t) ||
            p.descricao.toLowerCase().includes(t)
        );
    }
    // Reutiliza o cache se possível
    const todos = await exports.listarTodos();
    const t = termo.toLowerCase();
    return todos.filter(p =>
        (p.codigo || '').toLowerCase().includes(t) ||
        (p.descricao || '').toLowerCase().includes(t)
    );
};

// ─── Mock Data ────────────────────────────────────────────────────────────────
const mockOmieDb = [
    { codigo_produto: 1, codigo: 'VPER-1001', descricao: 'Degrau Escada Rolante', valor_unitario: 200.00, saldo_estoque: 12 },
    { codigo_produto: 2, codigo: 'VPEL-5002', descricao: 'Botão de Elevador', valor_unitario: 60.00, saldo_estoque: 50 },
    { codigo_produto: 3, codigo: 'VPB-3003', descricao: 'Placa Monarch', valor_unitario: 1600.00, saldo_estoque: 2 },
    { codigo_produto: 4, codigo: 'VP-Handrail', descricao: 'Corrimão Preto', valor_unitario: 400.00, saldo_estoque: 5 },
    { codigo_produto: 5, codigo: 'VPP-Handrail-Red', descricao: 'Corrimão Vermelho', valor_unitario: 420.00, saldo_estoque: 0 },
];
