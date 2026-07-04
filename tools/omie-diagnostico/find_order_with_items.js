async function findOrderWithItems() {
    const numbers = ["22", "21", "20", "19", "18"];

    for (const num of numbers) {
        try {
            const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    call: 'ConsultarPedCompra',
                    app_key: '7040637959355',
                    app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                    param: [{ cNumero: num }]
                })
            });
            const data = await response.json();
            if (data.produtos_consulta && data.produtos_consulta.length > 0) {
                console.log(`>>> FOUND ITEMS IN ORDER ${num}! <<<`);
                console.log(JSON.stringify(data, null, 2));
                return;
            } else {
                console.log(`Order ${num} exists but has no items in 'produtos_consulta'`);
            }
        } catch (e) {
            // ignore
        }
    }
}

findOrderWithItems();
