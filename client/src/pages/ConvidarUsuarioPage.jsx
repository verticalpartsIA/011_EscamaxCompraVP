import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Mail, Building2, ShieldCheck, Send, Loader2, CheckCircle2, AlertTriangle, Users } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const ALCADAS = [
    { valor: '', label: 'Sem alçada' },
    { valor: '1', label: 'Nível 1 — até R$3.000,00' },
    { valor: '2', label: 'Nível 2 — R$3.000,01 a R$5.000,00' },
    { valor: '3', label: 'Nível 3 — acima de R$5.000,00' },
];

export default function ConvidarUsuarioPage() {
    const token = localStorage.getItem('token');
    const [usuarios, setUsuarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState({ email: '', nome: '', empresa: 'escamax', isAdmin: false, alcadaNivel: '' });
    const [enviando, setEnviando] = useState(false);
    const [msg, setMsg] = useState(null);
    const [erro, setErro] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/usuarios`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) setUsuarios(await res.json());
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { carregar(); }, [carregar]);

    const dominioEsperado = form.empresa === 'escamax' ? '@escamax.com.br' : '@verticalparts.com.br';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErro('');
        setMsg(null);
        setEnviando(true);
        try {
            const res = await fetch(`${API_BASE}/api/usuarios/convidar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    email: form.email,
                    nome: form.nome,
                    empresa: form.empresa,
                    isAdmin: form.isAdmin,
                    alcadaNivel: form.alcadaNivel || null,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
            setMsg(data.conviteEnviado
                ? `Convite enviado por e-mail para ${form.email}.`
                : `${form.email} já tinha conta — perfil atualizado, sem novo e-mail de convite.`);
            setForm({ email: '', nome: '', empresa: 'escamax', isAdmin: false, alcadaNivel: '' });
            await carregar();
        } catch (err) {
            setErro(err.message);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <div>
                <p className="vp-eyebrow">Governança B2B</p>
                <h1 className="font-display text-2xl font-bold text-black">Convidar Usuário</h1>
                <p className="mt-1 text-sm text-neutral-500">
                    Só e-mails @escamax.com.br ou @verticalparts.com.br podem ser convidados.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-card sm:grid-cols-2">
                <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Empresa</label>
                    <select
                        value={form.empresa}
                        onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    >
                        <option value="escamax">Escamax</option>
                        <option value="verticalparts">VerticalParts</option>
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Nome</label>
                    <input
                        value={form.nome}
                        onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                        required
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                </div>
                <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                        E-mail (precisa terminar em {dominioEsperado})
                    </label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="email"
                            value={form.email}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                            placeholder={`nome${dominioEsperado}`}
                            required
                            className="w-full rounded-lg border border-neutral-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
                        />
                    </div>
                </div>
                <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Alçada de aprovação</label>
                    <select
                        value={form.alcadaNivel}
                        onChange={e => setForm(f => ({ ...f, alcadaNivel: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    >
                        {ALCADAS.map(a => <option key={a.valor} value={a.valor}>{a.label}</option>)}
                    </select>
                </div>
                <div className="flex items-end">
                    <label className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700">
                        <input
                            type="checkbox"
                            checked={form.isAdmin}
                            onChange={e => setForm(f => ({ ...f, isAdmin: e.target.checked }))}
                        />
                        <ShieldCheck className="h-4 w-4 text-primary-dark" />
                        Administrador (acessa Logs e Convidar Usuário)
                    </label>
                </div>

                {erro && (
                    <div className="sm:col-span-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {erro}
                    </div>
                )}
                {msg && (
                    <div className="sm:col-span-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        {msg}
                    </div>
                )}

                <div className="sm:col-span-2">
                    <button
                        type="submit"
                        disabled={enviando}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black transition hover:bg-primary-light disabled:opacity-50"
                    >
                        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Enviar Convite
                    </button>
                </div>
            </form>

            <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                    <Users className="h-4 w-4 text-neutral-400" />
                    <h2 className="text-sm font-bold text-black">Usuários cadastrados</h2>
                </div>
                {loading ? (
                    <div className="p-5 text-sm text-neutral-400">Carregando...</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <th className="px-5 py-2 text-left">Nome</th>
                                <th className="px-5 py-2 text-left">E-mail</th>
                                <th className="px-5 py-2 text-left">Empresa</th>
                                <th className="px-5 py-2 text-center">Admin</th>
                                <th className="px-5 py-2 text-center">Alçada</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-50">
                            {usuarios.map(u => (
                                <tr key={u.id}>
                                    <td className="px-5 py-2 font-semibold text-neutral-800">{u.nome}</td>
                                    <td className="px-5 py-2 text-neutral-600">{u.email}</td>
                                    <td className="px-5 py-2 text-neutral-500 capitalize">{u.empresa}</td>
                                    <td className="px-5 py-2 text-center">{u.is_admin ? <ShieldCheck className="mx-auto h-4 w-4 text-primary-dark" /> : '—'}</td>
                                    <td className="px-5 py-2 text-center">{u.alcada_nivel ? `Nível ${u.alcada_nivel}` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
