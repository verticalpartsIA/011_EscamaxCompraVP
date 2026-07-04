/**
 * debug_vper010_v2.js — Diagnóstico simplificado
 * Roda: node -r dotenv/config debug_vper010_v2.js
 */

const https = require('https');

const VP_KEY = process.env.OMIE_APP_KEY;
const VP_SECRET = process.env.OMIE_APP_SECRET;
const PIC_KEY = process.env.OMIE_PICARRAS_KEY;
const PIC_SECRET = process.env.OMIE_PICARRAS_SECRET;

async function omieCall(endpoint, call, param, key, secret) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ call, app_key: key, app_secret: secret, param: [param] });
        const url = new URL(`https://app.omie.com.br/api/v1/${endpoint}`);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ ok: res.statusCode === 200, status: res.statusCode, d: JSON.parse(data) }); }
                catch { resolve({ ok: false, status: res.statusCode, d: data }); }
            });
        });
        req.on('error', e => resolve({ ok: false, status: 0, d: e.message }));
        req.write(body);
        req.end();
    });
}

async function main() {
    const PRODUTO = 'VPER-010';

    console.log('====================================================');
    console.log('DIAGNOSTICO VPER-010 - Por que nao entra no pedido de compra?');
    console.log('====================================================\n');

    // PASSO 1: ConsultarProduto PICARRAS por codigo_produto_integracao
    process.stdout.write('PASO 1 ConsultarProduto PICARRAS por codigo_produto_integracao... ');
    const r1 = await omieCall('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: PRODUTO }, PIC_KEY, PIC_SECRET);
    if (r1.d && r1.d.codigo_produto) {
        console.log('ENCONTRADO ID=' + r1.d.codigo_produto);
    } else {
        console.log('NAO ENCONTRADO | fault=' + (r1.d && r1.d.faultstring || JSON.stringify(r1.d).slice(0, 80)));
    }

    // PASSO 2: ListarProdutos PICARRAS pagina 1
    process.stdout.write('PASO 2 ListarProdutos PICARRAS pag1 buscando ' + PRODUTO + '... ');
    const r2 = await omieCall('geral/produtos/', 'ListarProdutos', { pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N' }, PIC_KEY, PIC_SECRET);
    const itens2 = (r2.d && r2.d.produto_servico_cadastro) || [];
    const p2 = itens2.find(x => (x.codigo || '').toLowerCase() === PRODUTO.toLowerCase());
    console.log('Total=' + itens2.length + ' paginas=' + (r2.d && r2.d.total_de_paginas) + ' | ' + (p2 ? 'ENCONTRADO ID=' + p2.codigo_produto : 'NAO ENCONTRADO'));

    // PASSO 3: ConsultarProduto VP por codigo_produto_integracao
    process.stdout.write('PASO 3 ConsultarProduto VP por codigo_produto_integracao... ');
    const r3 = await omieCall('geral/produtos/', 'ConsultarProduto', { codigo_produto_integracao: PRODUTO }, VP_KEY, VP_SECRET);
    if (r3.d && r3.d.codigo_produto) {
        console.log('ENCONTRADO ID=' + r3.d.codigo_produto + ' descricao=' + r3.d.descricao);
        console.log('  codigo_produto_integracao=' + (r3.d.codigo_produto_integracao || '(vazio)'));
    } else {
        console.log('NAO ENCONTRADO | fault=' + (r3.d && r3.d.faultstring || JSON.stringify(r3.d).slice(0, 80)));
    }

    // PASSO 4: ListarProdutos VP buscando pelo CODIGO (campo codigo)
    process.stdout.write('PASO 4 ListarProdutos VP pag1 buscando ' + PRODUTO + ' pelo campo codigo... ');
    const r4 = await omieCall('geral/produtos/', 'ListarProdutos', { pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N' }, VP_KEY, VP_SECRET);
    const itens4 = (r4.d && r4.d.produto_servico_cadastro) || [];
    const p4 = itens4.find(x => (x.codigo || '').toLowerCase() === PRODUTO.toLowerCase());
    if (p4) {
        console.log('ENCONTRADO ID=' + p4.codigo_produto + ' codigo_integracao=' + (p4.codigo_produto_integracao || '(vazio)'));
    } else {
        console.log('NAO ENCONTRADO na pag 1 (total pags=' + (r4.d && r4.d.total_de_paginas) + ')');
    }

    console.log('\n====================================================');
    console.log('CONCLUSAO:');
    console.log('  VP Key OK?', !!VP_KEY);
    console.log('  PIC Key OK?', !!PIC_KEY);

    if (!p2 && r3.d && !r3.d.codigo_produto) {
        console.log('\n  PROVAVEL CAUSA: VPER-010 nao tem codigo_produto_integracao preenchido na VP.');
        console.log('  SOLUCAO: Usar ListarProdutos da VP como fallback e buscar pelo campo "codigo".');
    } else if (p2) {
        console.log('\n  PRODUTO EXISTE NA PICARRAS como: ID=' + p2.codigo_produto);
        console.log('  O problema pode ser outro - verifique busca via codigo_produto_integracao na Picarras.');
    }
    console.log('====================================================\n');
}

main().catch(console.error);
