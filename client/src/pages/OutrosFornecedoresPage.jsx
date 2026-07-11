import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Lock, PackageSearch, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchEstoqueVPMap, juntarEstoque } from '../lib/estoqueVP';

const SUPABASE_URL = 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3ZsY3NreG9wcnlxdmhvZnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc0NjIsImV4cCI6MjA5MDM2MzQ2Mn0.Hzl6k-TM_U1Ae8cNUPtz8MFBbZ4EVF3EGOhvgV7xnqk';

const moeda = valor => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
const numero = valor => Number(valor || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// Produto vem do catálogo omie_produtos; o SALDO vem da tabela estoque_vp
// (fonte correta) — o estoque_atual do catálogo é furado e distorceria o split.
async function buscarProdutoVP(codigo) {
    const query = `${SUPABASE_URL}/rest/v1/omie_produtos?select=codigo_produto,codigo,descricao,unidade,valor_unitario&ativo=eq.true&codigo=eq.${encodeURIComponent(codigo)}&limit=1`;
    const [resp, mapaEstoque] = await Promise.all([
        fetch(query, {
            headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${SUPABASE_ANON}`,
            },
        }),
        fetchEstoqueVPMap(),
    ]);
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    const rows = await resp.json();
    if (!rows[0]) return null;
    return juntarEstoque(rows, mapaEstoque)[0];
}

function Field({ label, children }) {
    return (
        <label className="space-y-1">
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">{label}</span>
            {children}
        </label>
    );
}

export default function OutrosFornecedoresPage({
    addToCart,
    finalidade,
    setFinalidade,
    validacaoCarrinho,
    setValidacaoCarrinho,
    onOpenCart,
}) {
    const { filial } = useAuth();
    const [form, setForm] = useState({
        codigoVP: '',
        codigoFornecedor: '',
        fornecedor: '',
        descricao: '',
        quantidade: '1',
        precoConcorrente: '',
    });
    const [produtoVP, setProdutoVP] = useState(null);
    const [loading, setLoading] = useState(false);
    const [validando, setValidando] = useState(false);
    const [erro, setErro] = useState('');
    const [erroValidacao, setErroValidacao] = useState('');
    const [numeroValidacao, setNumeroValidacao] = useState('');
    const [fornecedorCart, setFornecedorCart] = useState([]);

    const quantidadeDesejada = Number(form.quantidade || 0);
    const precoConcorrente = Number(form.precoConcorrente || 0);
    const estoqueVP = Number(produtoVP?.estoque_disponivel || 0);
    const precoVP = Number(produtoVP?.valor_unitario || 0);
    const quantidadeVP = produtoVP ? Math.min(Math.max(estoqueVP, 0), Math.max(quantidadeDesejada, 0)) : 0;
    const quantidadeFornecedor = produtoVP ? Math.max(quantidadeDesejada - quantidadeVP, 0) : 0;
    const diferencaUnit = precoConcorrente - precoVP;
    const totalItemFornecedor = quantidadeFornecedor * precoConcorrente;

    const totalFornecedor = fornecedorCart.reduce((sum, item) => sum + (item.quantidadeFornecedor * item.precoConcorrente), 0);
    const limiteRevenda = validacaoCarrinho?.tipo === 'pedido-venda' ? Number(validacaoCarrinho.limiteCompra70 || 0) : 0;
    const excedeLimiteRevenda = validacaoCarrinho?.tipo === 'pedido-venda' && limiteRevenda > 0 && totalFornecedor > limiteRevenda;
    const totalFornecedorAposSplit = totalFornecedor + totalItemFornecedor;
    const splitExcedeLimiteRevenda = validacaoCarrinho?.tipo === 'pedido-venda'
        && limiteRevenda > 0
        && quantidadeFornecedor > 0
        && totalFornecedorAposSplit > limiteRevenda;
    const podeOperar = validacaoCarrinho?.validado;

    const setValue = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

    const handleBuscar = async () => {
        setLoading(true);
        setErro('');
        setProdutoVP(null);
        try {
            const codigo = form.codigoVP.trim();
            if (!codigo) throw new Error('Informe o Código VerticalParts.');
            const produto = await buscarProdutoVP(codigo);
            if (!produto) throw new Error('Produto VerticalParts não encontrado no catálogo ativo.');
            setProdutoVP(produto);
            setForm(prev => ({ ...prev, descricao: prev.descricao || produto.descricao }));
        } catch (e) {
            setErro(e.message || 'Erro ao consultar produto.');
        } finally {
            setLoading(false);
        }
    };

    const handleValidarCarrinho = async () => {
        setErroValidacao('');
        setValidando(true);
        try {
            const numero = numeroValidacao.trim();
            if (!numero) {
                throw new Error(finalidade === 'Atendimento a Contrato'
                    ? 'Informe o número do contrato.'
                    : 'Informe o número do pedido de venda.');
            }

            const endpoint = finalidade === 'Atendimento a Contrato' ? 'contrato' : 'pedido-venda';
            const token = localStorage.getItem('token');
            const resp = await fetch(`/api/omie/${endpoint}?numero=${encodeURIComponent(numero)}&unidade=${encodeURIComponent(filial?.id || '')}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(data.error || 'Não foi possível validar no Omie.');
            }

            setValidacaoCarrinho({
                tipo: finalidade === 'Atendimento a Contrato' ? 'contrato' : 'pedido-venda',
                numero: data.numero || numero,
                vendedor: data.vendedor || '',
                valorTotal: data.valorTotal || 0,
                limiteCompra70: data.limiteCompra70 || 0,
                tagValida: data.tagValida || '',
                tags: data.tags || [],
                validado: true,
            });
        } catch (e) {
            setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
            setErroValidacao(e.message || 'Erro ao validar carrinho.');
        } finally {
            setValidando(false);
        }
    };

    const handleAdicionar = () => {
        if (!podeOperar || !produtoVP || quantidadeDesejada <= 0) return;
        if (splitExcedeLimiteRevenda) {
            setErro('Compra bloqueada: os itens direcionados ao concorrente excedem o limite de 70% da proposta Omie.');
            return;
        }

        if (quantidadeVP > 0 && addToCart) {
            addToCart({
                codigo: produtoVP.codigo,
                descricao: produtoVP.descricao,
                unidade: produtoVP.unidade,
                preco: produtoVP.valor_unitario,
                preco_original: produtoVP.valor_unitario,
                estoque: produtoVP.estoque_disponivel,
                quantity: quantidadeVP,
            });
        }

        if (quantidadeFornecedor > 0) {
            setFornecedorCart(prev => [
                ...prev,
                {
                    id: `${Date.now()}-${produtoVP.codigo}`,
                    fornecedor: form.fornecedor || 'Fornecedor externo',
                    codigoVP: produtoVP.codigo,
                    codigoFornecedor: form.codigoFornecedor,
                    descricao: form.descricao || produtoVP.descricao,
                    unidade: produtoVP.unidade,
                    quantidadeDesejada,
                    quantidadeVP,
                    quantidadeFornecedor,
                    precoVP,
                    precoConcorrente,
                    diferencaUnit,
                },
            ]);
        }
    };

    const validacaoTexto = useMemo(() => {
        if (!validacaoCarrinho?.validado) return 'Informe o Pedido de Venda ou Contrato válido para liberar o split.';
        if (validacaoCarrinho.tipo === 'contrato') return `Contrato ${validacaoCarrinho.numero} validado. Teto de 70% desativado.`;
        return `Pedido ${validacaoCarrinho.numero} validado. Proposta: ${moeda(validacaoCarrinho.valorTotal)}. Limite concorrente: ${moeda(limiteRevenda)}.`;
    }, [validacaoCarrinho, limiteRevenda]);

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Multi-Vendor</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">
                        Outros Fornecedores
                    </h1>
                    <p className="mt-1 text-xs text-neutral-500">
                        Split por saldo VerticalParts e compra externa isolada por fornecedor.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onOpenCart}
                    className="inline-flex items-center gap-2 rounded-xl border border-primary bg-primary/10 px-4 py-2 text-sm font-bold text-primary-dark shadow-card transition hover:bg-primary/20"
                >
                    <ShoppingCart className="h-4 w-4" />
                    Carrinho VerticalParts
                </button>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${podeOperar ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="mb-3 grid grid-cols-2 gap-2">
                    {[
                        { value: 'Revenda', label: 'Revenda' },
                        { value: 'Atendimento a Contrato', label: 'Atendimento a Contrato' },
                    ].map(option => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                                setFinalidade(option.value);
                                setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
                                setNumeroValidacao('');
                                setErroValidacao('');
                            }}
                            className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                                finalidade === option.value
                                    ? 'border-primary bg-primary/20 text-black'
                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    {podeOperar ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Lock className="h-4 w-4 text-amber-600" />}
                    <p className={`text-sm font-bold ${podeOperar ? 'text-green-800' : 'text-amber-800'}`}>{validacaoTexto}</p>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                        className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                        value={numeroValidacao}
                        onChange={e => setNumeroValidacao(e.target.value)}
                        placeholder={finalidade === 'Atendimento a Contrato' ? 'Número do Contrato' : 'Número da Proposta/Pedido'}
                    />
                    <button
                        type="button"
                        onClick={handleValidarCarrinho}
                        disabled={validando}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-neutral-700 disabled:opacity-50"
                    >
                        {validando ? 'Validando...' : 'Validar Omie'}
                    </button>
                </div>
                {erroValidacao && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                        <AlertTriangle className="h-4 w-4" />
                        {erroValidacao}
                    </div>
                )}
            </div>

            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <div className="grid gap-3 lg:grid-cols-6">
                    <Field label="Código VerticalParts">
                        <input className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.codigoVP} onChange={e => setValue('codigoVP', e.target.value)} placeholder="Ex.: VPEL-150" />
                    </Field>
                    <Field label="Código Fornecedor">
                        <input className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.codigoFornecedor} onChange={e => setValue('codigoFornecedor', e.target.value)} placeholder="SKU externo" />
                    </Field>
                    <Field label="Fornecedor">
                        <input className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.fornecedor} onChange={e => setValue('fornecedor', e.target.value)} placeholder="Nome do fornecedor" />
                    </Field>
                    <Field label="Quantidade Desejada">
                        <input type="number" min="0" step="0.001" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.quantidade} onChange={e => setValue('quantidade', e.target.value)} />
                    </Field>
                    <Field label="Preço Concorrente">
                        <input type="number" min="0" step="0.01" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.precoConcorrente} onChange={e => setValue('precoConcorrente', e.target.value)} placeholder="0,00" />
                    </Field>
                    <div className="flex items-end">
                        <button type="button" onClick={handleBuscar} disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-black transition hover:bg-primary-light disabled:opacity-50">
                            <PackageSearch className="h-4 w-4" />
                            {loading ? 'Consultando...' : 'Consultar'}
                        </button>
                    </div>
                </div>
                <div className="mt-3">
                    <Field label="Campo do Produto">
                        <input className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary" value={form.descricao} onChange={e => setValue('descricao', e.target.value)} placeholder="Descrição do produto" />
                    </Field>
                </div>
                {erro && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                        <AlertTriangle className="h-4 w-4" />
                        {erro}
                    </div>
                )}
            </section>

            {produtoVP && (
                <section className="grid gap-3 lg:grid-cols-4">
                    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                        <p className="text-xs text-neutral-400">Estoque VerticalParts</p>
                        <p className="mt-1 text-2xl font-bold text-neutral-900">{numero(estoqueVP)} {produtoVP.unidade}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                        <p className="text-xs text-neutral-400">Split VerticalParts</p>
                        <p className="mt-1 text-2xl font-bold text-green-700">{numero(quantidadeVP)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                        <p className="text-xs text-neutral-400">Liberado Concorrente</p>
                        <p className="mt-1 text-2xl font-bold text-primary-dark">{numero(quantidadeFornecedor)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                        <p className="text-xs text-neutral-400">Diferença Unitária</p>
                        <p className={`mt-1 text-2xl font-bold ${diferencaUnit > 0 ? 'text-red-600' : 'text-green-700'}`}>{moeda(diferencaUnit)}</p>
                    </div>
                </section>
            )}

            {produtoVP && (
                <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                    <div className="mb-3 flex items-center gap-2">
                        <ArrowRightLeft className="h-4 w-4 text-primary-dark" />
                        <h2 className="text-sm font-bold text-neutral-900">Comparativo de Preço</h2>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <p className="text-xs text-neutral-400">Preço VerticalParts</p>
                            <p className="text-lg font-bold text-neutral-900">{moeda(precoVP)}</p>
                        </div>
                        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <p className="text-xs text-neutral-400">Preço Concorrente</p>
                            <p className="text-lg font-bold text-neutral-900">{moeda(precoConcorrente)}</p>
                        </div>
                        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <p className="text-xs text-neutral-400">Diferença Total Concorrente</p>
                            <p className={`text-lg font-bold ${diferencaUnit > 0 ? 'text-red-600' : 'text-green-700'}`}>{moeda(diferencaUnit * quantidadeFornecedor)}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleAdicionar}
                        disabled={!podeOperar || quantidadeDesejada <= 0 || (!quantidadeVP && !quantidadeFornecedor) || splitExcedeLimiteRevenda}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black transition hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                    >
                        <Plus className="h-4 w-4" />
                        Aplicar Split nos Carrinhos
                    </button>
                    {splitExcedeLimiteRevenda && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                            Compra bloqueada: este split levaria os itens de concorrentes para {moeda(totalFornecedorAposSplit)}, acima do limite de 70% ({moeda(limiteRevenda)}).
                        </div>
                    )}
                </section>
            )}

            <section className="rounded-xl border border-neutral-200 bg-white shadow-card">
                <div className="border-b border-neutral-100 px-4 py-3">
                    <h2 className="text-sm font-bold text-neutral-900">Carrinhos de Terceiros por Fornecedor</h2>
                </div>
                {fornecedorCart.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-neutral-400">Nenhum item externo liberado ainda.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                                <tr>
                                    <th className="px-4 py-3 text-left">Fornecedor</th>
                                    <th className="px-4 py-3 text-left">Código VP</th>
                                    <th className="px-4 py-3 text-left">Código Fornecedor</th>
                                    <th className="px-4 py-3 text-left">Produto</th>
                                    <th className="px-4 py-3 text-right">Qtd. Terceiro</th>
                                    <th className="px-4 py-3 text-right">Preço</th>
                                    <th className="px-4 py-3 text-right">Total</th>
                                    <th className="px-4 py-3 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                                {fornecedorCart.map(item => (
                                    <tr key={item.id}>
                                        <td className="px-4 py-3 font-semibold">{item.fornecedor}</td>
                                        <td className="px-4 py-3 font-mono text-xs">{item.codigoVP}</td>
                                        <td className="px-4 py-3 font-mono text-xs">{item.codigoFornecedor || '-'}</td>
                                        <td className="px-4 py-3">{item.descricao}</td>
                                        <td className="px-4 py-3 text-right">{numero(item.quantidadeFornecedor)}</td>
                                        <td className="px-4 py-3 text-right">{moeda(item.precoConcorrente)}</td>
                                        <td className="px-4 py-3 text-right font-bold">{moeda(item.quantidadeFornecedor * item.precoConcorrente)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button type="button" onClick={() => setFornecedorCart(prev => prev.filter(row => row.id !== item.id))} className="text-neutral-400 hover:text-danger">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">Total Concorrentes</span>
                    <span className="text-lg font-bold text-neutral-900">{moeda(totalFornecedor)}</span>
                </div>
                {excedeLimiteRevenda && (
                    <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                        Compra bloqueada: os itens direcionados ao concorrente excedem o limite de 70% da proposta Omie.
                    </div>
                )}
            </section>
        </div>
    );
}
