// Migração única: data/orders.json → tabela `pedidos` no Supabase.
// Rodar uma vez com: node migrations/002_migrar_orders_json.js
// Idempotente (upsert por id) — pode ser reexecutada sem duplicar.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fetch = require('../utils/fetchComKeepAlive');
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ARQUIVO = path.resolve(__dirname, '../data/orders.json');

(async () => {
    const orders = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    console.log(`Migrando ${orders.length} pedidos de ${ARQUIVO}...`);

    const rows = orders.map(entry => ({
        id: entry.id,
        criado_em: entry.criadoEm || new Date().toISOString(),
        unidade: entry.unidade || null,
        idempotency_key: entry.idempotencyKey || null,
        dados: entry,
    }));

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?on_conflict=id`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
    });

    if (!resp.ok) {
        console.error('FALHA:', resp.status, (await resp.text()).slice(0, 500));
        process.exit(1);
    }
    console.log(`OK: ${rows.length} pedidos migrados/atualizados na tabela pedidos.`);
})();
