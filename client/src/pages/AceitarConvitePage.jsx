import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ArrowRight, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Página de destino do link de convite/redefinição enviado por e-mail.
//
// Importante: o link do e-mail aponta para ESTA página (não para o endpoint
// /auth/v1/verify do Supabase) e leva token_hash+type na query string. A
// troca do token pela sessão só acontece aqui, via chamada JS (verifyOtp) —
// de propósito, para não ser "consumida" por scanners de segurança de e-mail
// corporativo (ex.: Microsoft Safe Links) que pré-visitam links via GET antes
// do usuário clicar. Como esses scanners não executam JavaScript da página,
// o token só é validado quando um humano realmente abre o link no navegador.
export default function AceitarConvitePage() {
    const [senha, setSenha] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [pronto, setPronto] = useState(false);
    const [email, setEmail] = useState('');
    const [verificando, setVerificando] = useState(true);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const tokenHash = searchParams.get('token_hash');
        const type = searchParams.get('type') || 'invite';

        if (!tokenHash) {
            setError('Link inválido: token não encontrado na URL.');
            setVerificando(false);
            return;
        }

        supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error: verifyError }) => {
            if (verifyError) {
                setError('Link inválido ou expirado. Peça um novo convite/redefinição ao administrador.');
            } else {
                setEmail(data?.session?.user?.email || data?.user?.email || '');
            }
            setVerificando(false);
        });
    }, [searchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (senha.length < 6) {
            setError('A senha precisa ter pelo menos 6 caracteres.');
            return;
        }
        if (senha !== confirmar) {
            setError('As senhas não coincidem.');
            return;
        }
        setLoading(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password: senha });
            if (updateError) throw updateError;
            setPronto(true);
            setTimeout(() => navigate('/login'), 2500);
        } catch (err) {
            setError(err.message || 'Erro ao criar senha. O link pode ter expirado — peça um novo convite.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-white p-8">
            <div className="w-full max-w-[440px]">
                <img src="/logo-color.png" alt="VerticalParts" className="mb-8 h-8 object-contain" />

                {verificando ? (
                    <div className="flex items-center gap-2 text-neutral-500 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verificando convite...
                    </div>
                ) : pronto ? (
                    <div className="flex items-start gap-2.5 rounded border-l-[3px] border-green-600 bg-green-50 p-4 text-sm text-green-800">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        Senha criada com sucesso! Redirecionando para o login...
                    </div>
                ) : !email ? (
                    <div className="flex items-start gap-2.5 rounded border-l-[3px] border-red-600 bg-red-50 p-4 text-sm text-red-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        {error || 'Link inválido ou expirado. Peça um novo convite/redefinição ao administrador.'}
                    </div>
                ) : (
                    <>
                        <div className="mb-8">
                            <span className="vp-eyebrow">Portal Escamax</span>
                            <h2 className="mt-3 font-display text-3xl leading-tight text-black">
                                Criar sua senha
                            </h2>
                            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                                {email
                                    ? <>Definindo acesso para <strong className="text-black">{email}</strong>.</>
                                    : 'Defina a senha de acesso ao portal.'}
                            </p>
                        </div>

                        {error && (
                            <div className="mb-4 flex items-start gap-2.5 rounded border-l-[3px] border-red-600 bg-red-50 p-3.5 text-sm text-red-700">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-700">Nova senha</label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">
                                        <Lock className="h-4 w-4" />
                                    </span>
                                    <input
                                        type="password"
                                        value={senha}
                                        onChange={(e) => setSenha(e.target.value)}
                                        autoComplete="new-password"
                                        required
                                        placeholder="Mínimo 6 caracteres"
                                        className="w-full rounded border border-neutral-200 bg-white py-3.5 pl-11 pr-3.5 text-sm text-black outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                                    />
                                </div>
                            </div>
                            <div className="mb-4">
                                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-700">Confirmar senha</label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400">
                                        <Lock className="h-4 w-4" />
                                    </span>
                                    <input
                                        type="password"
                                        value={confirmar}
                                        onChange={(e) => setConfirmar(e.target.value)}
                                        autoComplete="new-password"
                                        required
                                        placeholder="Repita a senha"
                                        className="w-full rounded border border-neutral-200 bg-white py-3.5 pl-11 pr-3.5 text-sm text-black outline-none transition focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded bg-primary px-6 text-sm font-bold text-black transition-all duration-150 hover:-translate-y-0.5 hover:bg-primary-light hover:shadow-brand active:translate-y-0 active:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 disabled:!translate-y-0"
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Criar senha e continuar
                                {!loading && <ArrowRight className="h-4 w-4" />}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
