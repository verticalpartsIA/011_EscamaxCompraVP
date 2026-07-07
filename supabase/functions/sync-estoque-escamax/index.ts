// Edge Function: sync-estoque-escamax
// Sincroniza o estoque de cada filial Escamax (fisico/reservado/disponivel/minimo)
// para a tabela `estoque_escamax` no Supabase (uma linha por codigo+unidade).
// Chamada por agendamento horário (08h-18h, seg-sex) via Supabase Scheduled
// Functions / pg_cron — não expõe nada sensível: só lê a Omie e escreve no banco.

import { createClient } from "jsr:@supabase/supabase-js@2";

const OMIE_URL = "https://app.omie.com.br/api/v1/estoque/consulta/";

const FILIAIS = [
  { unidade: "BRASILIA", keyEnv: "OMIE_BRASILIA_KEY", secretEnv: "OMIE_BRASILIA_SECRET" },
  { unidade: "FLORIANOPOLIS", keyEnv: "OMIE_FLORIANOPOLIS_KEY", secretEnv: "OMIE_FLORIANOPOLIS_SECRET" },
  { unidade: "PICARRAS", keyEnv: "OMIE_PICARRAS_KEY", secretEnv: "OMIE_PICARRAS_SECRET" },
  { unidade: "SALVADOR", keyEnv: "OMIE_SALVADOR_KEY", secretEnv: "OMIE_SALVADOR_SECRET" },
  { unidade: "SAOPAULO", keyEnv: "OMIE_SAOPAULO_KEY", secretEnv: "OMIE_SAOPAULO_SECRET" },
];

interface OmieProdutoEstoque {
  cCodigo: string;
  cDescricao: string;
  fisico: number;
  reservado: number;
  nSaldo: number;
  estoque_minimo: number;
}

async function buscarEstoqueOmie(appKey: string, appSecret: string): Promise<OmieProdutoEstoque[]> {
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
        app_key: appKey,
        app_secret: appSecret,
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
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const resultadoPorFilial: Record<string, unknown> = {};

  for (const filial of FILIAIS) {
    const appKey = Deno.env.get(filial.keyEnv);
    const appSecret = Deno.env.get(filial.secretEnv);
    if (!appKey || !appSecret) {
      resultadoPorFilial[filial.unidade] = { ok: false, error: `${filial.keyEnv}/${filial.secretEnv} não configurados` };
      continue;
    }

    try {
      const produtos = await buscarEstoqueOmie(appKey, appSecret);

      const linhas = produtos
        .filter((p) => p.cCodigo)
        .map((p) => ({
          codigo: p.cCodigo,
          unidade: filial.unidade,
          descricao: p.cDescricao || null,
          estoque_fisico: p.fisico ?? 0,
          reservado: p.reservado ?? 0,
          estoque_disponivel: p.nSaldo ?? 0,
          estoque_minimo: p.estoque_minimo ?? 0,
          atualizado_em: new Date().toISOString(),
        }));

      const TAMANHO_LOTE = 500;
      let gravados = 0;
      for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
        const lote = linhas.slice(i, i + TAMANHO_LOTE);
        const { error } = await supabase.from("estoque_escamax").upsert(lote, { onConflict: "codigo,unidade" });
        if (error) throw new Error(`Supabase upsert falhou: ${error.message}`);
        gravados += lote.length;
      }

      resultadoPorFilial[filial.unidade] = { ok: true, produtos_encontrados: produtos.length, gravados };
    } catch (err) {
      resultadoPorFilial[filial.unidade] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const algumaFalha = Object.values(resultadoPorFilial).some((r) => !(r as { ok: boolean }).ok);

  return new Response(JSON.stringify({ ok: !algumaFalha, filiais: resultadoPorFilial }), {
    status: algumaFalha ? 207 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
