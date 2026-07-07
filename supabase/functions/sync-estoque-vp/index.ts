// Edge Function: sync-estoque-vp
// Sincroniza o estoque da Omie VerticalParts (fisico/reservado/disponivel/minimo)
// para a tabela `estoque_vp` no Supabase. Chamada por agendamento horário
// (08h-18h, seg-sex) via Supabase Scheduled Functions / pg_cron — não expõe
// nada sensível: só lê a Omie e escreve no banco, sem input do cliente.

import { createClient } from "jsr:@supabase/supabase-js@2";

const OMIE_URL = "https://app.omie.com.br/api/v1/estoque/consulta/";
const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY")!;
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET")!;

interface OmieProdutoEstoque {
  cCodigo: string;
  cDescricao: string;
  fisico: number;
  reservado: number;
  nSaldo: number;
  estoque_minimo: number;
}

async function buscarEstoqueOmie(): Promise<OmieProdutoEstoque[]> {
  const hoje = new Date().toLocaleDateString("pt-BR");
  let pagina = 1;
  let totalPaginas = 1;
  const todos: OmieProdutoEstoque[] = [];

  do {
    const resp = await fetch(OMIE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ListarPosEstoque",
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          nPagina: pagina,
          nRegPorPagina: 500,
          dDataPosicao: hoje,
          cExibeTodos: "N",
        }],
      }),
    });

    const data = await resp.json();
    if (data.faultstring) {
      // "Consumo redundante" — espera o tempo indicado e tenta de novo
      const espera = /Aguarde\s+(\d+)\s+segundos?/.exec(data.faultstring || "")?.[1];
      if (espera) {
        await new Promise((r) => setTimeout(r, Number(espera) * 1000));
        continue;
      }
      throw new Error(`Omie: ${data.faultstring}`);
    }

    todos.push(...(data.produtos || []));
    totalPaginas = data.nTotPaginas || 1;
    pagina++;
  } while (pagina <= totalPaginas);

  return todos;
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const produtos = await buscarEstoqueOmie();

    const linhas = produtos
      .filter((p) => p.cCodigo)
      .map((p) => ({
        codigo: p.cCodigo,
        descricao: p.cDescricao || null,
        estoque_fisico: p.fisico ?? 0,
        reservado: p.reservado ?? 0,
        estoque_disponivel: p.nSaldo ?? 0,
        estoque_minimo: p.estoque_minimo ?? 0,
        atualizado_em: new Date().toISOString(),
      }));

    // Upsert em lotes de 500 (limite prático do PostgREST por request)
    const TAMANHO_LOTE = 500;
    let gravados = 0;
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
      const lote = linhas.slice(i, i + TAMANHO_LOTE);
      const { error } = await supabase.from("estoque_vp").upsert(lote, { onConflict: "codigo" });
      if (error) throw new Error(`Supabase upsert falhou: ${error.message}`);
      gravados += lote.length;
    }

    return new Response(
      JSON.stringify({ ok: true, produtos_encontrados: produtos.length, gravados }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
