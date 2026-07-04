async function findListMethod() {
    const ep = 'produtos/pedidocompra/';
    const methods = ['ListarPedidos', 'ListarPedCompra', 'ListarPedidosCompra', 'ListarPedidosComp'];

    for (const m of methods) {
        const response = await fetch(`https://app.omie.com.br/api/v1/${ep}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                call: m,
                app_key: '7040637959355',
                app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                param: [{ pagina: 1, registros_por_pagina: 1 }]
            })
        });
        const data = await response.json();
        console.log(`Method: ${m} | Status: ${data.status || 'unknown'} | Msg: ${data.message || data.faultstring || ''}`);
        if (data.status === 'success' || (data.status === 'error' && data.faultstring && !data.faultstring.includes('not exists'))) {
            console.log('>>> POTENTIAL MATCH FOR:', m);
        }
    }
}

findListMethod();
