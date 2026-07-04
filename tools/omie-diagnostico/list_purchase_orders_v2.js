async function listPurchaseOrders() {
    try {
        const response = await fetch('https://app.omie.com.br/api/v1/compras/pedido/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                call: 'ListarPedidosCompra',
                app_key: '7040637959355',
                app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                param: [{
                    pagina: 1,
                    registros_por_pagina: 5,
                    apenas_importado_api: 'N'
                }]
            })
        });
        const data = await response.json();
        console.log('--- ListarPedidosCompra Response ---');
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
}

listPurchaseOrders();
