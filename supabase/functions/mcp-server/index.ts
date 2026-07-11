import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ─── Servidor MCP remoto do Portal Escamax (AprovacaoCompra) ──────────────
// Expõe consulta de pedidos, estoque (VP e Escamax), catálogo Omie,
// histórico de compras, usuários e auditoria como ferramentas MCP para que
// o Claude (claude.ai / Claude Code) possa consultar via um "conector
// personalizado" (Streamable HTTP transport).
//
// Autenticação: chave compartilhada, aceita via header Authorization: Bearer
// <token> OU via query string ?key=<token>. O modo query permite embutir a
// credencial direto na URL do conector do claude.ai — necessário porque o
// domínio compartilhado *.supabase.co aplica CSP sandbox em HTML servido por
// Edge Functions, o que impede qualquer tela de login OAuth de funcionar.
// Sem tela de login, sem OAuth: a primeira requisição já chega autenticada.
//
// Escopo deliberadamente restrito: este portal cria pedidos de compra reais
// na Escamax e pedidos de venda reais na VerticalParts via Omie, e a
// aprovação final de um pedido (3 alçadas) já dispara essa criação
// automaticamente. Por isso NENHUMA ferramenta de escrita aqui aciona Omie,
// decide aprovação ou convida/edita usuário — só leitura, mais duas
// ferramentas de auditoria/observação que não tocam pedidos nem Omie.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "escamax-portal-mcp", version: "1.0.0" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

function jsonResponse(body: unknown, status = 200) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(new TextEncoder().encode(JSON.stringify(body)), { status, headers });
}

// ─── Acesso a dados (PostgREST via service_role) ───────────────────────────

async function supabaseRest<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD"; body?: unknown; headers?: Record<string, string> },
): Promise<{ data: T; count: number }> {
  const method = options?.method || "GET";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Supabase respondeu com status ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // texto simples, mantém message
    }
    throw new Error(message);
  }

  const contentRange = response.headers.get("content-range");
  const count = contentRange ? Number(contentRange.split("/")[1]) || 0 : 0;

  if (method === "HEAD" || response.status === 204) {
    return { data: null as T, count };
  }

  const text = await response.text();
  if (!text) return { data: null as T, count };
  return { data: JSON.parse(text) as T, count };
}

