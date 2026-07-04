/**
 * Lista as etapas de faturamento configuradas na conta VP do Omie
 * usando o endpoint etapafat / ListarEtapasFaturamento
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');
const fs = require('fs');

const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function main() {
    console.log('Buscando etapas de faturamento da conta VP...\n');
    let pagina = 1;
    const todasEtapas = [];

    while (true) {
        const { data } = await axios.post(
            'https://app.omie.com.br/api/v1/produtos/etapafat/',
            {
                call: 'ListarEtapasFaturamento',
                app_key: APP_KEY,
                app_secret: APP_SECRET,
                param: [{ pagina, registros_por_pagina: 50 }]
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );

        const cadastros = data.cadastros || data.cadastrosArray || [];
        console.log(`Página ${pagina}: ${cadastros.length} etapas`);

        for (const c of cadastros) {
            console.log(JSON.stringify(c));
            todasEtapas.push(c);
        }

        const totalPaginas = data.total_de_paginas || 1;
        if (pagina >= totalPaginas || cadastros.length === 0) break;
        pagina++;
    }

    fs.writeFileSync(
        path.resolve(__dirname, 'etapas_faturamento_vp.json'),
        JSON.stringify(todasEtapas, null, 2)
    );
    console.log(`\nTotal: ${todasEtapas.length} etapas salvas em etapas_faturamento_vp.json`);
}

main().catch(e => {
    console.error('ERRO:', e.response ? JSON.stringify(e.response.data) : e.message);
    process.exit(1);
});
