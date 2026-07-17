import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, AlertTriangle, Power } from 'lucide-react';
import { listarLpu, criarLpu, atualizarLpu } from '../lib/servicos';
import { moeda } from '../lib/statusServicos';

export default function ServicoLpuPage() {
    const [itens, setItens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState('');
    const [novo, setNovo] = useState({ code: '', description: '', unit: 'un', unit_price: '' });
    const [salvando, setSalvando] = useState(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        setErro('');
        try {
            setItens(await listarLpu());
        } catch (e) {
            setErro(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const handleCriar = async () => {
        if (!novo.code.trim() || !novo.description.trim()) return;
        const preco = Number(novo.unit_price);
        if (!Number.isFinite(preco) || preco <= 0) {
            setErro('Informe um preço unitário maior que zero.');
            return;
        }
        setSalvando(true);
        setErro('');
        try {
            await criarLpu({ ...novo, unit_price: preco });
            setNovo({ code: '', description: '', unit: 'un', unit_price: '' });
            await carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvando(false);
        }
    };

    const toggleAtivo = async (item) => {
        try {
            await atualizarLpu(item.id, { active: !item.active });
            await carregar();
        } catch (e) {
            setErro(e.message);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Serviços · Administração</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">Tabela de Preços (LPU)</h1>
                    <p className="mt-1 text-xs text-neutral-500">
                        Cadastro dos itens e preços que ficam disponíveis para escolha ao montar uma Requisição de Serviço.
                        Esta tela não abre requisições — para isso, use <strong>Requisição Serviços → Nova Requisição</strong>.
                    </p>
                </div>
                <Link
                    to="/requisicao-servicos/nova"
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
                >
                    Criar Requisição usando a LPU →
                </Link>
            </div>

            {erro && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {erro}
                </div>
            )}

            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="mb-3 text-sm font-bold text-neutral-900">Novo item</h2>
                <div className="grid gap-2 sm:grid-cols-5">
                    <input className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Código" value={novo.code} onChange={e => setNovo(p => ({ ...p, code: e.target.value }))} />
                    <input className="sm:col-span-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Descrição" value={novo.description} onChange={e => setNovo(p => ({ ...p, description: e.target.value }))} />
                    <input className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Unidade" value={novo.unit} onChange={e => setNovo(p => ({ ...p, unit: e.target.value }))} />
                    <input type="number" step="0.01" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Preço" value={novo.unit_price} onChange={e => setNovo(p => ({ ...p, unit_price: e.target.value }))} />
                </div>
                <button
                    onClick={handleCriar}
                    disabled={salvando}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:bg-primary-light disabled:opacity-50"
                >
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
            </section>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
                {loading ? (
                    <div className="flex items-center justify-center gap-3 py-16 text-neutral-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Carregando...</span>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-4 py-3 text-left">Código</th>
                                <th className="px-4 py-3 text-left">Descrição</th>
                                <th className="px-4 py-3 text-left">Un.</th>
                                <th className="px-4 py-3 text-right">Preço</th>
                                <th className="px-4 py-3 text-center">Ativo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-50">
                            {itens.map(item => (
                                <tr key={item.id} className={!item.active ? 'opacity-50' : ''}>
                                    <td className="px-4 py-3 font-mono text-xs">{item.code}</td>
                                    <td className="px-4 py-3">{item.description}</td>
                                    <td className="px-4 py-3">{item.unit}</td>
                                    <td className="px-4 py-3 text-right">{moeda(item.unit_price)}</td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => toggleAtivo(item)} title={item.active ? 'Desativar' : 'Ativar'}>
                                            <Power className={`h-4 w-4 ${item.active ? 'text-green-600' : 'text-neutral-300'}`} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