// ─── Autenticação por chave compartilhada (hash em mcp_api_keys) ──────────

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAuthorized(req: Request, url: URL): Promise<boolean> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const bearerToken = match ? match[1].trim() : "";
  const keyParam = (url.searchParams.get("key") || "").trim();

  for (const token of [bearerToken, keyParam]) {
    if (!token) continue;
    const tokenHash = await sha256Hex(token);
    const { data } = await supabaseRest<Array<{ id: string }>>(
      `mcp_api_keys?select=id&token_hash=eq.${tokenHash}&active=eq.true&limit=1`,
    );
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

// ─── Domínio: helpers ───────────────────────────────────────────────────────

const EMPRESAS = ["escamax", "verticalparts"] as const;

function calcularValorPedido(dados: Record<string, unknown>): number {
  const itens = (dados?.itens as Array<Record<string, unknown>>) || [];
  return itens.reduce((acc, item) => {
    const qtd = Number(item.quantidade || 0);
    const preco = Number(item.preco_unitario ?? item.preco ?? 0);
    return acc + qtd * preco;
  }, 0);
}

function resumoPedido(row: { id: string; criado_em: string; unidade: string | null; dados: Record<string, unknown> }) {
  const dados = row.dados || {};
  const compraStatus = (dados.pedido_compra as Record<string, unknown> | undefined)?.status ?? null;
  const vendaStatus = (dados.pedido_venda as Record<string, unknown> | undefined)?.status ?? null;
  return {
    id: row.id,
    criado_em: row.criado_em,
    unidade: row.unidade,
    finalidade: dados.finalidade ?? null,
    prioridade: dados.prioridade ?? null,
    valor_total: calcularValorPedido(dados),
    itens_count: Array.isArray(dados.itens) ? (dados.itens as unknown[]).length : 0,
    pedido_compra_status: compraStatus,
    pedido_venda_status: vendaStatus,
    aprovacao_status: (dados.aprovacao as Record<string, unknown> | undefined)?.status ?? null,
  };
}

// ─── Ferramentas MCP ────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_pedidos",
    description: "Lista pedidos do portal Escamax (requisição de compra + pedido de venda VP), com resumo de status e valor. Não inclui o objeto completo — use get_pedido para o detalhe.",
    inputSchema: {
      type: "object",
      properties: {
        unidade: { type: "string", description: "Filial Escamax (ex: SAOPAULO, BRASILIA, SALVADOR, FLORIANOPOLIS, PICARRAS)." },
        de: { type: "string", description: "Data inicial YYYY-MM-DD (filtra por criado_em)." },
        ate: { type: "string", description: "Data final YYYY-MM-DD (filtra por criado_em)." },
        limit: { type: "number", description: "Máximo de resultados (padrão 30, máx 100)." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 100);
      const params = new URLSearchParams({
        select: "id,criado_em,unidade,dados",
        order: "criado_em.desc",
        limit: String(limit),
      });
      if (args.unidade) params.set("unidade", `eq.${args.unidade}`);
      if (args.de) params.set("criado_em", `gte.${args.de}`);
      if (args.ate) {
        const existing = params.get("criado_em");
        params.delete("criado_em");
        if (existing) params.append("criado_em", existing);
        params.append("criado_em", `lte.${args.ate}T23:59:59`);
      }
      const { data } = await supabaseRest<Array<{ id: string; criado_em: string; unidade: string | null; dados: Record<string, unknown> }>>(
        `pedidos?${params.toString()}`,
      );
      return { pedidos: (data || []).map(resumoPedido) };
    },
  },
  {
    name: "get_pedido",
    description: "Retorna o objeto completo de um pedido (itens, pedido_compra, pedido_venda, aprovação, plano de pagamento, auditoria Omie) pelo id, mais o histórico de logs de auditoria vinculados.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: async (args) => {
      const id = String(args.id);
      const { data: rows } = await supabaseRest<Array<{ id: string; criado_em: string; unidade: string | null; dados: Record<string, unknown> }>>(
        `pedidos?select=id,criado_em,unidade,dados&id=eq.${encodeURIComponent(id)}&limit=1`,
      );
      const pedido = rows?.[0];
      if (!pedido) throw new Error(`Pedido ${id} não encontrado.`);
      const { data: logs } = await supabaseRest(
        `logs_auditoria?select=id,usuario_email,acao,detalhes,criado_em&pedido_id=eq.${encodeURIComponent(id)}&order=criado_em.desc&limit=50`,
      );
      return { ...pedido, logs_auditoria: logs };
    },
  },
  {
    name: "pedidos_stats",
    description: "Agregação mensal de pedidos: total de pedidos, valor total e taxa de sucesso (compra + venda criadas com sucesso no Omie) por mês — mesma lógica do dashboard do portal.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const { data } = await supabaseRest<Array<{ id: string; criado_em: string; dados: Record<string, unknown> }>>(
        "pedidos?select=id,criado_em,dados&order=criado_em.asc&limit=5000",
      );
      const byMonth: Record<string, { mes: string; pedidos: number; valor: number; ok: number; erro: number }> = {};
      let totalGeral = 0;
      let totalPedidos = 0;
      for (const row of data || []) {
        const mes = row.criado_em?.slice(0, 7) || "desconhecido";
        if (!byMonth[mes]) byMonth[mes] = { mes, pedidos: 0, valor: 0, ok: 0, erro: 0 };
        const valor = calcularValorPedido(row.dados || {});
        const compraOk = (row.dados?.pedido_compra as Record<string, unknown> | undefined)?.status === "ok";
        const vendaOk = (row.dados?.pedido_venda as Record<string, unknown> | undefined)?.status === "ok";
        byMonth[mes].pedidos += 1;
        byMonth[mes].valor += valor;
        byMonth[mes].ok += compraOk && vendaOk ? 1 : 0;
        byMonth[mes].erro += !compraOk || !vendaOk ? 1 : 0;
        totalGeral += valor;
        totalPedidos += 1;
      }
      const meses = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));
      return { meses, totalGeral, totalPedidos };
    },
  },
  {
    name: "list_usuarios",
    description: "Lista usuários do portal (Escamax e VerticalParts), com nível de alçada de aprovação e status ativo/inativo.",
    inputSchema: {
      type: "object",
      properties: {
        empresa: { type: "string", enum: EMPRESAS },
        ativo: { type: "boolean" },
      },
    },
    handler: async (args) => {
      const params = new URLSearchParams({ select: "*", order: "criado_em.asc" });
      if (args.empresa) params.set("empresa", `eq.${args.empresa}`);
      if (typeof args.ativo === "boolean") params.set("ativo", `eq.${args.ativo}`);
      const { data } = await supabaseRest(`usuarios?${params.toString()}`);
      return { usuarios: data };
    },
  },
  {
    name: "list_logs_auditoria",
    description: "Lista o log de auditoria de ações do portal (aprovações, reprovações, criação no Omie, avisos de WhatsApp, etc.), com filtro opcional por pedido ou usuário.",
    inputSchema: {
      type: "object",
      properties: {
        pedido_id: { type: "string" },
        usuario_email: { type: "string" },
        limit: { type: "number", description: "Padrão 50, máx 200." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 50, 200);
      const params = new URLSearchParams({ select: "*", order: "criado_em.desc", limit: String(limit) });
      if (args.pedido_id) params.set("pedido_id", `eq.${args.pedido_id}`);
      if (args.usuario_email) params.set("usuario_email", `eq.${args.usuario_email}`);
      const { data } = await supabaseRest(`logs_auditoria?${params.toString()}`);
      return { logs: data };
    },
  },
  {
    name: "list_log_observacoes",
    description: "Lista as observações (comentários) anexadas a um log de auditoria específico.",
    inputSchema: {
      type: "object",
      properties: { log_id: { type: "string" } },
      required: ["log_id"],
    },
    handler: async (args) => {
      const { data } = await supabaseRest(
        `log_observacoes?select=*&log_id=eq.${encodeURIComponent(String(args.log_id))}&order=criado_em.asc`,
      );
      return { observacoes: data };
    },
  },
  {
    name: "add_log_observacao",
    description: "Adiciona uma observação (nota) a um log de auditoria existente. Não altera pedidos, aprovações nem dispara nada no Omie.",
    inputSchema: {
      type: "object",
      properties: {
        log_id: { type: "string" },
        autor_email: { type: "string" },
        mensagem: { type: "string" },
      },
      required: ["log_id", "autor_email", "mensagem"],
    },
    handler: async (args) => {
      const { data } = await supabaseRest<Array<{ id: string }>>("log_observacoes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [{ log_id: args.log_id, autor_email: args.autor_email, mensagem: args.mensagem }],
      });
      return { observacao: data?.[0] };
    },
  },
  {
    name: "registrar_log_auditoria",
    description: "Cria uma entrada manual no log de auditoria (ex: uma anotação administrativa), opcionalmente vinculada a um pedido. Não altera pedidos, aprovações nem dispara nada no Omie.",
    inputSchema: {
      type: "object",
      properties: {
        usuario_email: { type: "string" },
        acao: { type: "string" },
        detalhes: { type: "object", description: "Objeto JSON livre com detalhes adicionais." },
        pedido_id: { type: "string" },
      },
      required: ["usuario_email", "acao"],
    },
    handler: async (args) => {
      const { data } = await supabaseRest<Array<{ id: string }>>("logs_auditoria", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: [{
          usuario_email: args.usuario_email,
          acao: args.acao,
          detalhes: args.detalhes ?? null,
          pedido_id: args.pedido_id ?? null,
        }],
      });
      return { log: data?.[0] };
    },
  },
  {
    name: "list_estoque_vp",
    description: "Consulta o estoque da VerticalParts (fonte única, antes de rateio por filial Escamax) por código ou descrição.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Busca por código ou descrição." },
        somente_disponivel: { type: "boolean", description: "Se true, só retorna itens com estoque_disponivel > 0." },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 100);
      const params = new URLSearchParams({ select: "*", order: "codigo.asc", limit: String(limit) });
      if (args.search) {
        const term = String(args.search).replace(/[,()]/g, "");
        params.set("or", `(codigo.ilike.*${term}*,descricao.ilike.*${term}*)`);
      }
      if (args.somente_disponivel) params.set("estoque_disponivel", "gt.0");
      const { data } = await supabaseRest(`estoque_vp?${params.toString()}`);
      return { estoque: data };
    },
  },
  {
    name: "list_estoque_escamax",
    description: "Consulta o estoque já rateado por filial Escamax, por código, descrição ou unidade.",
    inputSchema: {
      type: "object",
      properties: {
        unidade: { type: "string" },
        search: { type: "string", description: "Busca por código ou descrição." },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 100);
      const params = new URLSearchParams({ select: "*", order: "codigo.asc", limit: String(limit) });
      if (args.unidade) params.set("unidade", `eq.${args.unidade}`);
      if (args.search) {
        const term = String(args.search).replace(/[,()]/g, "");
        params.set("or", `(codigo.ilike.*${term}*,descricao.ilike.*${term}*)`);
      }
      const { data } = await supabaseRest(`estoque_escamax?${params.toString()}`);
      return { estoque: data };
    },
  },
  {
    name: "list_omie_produtos",
    description: "Consulta o catálogo de produtos sincronizado do Omie (preço, estoque, NCM/EAN) por código ou descrição.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        somente_ativos: { type: "boolean" },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 100);
      const params = new URLSearchParams({ select: "*", order: "descricao.asc", limit: String(limit) });
      if (args.search) {
        const term = String(args.search).replace(/[,()]/g, "");
        params.set("or", `(codigo_produto.ilike.*${term}*,descricao.ilike.*${term}*)`);
      }
      if (args.somente_ativos) params.set("ativo", "eq.true");
      const { data } = await supabaseRest(`omie_produtos?${params.toString()}`);
      return { produtos: data };
    },
  },
  {
    name: "list_compras_historico",
    description: "Histórico de compras VerticalParts sincronizado do Omie (pedidos anteriores, por filial/produto/período).",
    inputSchema: {
      type: "object",
      properties: {
        filial: { type: "string" },
        codigo_produto: { type: "string" },
        de: { type: "string", description: "Data inicial YYYY-MM-DD (data_pedido)." },
        ate: { type: "string", description: "Data final YYYY-MM-DD (data_pedido)." },
        limit: { type: "number" },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 30, 200);
      const params = new URLSearchParams({ select: "*", order: "data_pedido.desc", limit: String(limit) });
      if (args.filial) params.set("filial", `eq.${args.filial}`);
      if (args.codigo_produto) params.set("codigo_produto", `eq.${args.codigo_produto}`);
      if (args.de) params.append("data_pedido", `gte.${args.de}`);
      if (args.ate) params.append("data_pedido", `lte.${args.ate}`);
      const { data } = await supabaseRest(`compras_historico_vp?${params.toString()}`);
      return { compras: data };
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── JSON-RPC / MCP plumbing (Streamable HTTP, sem estado de sessão) ──────

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg: Record<string, unknown>) {
  const { method, id, params } = msg as { method?: string; id?: unknown; params?: Record<string, unknown> };

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) {
      return rpcResult(id, { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true });
    }
    try {
      const result = await tool.handler((params?.arguments as Record<string, unknown>) ?? {});
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, { content: [{ type: "text", text: `Erro: ${message}` }], isError: true });
    }
  }

  if (id === undefined) return null; // notificação desconhecida: ignora
  return rpcError(id, -32601, `Método não suportado: ${method}`);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "not_found" }, 404);
  }

  try {
    if (!(await isAuthorized(req, url))) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
    }

    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map((m) => handleMessage(m as Record<string, unknown>)))).filter(
        (r) => r !== null,
      );
      if (results.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return jsonResponse(results);
    }

    const result = await handleMessage(body as Record<string, unknown>);
    if (result === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse(rpcError(null, -32603, err instanceof Error ? err.message : String(err)), 500);
  }
});
