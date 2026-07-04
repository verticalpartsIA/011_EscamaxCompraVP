/**
 * Busca os códigos de API (cCodCateg) que correspondem às descrições
 * "Mercadorias Aplicados em Serviços" (Aplicação) e "Mercadorias de Revenda" (Revenda)
 * em TODAS as categorias de cada filial (não só as que começam com 2.)
 */
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const UNIDADES = {
    PICARRAS:      { key: process.env.OMIE_PICARRAS_KEY,      secret: process.env.OMIE_PICARRAS_SECRET },
    BRASILIA:      { key: process.env.OMIE_BRASILIA_KEY,      secret: process.env.OMIE_BRASILIA_SECRET },
    SAOPAULO:      { key: process.env.OMIE_SAOPAULO_KEY,      secret: process.env.OMIE_SAOPAULO_SECRET },
    FLORIANOPOLIS: { key: process.env.OMIE_FLORIANOPOLIS_KEY, secret: process.env.OMIE_FLORIANOPOLIS_SECRET },
    SALVADOR:      { key: process.env.OMIE_SALVADOR_KEY,      secret: process.env.OMIE_SALVADOR_SECRET },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lines = [];
const log = (msg) => { lines.push(msg); };

async function buscarCategorias(nome, { key, secret }) {
    if (!key || !secret) { log(`${nome}: sem credenciais`); return; }
    try {
        let todas = [];
        let pag = 1, totalPags = 1;
        do {
            const { data } = await axios.post('https://app.omie.com.br/api/v1/geral/categorias/', {
                call: 'ListarCategorias',
                app_key: key,
                app_secret: secret,
                param: [{ pagina: pag, registros_por_pagina: 500 }],
            }, { timeout: 30000, headers: { 'Content-Type': 'application/json' } });
            todas = todas.concat(data.categoria_cadastro || []);
            totalPags = data.total_de_paginas || 1;
            pag++;
        } while (pag <= totalPags);

        log(`\n=== ${nome} (${todas.length} categorias) ===`);

        // Busca por descrições relevantes para Revenda e Aplicação
        const termoRevenda = ['revenda', '4.201', 'mercadorias de revenda'];
        const termoAplicacao = ['aplicad', '4.104', 'mercadorias aplicad'];

        log(`\n  CANDIDATAS PARA REVENDA:`);
        for (const c of todas) {
            const cod = String(c.codigo || c.cCodCateg || '');
            const desc = String(c.descricao || c.cDescrCateg || '').toLowerCase();
            if (termoRevenda.some(t => desc.includes(t.toLowerCase()))) {
                log(`    cCodCateg=${cod.padEnd(12)} | ${c.descricao || c.cDescrCateg}`);
            }
        }

        log(`\n  CANDIDATAS PARA APLICAÇÃO:`);
        for (const c of todas) {
            const cod = String(c.codigo || c.cCodCateg || '');
            const desc = String(c.descricao || c.cDescrCateg || '').toLowerCase();
            if (termoAplicacao.some(t => desc.includes(t.toLowerCase()))) {
                log(`    cCodCateg=${cod.padEnd(12)} | ${c.descricao || c.cDescrCateg}`);
            }
        }
    } catch (e) {
        log(`${nome}: ERRO - ${e.response?.data?.faultstring || e.message}`);
    }
}

(async () => {
    await sleep(5000); // pequeno delay anti rate-limit
    for (const [nome, creds] of Object.entries(UNIDADES)) {
        await buscarCategorias(nome, creds);
        await sleep(2000);
    }
    const outPath = path.resolve(__dirname, 'categorias_mapeamento.txt');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`Resultado salvo em: ${outPath}`);
})();
