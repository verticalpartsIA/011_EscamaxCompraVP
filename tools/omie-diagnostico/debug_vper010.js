/**
 * debug_vper010.js — Diagnóstico: por que o VPER-010 não entra no Pedido de Compra?
 * 
 * Executa sequência idêntica ao buscarIdPorCodigo() para PICARRAS:
 * 1. ConsultarProduto (codigo_produto_integracao) na PICARRAS
 * 2. ListarProdutos (todas as páginas) na PICARRAS
 * 3. ConsultarProduto (codigo_produto_integracao) na VP
 * 4. IncluirProduto (clone) na PICARRAS
 * 
 * Uso: node debug_vper010.js
 * (Ajuste KEY/SECRET abaixo antes de rodar)
 */

const https = require('https');

// ── Credenciais (ajuste aqui) ────────────────────────────────────────────────
const VP_KEY = process.env.OMIE_APP_KEY || 'SEU_VP_KEY';
const VP_SECRET = process.env.OMIE_APP_SECRET || 'SEU_VP_SECRET';
const PIC_KEY = process.env.OMIE_PICARRAS_KEY || 'SEU_PIC_KEY';
const PIC_SECRET = process.env.OMIE_PICARRAS_SECRET || 'SEU_PIC_SECRET';

const PRODUTO = 'VPER-010'; // produto que está sumindo

function omieCall(endpoint, call, param, key, secret) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ call, app_key: key, app_secret: secret, param: [param] });
        const url = `https://app.omie.com.br/api/v1/${endpoint}`;
        const req = require('https').request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log(`\n=== DIAGNÓSTICO: ${PRODUTO} na PICARRAS ===\n`);

    // Passo 1: ConsultarProduto na PICARRAS
    console.log('1. ConsultarProduto (codigo_produto_integracao) na PICARRAS...');
    try {
        const r = await omieCall('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: PRODUTO }, PIC_KEY, PIC_SECRET);
        console.log(`   Status HTTP: ${r.status}`);
        if (r.data.codigo_produto) {
            console.log(`   ✅ ENCONTRADO! ID: ${r.data.codigo_produto}, Código: ${r.data.codigo}`);
        } else {
            console.log(`   ❌ Não encontrado. Resposta: ${JSON.stringify(r.data)}`);
        }
    } catch (e) { console.log(`   ERRO: ${e.message}`); }

    // Passo 2: ListarProdutos na PICARRAS (página 1 apenas para diagnóstico rápido)
    console.log('\n2. ListarProdutos (página 1) na PICARRAS — buscando VPER-010...');
    try {
        const r = await omieCall('geral/produtos/', 'ListarProdutos', {
            pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N'
        }, PIC_KEY, PIC_SECRET);
        console.log(`   Status HTTP: ${r.status}`);
        const itens = r.data.produto_servico_cadastro || [];
        console.log(`   Total produtos página 1: ${itens.length} | Total páginas: ${r.data.total_de_paginas}`);
        const encontrado = itens.find(p => (p.codigo || '').toLowerCase() === PRODUTO.toLowerCase());
        if (encontrado) {
            console.log(`   ✅ ENCONTRADO via ListarProdutos! ID: ${encontrado.codigo_produto}, Código: ${encontrado.codigo}`);
        } else {
            console.log(`   ❌ Não encontrado na página 1. Verifique as próximas ${r.data.total_de_paginas - 1} páginas manualmente se necessário.`);
            // Mostra 5 primeiros códigos para referência
            console.log(`   Primeiros 5 códigos: ${itens.slice(0, 5).map(p => p.codigo).join(', ')}`);
        }
    } catch (e) { console.log(`   ERRO: ${e.message}`); }

    // Passo 3: ConsultarProduto na VP
    console.log(`\n3. ConsultarProduto (codigo_produto_integracao) na VP...`);
    try {
        const r = await omieCall('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: PRODUTO }, VP_KEY, VP_SECRET);
        console.log(`   Status HTTP: ${r.status}`);
        if (r.data.codigo_produto) {
            console.log(`   ✅ ENCONTRADO na VP! ID: ${r.data.codigo_produto}`);
            console.log(`   Descrição: ${r.data.descricao}`);
            console.log(`   Valor: ${r.data.valor_unitario}`);
            console.log(`   NCM: ${r.data.ncm}`);
        } else {
            console.log(`   ❌ Não encontrado na VP. Resposta: ${JSON.stringify(r.data)}`);
        }
    } catch (e) { console.log(`   ERRO VP: ${JSON.stringify(e.response?.data || e.message)}`); }

    // Passo 4: Verifica se o código de integração está definido na VP via ListarProdutos
    console.log(`\n4. ListarProdutos VP — verificando se ${PRODUTO} tem codigo_produto_integracao preenchido...`);
    try {
        const r = await omieCall('geral/produtos/', 'ListarProdutos', {
            pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N',
            filtrarPorCodigo: PRODUTO
        }, VP_KEY, VP_SECRET);
        const itens = r.data.produto_servico_cadastro || [];
        const p = itens.find(x => (x.codigo || '').toLowerCase() === PRODUTO.toLowerCase());
        if (p) {
            console.log(`   ✅ Produto encontrado via ListarProdutos VP:`);
            console.log(`   ID interno: ${p.codigo_produto}`);
            console.log(`   Código integração: ${p.codigo_produto_integracao || '(vazio)'}`);
            console.log(`   Código: ${p.codigo}`);
        } else {
            console.log(`   ❌ ${PRODUTO} não encontrado na página 1 da VP via ListarProdutos`);
        }
    } catch (e) { console.log(`   ERRO: ${e.message}`); }

    console.log('\n=== FIM DO DIAGNÓSTICO ===\n');
}

main().catch(console.error);
