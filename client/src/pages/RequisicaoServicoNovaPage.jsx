import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, AlertTriangle, Loader2, Save, Send, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
    meuPerfilServicos, listarBranchesServicos, listarLpu,
    criarRequisicao, enviarRequisicao,
} from '../lib/servicos';
import { moeda } from '../lib/statusServicos';

function rawDigits(v) {
    return String(v || '').replace(/\D/g, '');
}

// Consulta pública de CNPJ (BrasilAPI) — mesma fonte usada no restante do
// portal para preencher razão social a partir do CNPJ informado.
async function consultarCnpj(cnpj) {
    const digits = rawDigits(cnpj);
    if (digits.length !== 14) return null;
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.razao_social || data.nome_fantasia || null;
}

function CnpjField({ label, cnpj, setCnpj, name, setName, obrigatorioNome }) {
    const [consultando, setConsultando] = useState(false);

    const handleConsultar = async () => {
        setConsultando(true);
        try {
            const nome = await consultarCnpj(cnpj);
            if (nome) setName(nome);
        } finally {
            setConsultando(false);
        }
    };

    return (
        <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">{label} — CNPJ/CPF</span>
                <div className="flex gap-2">
                    <input
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        value={cnpj}
                        onChange={e => setCnpj(e.target.value)}
                        placeholder="00.000.000/0000-00"
                    />
                    <button
                        type="button"
                        onClick={handleConsultar}
                        disabled={consultando || rawDigits(cnpj).length !== 14}
                        className="shrink-0 rounded-lg border border-neutral-200 px-3 text-neutral-600 hover:border-primary hover:text-primary disabled:opacity-40"
                        title="Consultar CNPJ"
                    >
                        {consultando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </button>
                </div>
            </label>
            <label className="space-y-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">
                    Razão Social {obrigatorioNome && <span className="text-danger">*</span>}
                </span>
                <input
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Preenchido automaticamente ou digite"
                />
            </label>
        </div>
    );
}

export default function RequisicaoServicoNovaPage() {
    const navigate = useNavigate();
    const { user } = useAuth();

    const [perfil, setPerfil] = useState(null);
    const [branches, setBranches] = useState([]);
    const [lpuItems, setLpuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState('');
    const [salvando, setSalvando] = useState(false);

    const [title, setTitle] = useState('');
    const [branchId, setBranchId] = useState('');
    const [justification, setJustification] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);
    const [clientCnpj, setClientCnpj] = useState('');
    const [clientName, setClientName] = useState('');
    const [supplierCnpj, setSupplierCnpj] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [entryPercent, setEntryPercent] = useState('0');
    const [balanceTerm, setBalanceTerm] = useState('ao_termino');
    const [serviceStartDate, setServiceStartDate] = useState('');
    const [itens, setItens] = useState([]);

    const [novoItem, setNovoItem] = useState({ lpu_id: '', description: '', quantity: '1', unit_price: '0', is_manual: true });

    const carregar = useCallback(async () => {
        setLoading(true);
        setErro('');
        try {
            const [p, b, l] = await Promise.all([meuPerfilServicos(), listarBranchesServicos(), listarLpu()]);
            setPerfil(p);
            setBranches(b);
            setLpuItems(l.filter(item => item.active));
            if (p.branch_id) setBranchId(p.branch_id);
        } catch (e) {
            setErro(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const selecionarLpu = (lpuId) => {
        const item = lpuItems.find(l => l.id === lpuId);
        if (item) {
            setNovoItem({ lpu_id: item.id, description: item.description, quantity: '1', unit_price: String(item.unit_price), is_manual: false });
        } else {
            setNovoItem({ lpu_id: '', description: '', quantity: '1', unit_price: '0', is_manual: true });
        }
    };

    const adicionarItemLocal = () => {
        if (!novoItem.description.trim() || Number(novoItem.quantity) <= 0) return;
        setItens(prev => [...prev, { ...novoItem, _key: Date.now() }]);
        setNovoItem({ lpu_id: '', description: '', quantity: '1', unit_price: '0', is_manual: true });
    };

    const removerItemLocal = (key) => setItens(prev => prev.filter(i => i._key !== key));

    const totalItens = itens.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);

    const salvar = async (enviar) => {
        setErro('');
        if (!title.trim()) { setErro('Informe o título da requisição.'); return; }
        if (!branchId) { setErro('Selecione a filial.'); return; }
        if (itens.length === 0) { setErro('Adicione ao menos um item/serviço.'); return; }

        setSalvando(true);
        try {
            const solicitation = await criarRequisicao({
                title: title.trim(),
                branch_id: branchId,
                justification: justification || null,
                is_urgent: isUrgent,
                clientCnpj, clientName,
                supplierCnpj, supplierName,
                entry_percent: Number(entryPercent || 0),
                balance_term: balanceTerm,
                service_start_date: serviceStartDate || null,
                itens: itens.map(i => ({
                    lpu_id: i.lpu_id || null,
                    description: i.description,
                    quantity: Number(i.quantity),
                    unit_price: Number(i.unit_price),
                    is_manual: i.is_manual,
                })),
            });

            if (enviar) {
                await enviarRequisicao(solicitation.id);
            }
            navigate(`/requisicao-servicos/${solicitation.id}`);
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvando(false);
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-sm text-neutral-400">Carregando...</div>;
    }

    if (perfil && perfil.role !== 'gerente_filial' && perfil.role !== 'admin') {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                Apenas gerente de filial (ou admin) pode abrir uma Requisição de Serviço.
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <div>
                <p className="vp-eyebrow">Serviços</p>
                <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">Nova Requisição de Serviço</h1>
                <p className="mt-1 text-xs text-neutral-500">
                    Ao enviar, a requisição fica suspensa aguardando o aval do CEO da VerticalParts antes de seguir para análise comercial e financeira.
                </p>
            </div>

            {erro && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {erro}
                </div>
            )}

            <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="text-sm font-bold text-neutral-900">Dados Gerais</h2>
                <label className="block space-y-1">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Título</span>
                    <input className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Manutenção elétrica — Cliente X" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Filial</span>
                        <select className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary" value={branchId} onChange={e => setBranchId(e.target.value)}>
                            <option value="">Selecione...</option>
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </label>
                    <label className="flex items-end gap-2 pb-2">
                        <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
                        <span className="text-sm font-medium text-neutral-700">Marcar como urgente</span>
                    </label>
                </div>
                <label className="block space-y-1">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Justificativa</span>
                    <textarea className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" rows={3} value={justification} onChange={e => setJustification(e.target.value)} />
                </label>
            </section>

            <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="text-sm font-bold text-neutral-900">Cliente e Fornecedor</h2>
                <CnpjField label="Cliente" cnpj={clientCnpj} setCnpj={setClientCnpj} name={clientName} setName={setClientName} />
                <CnpjField label="Fornecedor (terceirizado)" cnpj={supplierCnpj} setCnpj={setSupplierCnpj} name={supplierName} setName={setSupplierName} obrigatorioNome />
            </section>

            <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="text-sm font-bold text-neutral-900">Itens / Serviços</h2>
                <div className="grid gap-2 sm:grid-cols-5">
                    <select
                        className="sm:col-span-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                        value={novoItem.lpu_id}
                        onChange={e => selecionarLpu(e.target.value)}
                    >
                        <option value="">Item manual (fora do LPU)</option>
                        {lpuItems.map(l => <option key={l.id} value={l.id}>{l.code} — {l.description}</option>)}
                    </select>
                    <input
                        className="sm:col-span-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="Descrição"
                        value={novoItem.description}
                        onChange={e => setNovoItem(prev => ({ ...prev, description: e.target.value }))}
                        disabled={Boolean(novoItem.lpu_id)}
                    />
                    <div className="flex gap-1">
                        <input type="number" min="0.01" step="0.01" className="w-1/2 rounded-lg border border-neutral-200 px-2 py-2 text-sm outline-none focus:border-primary" placeholder="Qtd" value={novoItem.quantity} onChange={e => setNovoItem(prev => ({ ...prev, quantity: e.target.value }))} />
                        <input type="number" min="0" step="0.01" className="w-1/2 rounded-lg border border-neutral-200 px-2 py-2 text-sm outline-none focus:border-primary" placeholder="Preço" value={novoItem.unit_price} onChange={e => setNovoItem(prev => ({ ...prev, unit_price: e.target.value }))} disabled={Boolean(novoItem.lpu_id)} />
                    </div>
                </div>
                <button type="button" onClick={adicionarItemLocal} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:bg-primary-light">
                    <Plus className="h-3.5 w-3.5" /> Adicionar item
                </button>

                {itens.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-neutral-100">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">Descrição</th>
                                    <th className="px-3 py-2 text-right">Qtd</th>
                                    <th className="px-3 py-2 text-right">Preço Un.</th>
                                    <th className="px-3 py-2 text-right">Total</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                                {itens.map(i => (
                                    <tr key={i._key}>
                                        <td className="px-3 py-2">{i.description}</td>
                                        <td className="px-3 py-2 text-right">{i.quantity}</td>
                                        <td className="px-3 py-2 text-right">{moeda(i.unit_price)}</td>
                                        <td className="px-3 py-2 text-right font-bold">{moeda(Number(i.quantity) * Number(i.unit_price))}</td>
                                        <td className="px-3 py-2 text-right">
                                            <button type="button" onClick={() => removerItemLocal(i._key)} className="text-neutral-400 hover:text-danger">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between border-t border-neutral-100 bg-neutral-50 px-3 py-2 text-sm font-bold">
                            <span>Total estimado</span>
                            <span>{moeda(totalItens)}</span>
                        </div>
                    </div>
                )}
            </section>

            <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="text-sm font-bold text-neutral-900">Condição de Pagamento</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Entrada (%)</span>
                        <input type="number" min="0" max="100" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={entryPercent} onChange={e => setEntryPercent(e.target.value)} />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Prazo do Saldo</span>
                        <select className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary" value={balanceTerm} onChange={e => setBalanceTerm(e.target.value)}>
                            <option value="ao_termino">Ao término do serviço</option>
                            <option value="30_dias">30 dias</option>
                            <option value="60_dias">60 dias</option>
                            <option value="90_dias">90 dias</option>
                        </select>
                    </label>
                </div>
                <label className="block space-y-1">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Data prevista de início do serviço</span>
                    <input type="date" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary sm:w-64" value={serviceStartDate} onChange={e => setServiceStartDate(e.target.value)} />
                </label>
            </section>

            <div className="flex justify-end gap-3">
                <button
                    type="button"
                    onClick={() => salvar(false)}
                    disabled={salvando}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-neutral-700 shadow-card transition hover:border-primary hover:text-primary disabled:opacity-50"
                >
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar Rascunho
                </button>
                <button
                    type="button"
                    onClick={() => salvar(true)}
                    disabled={salvando}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black shadow-card transition hover:bg-primary-light disabled:opacity-50"
                >
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar para Aval do CEO
                </button>
            </div>
        </div>
    );
}
