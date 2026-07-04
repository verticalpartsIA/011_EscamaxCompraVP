import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, PackageCheck, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const BRL = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

function calcularTotal(order) {
    return (order.itens || []).reduce((sum, item) => {
        return sum + (Number(item.quantidade || 0) * Number(item.preco_unitario || item.preco || 0));
    }, 0);
}

function statusClass(status) {
    if (status === 'aprovado') return 'border-green-200 bg-green-50 text-green-700';
    if (status === 'reprovado') return 'border-red-200 bg-red-50 text-danger';
    return 'border-amber-200 bg-amber-50 text-amber-700';
}

function formatDateBR(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
}

function ApprovalPill({ alcada, atual }) {
    const active = atual === alcada.nivel && alcada.status === 'pendente';
    return (
        <div className={`rounded-lg border px-3 py-2 ${statusClass(alcada.status)} ${active ? 'ring-2 ring-primary/40' : ''}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.14em]">{alcada.nivel}ª Alçada</p>
            <p className="text-xs font-bold">{alcada.papel}</p>
            <p className="text-[11px] font-semibold capitalize">{alcada.status}</p>
        </div>
    );
}

function OrderApprovalCard({ order, onAction, permissoes }) {
    const [busy, setBusy] = useState('');
    const [motivo, setMotivo] = useState('');
    const [confirmarFaturamento, setConfirmarFaturamento] = useState(false);
    const aprovacao = order.aprovacao || {};
    const planoPagamento = order.planoPagamento || null;
    const contasPagar = order.financeiro?.compra || null;
    const total = calcularTotal(order);
    const podeDecidir = aprovacao.status === 'em_aprovacao' && aprovacao.alcadaAtual;
    const podeAprovarAlcada = podeDecidir && (permissoes?.niveis || []).includes(Number(aprovacao.alcadaAtual));
    const podeEntregar = Boolean(permissoes?.podeFaturar) && aprovacao.status === 'aprovado' && order.pedido_venda?.status === 'ok' && order.pedido_venda?.etapa !== '50';

    const executar = async (type) => {
        setBusy(type);
        try {
            await onAction(order, type, motivo, { confirmarFaturamento });
            setMotivo('');
            if (type === 'entregar') setConfirmarFaturamento(false);
        } catch (error) {
            await onAction(order, 'erro-local', error.message || 'Erro ao executar ação.');
        } finally {
            setBusy('');
        }
    };

    return (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-lg font-bold text-neutral-900">{order.id}</h2>
                        <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-primary-dark">
                            {order.unidade || 'Unidade'}
                        </span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${statusClass(aprovacao.status)}`}>
                            {aprovacao.etapaLabel || aprovacao.status || 'Aguardando'}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                        Compra Escamax Nº {order.pedido_compra?.numero || '-'} · Venda VP Nº {order.pedido_venda?.numero || '-'} · {BRL(total)}
                    </p>
                </div>
                {order.financeiro?.notificado && (
                    <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">
                        <PackageCheck className="h-4 w-4" />
                        {order.financeiro?.origemConfirmacao === 'sac_pv360'
                            ? 'Entrega confirmada pelo SAC Pós-Venda 360 — Faturamento acionado'
                            : 'Financeiro acionado para faturar'}
                    </div>
                )}
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-3">
                {(aprovacao.alcadas || []).map(alcada => (
                    <ApprovalPill key={alcada.nivel} alcada={alcada} atual={aprovacao.alcadaAtual} />
                ))}
            </div>

            {planoPagamento && (
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Plano financeiro Omie</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(planoPagamento.parcelas || []).map(parcela => (
                            <div key={parcela.numero} className="rounded border border-blue-100 bg-white px-2 py-1.5 text-xs font-semibold text-blue-900">
                                <span className="font-black">{parcela.numero}/{planoPagamento.qtdeParcelas}</span>
                                <span className="mx-1">·</span>
                                <span>{BRL(parcela.valor)}</span>
                                <span className="mx-1">·</span>
                                <span>{formatDateBR(parcela.data)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {contasPagar?.status === 'confirmado_por_pedido_compra' && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
                    Contas a pagar Escamax lastreado pelo Pedido de Compra Nº {contasPagar.pedidoCompraNumero || '-'} para a VerticalParts · {BRL(contasPagar.total)} em {contasPagar.qtdeParcelas} parcela(s).
                </div>
            )}
            {order.pedido_venda?.etapa_sync_status === 'erro' && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Aprovação registrada, mas a sincronização de etapa no Omie precisa de revisão: {order.pedido_venda.etapa_sync_detalhe || 'erro não detalhado'}
                </div>
            )}
            {!planoPagamento && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                    Pedido sem plano financeiro salvo. O faturamento ficará bloqueado até correção.
                </div>
            )}

            {podeDecidir && !podeAprovarAlcada && (
                <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-500">
                    Seu usuário não está habilitado para decidir a {aprovacao.alcadaAtual}ª alçada deste pedido.
                </div>
            )}

            {aprovacao.status === 'aprovado' && order.pedido_venda?.status === 'erro' && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        Aprovado, mas a criação no Omie falhou: {order.pedido_venda?.detalhe || order.pedido_compra?.detalhe || 'erro não detalhado'}.
                        Precisa de revisão manual antes de seguir.
                    </span>
                </div>
            )}

            {/* Status do faturamento — somente leitura. A VerticalParts é quem decide quando
                faturar, no ato da entrega (SAC Pós-Venda 360); a Escamax não confirma nada aqui. */}
            {aprovacao.status === 'aprovado' && order.pedido_venda?.status === 'ok' && (
                order.financeiro?.notificado ? (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            {order.financeiro?.origemConfirmacao === 'sac_pv360'
                                ? 'Entrega confirmada automaticamente pelo SAC Pós-Venda 360'
                                : 'Entrega confirmada (override manual)'}
                            {order.financeiro?.notificadoEm ? ` em ${formatDateBR(order.financeiro.notificadoEm)}` : ''}
                            . Faturamento solicitado à VerticalParts.
                        </span>
                    </div>
                ) : (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                        Aguardando a VerticalParts confirmar a entrega física no SAC Pós-Venda 360. Assim que a
                        expedição registrar a entrega, o faturamento é liberado automaticamente — a Escamax não
                        precisa confirmar nada aqui.
                    </div>
                )
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <label className="space-y-1">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Justificativa (obrigatória para aprovar ou reprovar)</span>
                    <input
                        value={motivo}
                        onChange={e => setMotivo(e.target.value)}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="Explique o motivo da decisão"
                    />
                </label>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => executar('aprovar')}
                        disabled={!podeAprovarAlcada || Boolean(busy) || !motivo.trim()}
                        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                    >
                        <CheckCircle2 className="h-4 w-4" />
                        Aprovar Alçada
                    </button>
                    <button
                        type="button"
                        onClick={() => executar('reprovar')}
                        disabled={!podeAprovarAlcada || Boolean(busy) || !motivo.trim()}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                    >
                        <XCircle className="h-4 w-4" />
                        Reprovar
                    </button>
                </div>
            </div>

            {/* Exceção — não é o fluxo normal. Só existe para destravar um pedido caso a
                integração com o SAC Pós-Venda 360 esteja fora do ar. Colapsado por padrão. */}
            {podeEntregar && (
                <details className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                    <summary className="cursor-pointer select-none font-bold uppercase tracking-[0.1em] text-neutral-400">
                        Exceção: forçar faturamento manualmente
                    </summary>
                    <p className="mt-2">
                        Use apenas se a integração com o SAC Pós-Venda 360 estiver indisponível. O normal é a
                        VerticalParts confirmar a entrega no SAC e o faturamento ser liberado sozinho.
                    </p>
                    <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-800">
                        <input
                            type="checkbox"
                            checked={confirmarFaturamento}
                            onChange={e => setConfirmarFaturamento(e.target.checked)}
                            disabled={Boolean(busy)}
                            className="mt-0.5"
                        />
                        <span>Confirmo a entrega física e autorizo mover o Pedido de Venda VP para Faturar agora.</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => executar('entregar')}
                        disabled={!confirmarFaturamento || Boolean(busy)}
                        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-bold text-neutral-700 transition hover:border-primary hover:text-primary-dark disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400"
                    >
                        <PackageCheck className="h-4 w-4" />
                        Forçar Entregue/Faturar (manual)
                    </button>
                </details>
            )}
        </section>
    );
}

export default function AprovacoesPage() {
    const token = localStorage.getItem('token');
    const [orders, setOrders] = useState([]);
    const [permissoes, setPermissoes] = useState({ niveis: [], podeFaturar: false, admin: false });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusMsg, setStatusMsg] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const headers = { Authorization: `Bearer ${token}` };
            const [ordersRes, permissoesRes] = await Promise.all([
                fetch(`${API_BASE}/api/orders`, { headers }),
                fetch(`${API_BASE}/api/orders/aprovacoes/permissoes`, { headers }),
            ]);
            if (!ordersRes.ok) throw new Error(`Erro ${ordersRes.status}`);
            if (!permissoesRes.ok) throw new Error(`Erro ${permissoesRes.status}`);
            const data = await ordersRes.json();
            const userPermissoes = await permissoesRes.json();
            setOrders(data);
            setPermissoes(userPermissoes);
        } catch (e) {
            setError(e.message || 'Erro ao carregar aprovações.');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { carregar(); }, [carregar]);

    const visiveis = useMemo(() => {
        // Pedidos aguardando decisão ainda não existem no Omie (só são criados lá após a
        // aprovação final — ver server/services/pedidoOmieService.js), então não dá mais
        // para filtrar por pedido_compra/pedido_venda "ok" como antes. Mostra tudo,
        // do mais recente para o mais antigo (já vem ordenado assim da API).
        return orders.slice(0, 80);
    }, [orders]);

    const agir = async (order, type, motivo, options = {}) => {
        setStatusMsg('');
        setError('');
        if (type === 'erro-local') {
            setError(motivo || 'Erro ao executar ação.');
            return;
        }
        const url = type === 'entregar'
            ? `${API_BASE}/api/orders/${encodeURIComponent(order.id)}/confirmar-entrega`
            : `${API_BASE}/api/orders/${encodeURIComponent(order.id)}/aprovacao/decisao`;
        const body = type === 'entregar'
            ? JSON.stringify({ confirmarFaturamento: options.confirmarFaturamento === true })
            : JSON.stringify({
                nivel: order.aprovacao?.alcadaAtual,
                decisao: type === 'aprovar' ? 'aprovar' : 'reprovar',
                motivo,
            });

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || `Erro ${res.status}`);
        }

        setStatusMsg(data.sync?.status === 'erro'
            ? 'Decisão registrada, mas a sincronização Omie ficou pendente de revisão.'
            : type === 'entregar'
                ? 'Entrega confirmada e pedido VP movido para Faturar.'
                : 'Decisão registrada com sucesso.');
        await carregar();
    };

    return (
        <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Governança B2B</p>
                    <h1 className="font-display text-2xl font-bold text-black">Alçadas de Aprovação</h1>
                    <p className="mt-1 text-sm text-neutral-500">
                        Após a sequência de aprovações, o faturamento é liberado automaticamente quando o
                        SAC Pós-Venda 360 confirma a entrega física da mercadoria.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-neutral-500">
                        Suas permissões: {permissoes.admin ? 'Administrador de aprovações' : `Alçadas ${(permissoes.niveis || []).join(', ') || 'nenhuma'}`} · Faturamento {permissoes.podeFaturar ? 'liberado' : 'bloqueado'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={carregar}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-bold text-neutral-700 transition hover:border-primary disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Atualizar
                </button>
            </div>

            {statusMsg && (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
                    <ShieldCheck className="h-4 w-4" />
                    {statusMsg}
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-danger">
                    <AlertTriangle className="h-4 w-4" />
                    {error}
                </div>
            )}

            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(item => <div key={item} className="h-40 animate-pulse rounded-xl border border-neutral-200 bg-white" />)}
                </div>
            ) : visiveis.length === 0 ? (
                <div className="rounded-xl border border-neutral-200 bg-white py-16 text-center text-neutral-400">
                    <ClipboardCheck className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p className="text-sm font-semibold">Nenhum pedido pronto para aprovação.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {visiveis.map(order => (
                        <OrderApprovalCard key={order.id} order={order} onAction={agir} permissoes={permissoes} />
                    ))}
                </div>
            )}
        </div>
    );
}
