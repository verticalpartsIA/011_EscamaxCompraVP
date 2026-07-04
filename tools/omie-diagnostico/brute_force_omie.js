const endpoints = [
    'compras/pedido/',
    'compras/pedidocompra/',
    'produtos/pedidocompra/',
    'geral/pedidocompra/',
    'produtos/pedidocomp/'
];

const calls = [
    'ListarPedidosCompra',
    'ListarPedCompra',
    'ListarPedidos',
];

async function bruteForce() {
    for (const ep of endpoints) {
        for (const cl of calls) {
            try {
                const response = await fetch(`https://app.omie.com.br/api/v1/${ep}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        call: cl,
                        app_key: '7040637959355',
                        app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                        param: [{ pagina: 1, registros_por_pagina: 1 }]
                    })
                });
                const data = await response.json();
                console.log(`EP: ${ep} | CALL: ${cl} | Status: ${data.status || 'unknown'} | Msg: ${data.message || data.error?.status || ''}`);
                if (data.status === 'success' || (data.status === 'error' && data.faultstring)) {
                    console.log('>>> POTENTIAL MATCH FOUND! <<<');
                }
            } catch (e) {
                // ignore
            }
        }
    }
}

bruteForce();
