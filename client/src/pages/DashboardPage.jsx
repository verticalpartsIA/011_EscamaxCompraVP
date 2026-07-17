import React, { useState, useEffect } from 'react';
import { ShoppingCart, DollarSign, CheckCircle, TrendingUp, AlertCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const BRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmtMes = (yyyymm) => {
    const [y, m] = yyyymm.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y.slice(2)}`;
};

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────
function BarChart({ data, valueKey, labelKey, formatValue, color }) {
    const W = 560, H = 180, PAD = { top: 10, right: 10, bottom: 32, left: 56 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const max = Math.max(...data.map(d => d[valueKey]), 1);
    const barW = Math.min(36, (innerW / data.length) * 0.6);
    const gap = innerW / data.length;

    // Y-axis ticks (4 ticks)
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
        y: PAD.top + innerH * (1 - t),
        label: formatValue(max * t)
    }));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
            {/* Grid lines */}
            {ticks.map((t, i) => (
                <g key={i}>
                    <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
                        stroke="#e5e5e5" strokeWidth="1" strokeDasharray="4 3" />
                    <text x={PAD.left - 6} y={t.y + 4} textAnchor="end"
                        fontSize="10" fill="#a0a0a0">{t.label}</text>
                </g>
            ))}

            {/* Bars */}
            {data.map((d, i) => {
                const barH = Math.max((d[valueKey] / max) * innerH, 2);
                const x = PAD.left + gap * i + gap / 2 - barW / 2;
                const y = PAD.top + innerH - barH;
                return (
                    <g key={i}>
                        <rect x={x} y={y} width={barW} height={barH}
                            rx="2" fill={color} />
                        {/* Label */}
                        <text x={x + barW / 2} y={H - PAD.bottom + 14}
                            textAnchor="middle" fontSize="10" fill="#4a4a4a">
                            {fmtMes(d[labelKey])}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color }) {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
            <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                <Icon size={20} />
            </div>
            <p className="text-2xl font-bold text-black leading-none break-all">{value}</p>
            {sub && <p className="mt-1 text-xs text-neutral-500">{sub}</p>}
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">{label}</p>
        </div>
    );
}

// ── Month Table ───────────────────────────────────────────────────────────────
function MonthTable({ meses }) {
    if (!meses.length) return null;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left">
                        <th className="pb-2 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Mês</th>
                        <th className="pb-2 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] text-right">Pedidos</th>
                        <th className="pb-2 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] text-right">Valor Total</th>
                        <th className="pb-2 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] text-right">Sucesso</th>
                        <th className="pb-2 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] text-right">Erro</th>
                    </tr>
                </thead>
                <tbody>
                    {[...meses].reverse().map((m) => (
                        <tr key={m.mes} className="border-b border-neutral-200 hover:bg-neutral-50 transition-colors">
                            <td className="py-2.5 font-bold text-black">{fmtMes(m.mes)}</td>
                            <td className="py-2.5 text-right text-neutral-600 font-medium">{m.pedidos}</td>
                            <td className="py-2.5 text-right text-green-600 font-bold">{BRL(m.valor)}</td>
                            <td className="py-2.5 text-right text-green-600 font-medium">{m.ok}</td>
                            <td className="py-2.5 text-right text-danger font-medium">{m.erro}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const token = localStorage.getItem('token');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/orders/stats`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(`Erro ${res.status}`);
                setStats(await res.json());
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    if (loading) return (
        <div className="max-w-5xl mx-auto space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-white animate-pulse border border-neutral-200" />)}
        </div>
    );

    if (error) return (
        <div className="max-w-5xl mx-auto p-4 rounded-xl bg-red-50 border border-red-200 text-danger text-sm font-semibold flex gap-2 items-center">
            <AlertCircle size={18} /> Erro ao carregar dashboard: {error}
        </div>
    );

    const { meses = [], totalGeral = 0, totalPedidos = 0 } = stats || {};
    const totalOk = meses.reduce((s, m) => s + m.ok, 0);
    const taxaSucesso = totalPedidos > 0 ? Math.round((totalOk / totalPedidos) * 100) : 0;

    const hasMeses = meses.length > 0;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="font-display text-2xl text-black">Dashboard</h1>
                <p className="text-sm text-neutral-500 mt-0.5">Visão geral dos pedidos enviados.</p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={ShoppingCart} label="Total de Pedidos" value={totalPedidos}
                    sub="todos os meses" color="bg-primary/15 text-primary-dark" />
                <KpiCard icon={DollarSign} label="Valor Total" value={BRL(totalGeral)}
                    sub="soma de todos os pedidos" color="bg-green-100 text-green-600" />
                <KpiCard icon={CheckCircle} label="Taxa de Sucesso" value={`${taxaSucesso}%`}
                    sub={`${totalOk} de ${totalPedidos} com sucesso`} color="bg-violet-100 text-violet-600" />
                <KpiCard icon={TrendingUp} label="Meses Ativos" value={meses.length}
                    sub="meses com pedidos" color="bg-amber-100 text-amber-600" />
            </div>

            {hasMeses ? (
                <>
                    {/* Charts row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Pedidos por mês */}
                        <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
                            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] mb-4">Pedidos por Mês</p>
                            <div className="h-44">
                                <BarChart data={meses} valueKey="pedidos" labelKey="mes"
                                    formatValue={v => Math.round(v)} color="#F5C400" />
                            </div>
                        </div>

                        {/* Valor por mês */}
                        <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
                            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] mb-4">Valor por Mês (R$)</p>
                            <div className="h-44">
                                <BarChart data={meses} valueKey="valor" labelKey="mes"
                                    formatValue={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : Math.round(v)}
                                    color="#22c55e" />
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
                        <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em] mb-4">Resumo por Mês</p>
                        <MonthTable meses={meses} />
                    </div>
                </>
            ) : (
                <div className="text-center py-20 text-neutral-400">
                    <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Nenhum pedido registrado ainda.<br />Os dados aparecerão aqui após o primeiro checkout.</p>
                </div>
            )}
        </div>
    );
}
