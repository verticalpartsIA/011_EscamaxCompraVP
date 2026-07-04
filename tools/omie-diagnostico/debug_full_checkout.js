/**
 * debug_full_checkout.js — Simula o checkout completo para detectar onde o VPER-010 falha
 * Uso: node -r dotenv/config debug_full_checkout.js
 */
const omieClient = require('./services/omieClient');
const logger = require('./utils/logger');

const ITENS_TESTE = [
    { codigo: 'VPER-010', quantidade: 2, preco_unitario: 128.475, preco_original: 128.475 },
    { codigo: 'VPER-033n', quantidade: 1, preco_unitario: 182.25, preco_original: 182.25 }
];

async function main() {
    console.log('=== SIMULACAO DO CHECKOUT ===\n');

    // Carrega cache de todos os produtos VP
    console.log('Carregando cache VP...');
    const todosVP = await omieClient.listarTodos();
    console.log('Total produtos VP no cache:', todosVP.length);

    // Verifica se VPER-010 está no cache
    const vper010NoCache = todosVP.find(p => (p.codigo || '').toLowerCase() === 'vper-010');
    if (vper010NoCache) {
        console.log('OK: VPER-010 encontrado no cache VP, ID:', vper010NoCache.codigo_produto);
        console.log('   codigo_produto_integracao:', vper010NoCache.codigo_produto_integracao || '(vazio)');
        console.log('   valor_unitario:', vper010NoCache.valor_unitario);
    } else {
        console.log('ERRO: VPER-010 NAO encontrado no cache VP!');
        console.log('   Listando 10 exemplos de codigos que estao no cache:');
        todosVP.slice(0, 10).forEach(p => console.log('   -', p.codigo, '(estoque:', p.saldo_estoque, ')'));
    }

    console.log('\n--- Processando itens para PICARRAS ---');
    for (const item of ITENS_TESTE) {
        console.log(`\nItem: ${item.codigo}`);
        console.log(`  preco_unitario: ${item.preco_unitario}`);

        // Simula o que incluirRequisicaoCompra faz
        const nValUnit = item.preco_unitario || item.preco_original || item.preco || null;
        if (!nValUnit || nValUnit <= 0) {
            console.log('  SERA IGNORADO por: preco invalido!');
            continue;
        }
        console.log('  preco OK =', nValUnit);

        // Busca ID na filial
        console.log('  Buscando ID na PICARRAS...');
        const idFilial = await require('./services/omieClient').listarTodos // Não, precisamos chamar a função interna
        // Em vez disso, simula o fluxo manualmente:
        console.log('  (verificar logs do servidor para ver o que buscarIdPorCodigo retorna)');
    }

    console.log('\n=== FIM ===');
}

main().catch(e => console.error('ERRO GERAL:', e.message));
