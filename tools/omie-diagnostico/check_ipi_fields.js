// Diagnóstico: descobre o nome do campo IPI nos produtos VP
// Rode com: node check_ipi_fields.js

const axios = require('axios');
require('dotenv').config({ path: './server/.env' });

const VP_KEY = process.env.VP_APP_KEY || process.env.OMIE_APP_KEY;
const VP_SECRET = process.env.VP_APP_SECRET || process.env.OMIE_APP_SECRET;

async function main() {
    const res = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
        call: 'ListarProdutos',
        app_key: VP_KEY,
        app_secret: VP_SECRET,
        param: [{ pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N' }]
    });

    const produto = res.data.produto_servico_cadastro?.[0];
    if (!produto) { console.log('Nenhum produto retornado'); return; }

    console.log('\n=== CAMPOS DO PRODUTO VP ===');
    console.log('Código:', produto.codigo);
    console.log('Descrição:', produto.descricao?.slice(0, 60));

    // Todos os campos top-level
    console.log('\n--- Todas as chaves top-level ---');
    console.log(Object.keys(produto).sort().join('\n'));

    // Filtra campos relacionados ao IPI
    const ipiFields = Object.entries(produto).filter(([k]) =>
        k.toLowerCase().includes('ipi')
    );
    console.log('\n--- Campos com "ipi" no nome ---');
    if (ipiFields.length === 0) {
        console.log('(nenhum campo com "ipi" encontrado no nível top)');
    } else {
        ipiFields.forEach(([k, v]) => console.log(`  ${k}: ${JSON.stringify(v)}`));
    }

    // Sub-objetos que podem conter IPI
    const subObjects = Object.entries(produto).filter(([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v));
    console.log('\n--- Sub-objetos e seus campos ---');
    subObjects.forEach(([k, v]) => {
        const ipiSub = Object.entries(v).filter(([sk]) => sk.toLowerCase().includes('ipi'));
        if (ipiSub.length > 0) {
            console.log(`  ${k}:`);
            ipiSub.forEach(([sk, sv]) => console.log(`    ${sk}: ${JSON.stringify(sv)}`));
        }
    });
}

main().catch(console.error);
