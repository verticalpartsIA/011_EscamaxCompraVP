async function testList() {
    const ep = 'produtos/pedidocompra/';
    const call = 'ListarPedidosCompra'; // Tentando com plural

    const response = await fetch(`https://app.omie.com.br/api/v1/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call: call,
            app_key: '7040637959355',
            app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
            param: [{
                pagina: 1,
                registros_por_pagina: 10,
                apenas_importado_api: 'N'
            }]
        })
    });
    const data = await response.json();
    console.log('--- Result ---');
    console.log(JSON.stringify(data, null, 2));
}

testList();
