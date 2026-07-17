import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import FilialSelectPage from './pages/FilialSelectPage';
import HistoryPage from './pages/HistoryPage';
import DashboardPage from './pages/DashboardPage';
import PecasSemEstoquePage from './pages/PecasSemEstoquePage';
import ProdutosVPPage from './pages/ProdutosVPPage';
import EstoqueVPPage from './pages/EstoqueVPPage';
import EstoqueEscamaxPage from './pages/EstoqueEscamaxPage';
import OutrosFornecedoresPage from './pages/OutrosFornecedoresPage';
import AprovacoesPage from './pages/AprovacoesPage';
import RequisicaoServicosPage from './pages/RequisicaoServicosPage';
import RequisicaoServicoNovaPage from './pages/RequisicaoServicoNovaPage';
import RequisicaoServicoDetalhePage from './pages/RequisicaoServicoDetalhePage';
import ServicoLpuPage from './pages/ServicoLpuPage';
import ConvidarUsuarioPage from './pages/ConvidarUsuarioPage';
import LogsPage from './pages/LogsPage';
import AceitarConvitePage from './pages/AceitarConvitePage';
import CartSidebar from './components/CartSidebar';
import Sidebar from './components/Sidebar';

const PAGE_TITLES = {
    '/produtos-vp': 'Produtos VerticalParts',
    '/outros-fornecedores': 'Outros Fornecedores',
    '/aprovacoes': 'Alçadas de Aprovação',
    '/requisicao-servicos': 'Requisição Serviços',
    '/requisicao-servicos/nova': 'Nova Requisição de Serviço',
    '/requisicao-servicos/lpu': 'Tabela de Preços (LPU) — Admin',
    '/history': 'Histórico de Pedidos',
    '/sem-estoque': 'Peças Sem Estoque',
    '/estoque-vp': 'Estoque VerticalParts',
    '/estoque-escamax': 'Estoque Escamax',
    '/dashboard': 'Dashboard',
    '/usuarios/convidar': 'Convidar Usuário',
    '/logs': 'Logs de Auditoria',
};

function ProtectedRoute({ children }) {
    const { isAuthenticated, filial } = useAuth();
    const location = useLocation();
    if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
    if (!filial) return <Navigate to="/selecionar-filial" replace />;
    return children;
}

function AuthRoute({ children }) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return children;
}

function AdminRoute({ children }) {
    const { isAuthenticated, filial, user } = useAuth();
    const location = useLocation();
    if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
    if (!filial) return <Navigate to="/selecionar-filial" replace />;
    if (!user?.admin) return <Navigate to="/" replace />;
    return children;
}

function Layout({ children, cart, updateQuantity, removeFromItem, clearCart, cartOpen, setCartOpen, validacaoCarrinho, finalidade, setFinalidade }) {
    const { logout } = useAuth();
    const location = useLocation();
    const title = PAGE_TITLES[location.pathname] || 'Portal Escamax';
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <div className="flex h-screen overflow-hidden bg-white text-black">
            <Sidebar logout={logout} />
            <div className="flex flex-1 flex-col overflow-hidden">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6">
                    <h1 className="text-sm font-semibold text-black">{title}</h1>
                    <div className="flex items-center gap-4">
                        <span className="vp-eyebrow">Portal B2B Escamax</span>
                        <button
                            onClick={() => setCartOpen(true)}
                            className="relative flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-primary hover:text-primary"
                            title="Abrir carrinho"
                        >
                            <ShoppingCart size={16} />
                            <span>Carrinho</span>
                            {totalItems > 0 && (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-black">
                                    {totalItems > 9 ? '9+' : totalItems}
                                </span>
                            )}
                        </button>
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto bg-neutral-50 p-6">
                    {children}
                </main>
            </div>

            <CartSidebar
                isOpen={cartOpen}
                onClose={() => setCartOpen(false)}
                cart={cart}
                updateQuantity={updateQuantity}
                removeFromItem={removeFromItem}
                clearCart={clearCart}
                validacaoRef={validacaoCarrinho.validado ? validacaoCarrinho : null}
                finalidade={finalidade}
                setFinalidade={setFinalidade}
            />
        </div>
    );
}

export default function App() {
    const { filial } = useAuth();

    // ── Estado do carrinho ────────────────────────────────────────────────────
    const [cart, setCart] = useState([]);
    const [cartOpen, setCartOpen] = useState(false);

    const [finalidade, setFinalidade] = useState('Revenda');
    const [validacaoCarrinho, setValidacaoCarrinho] = useState({ tipo: '', numero: '', validado: false });

    // Reseta pedido e carrinho ao trocar de filial
    useEffect(() => {
        setCart([]);
        setFinalidade('Revenda');
        setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
    }, [filial?.id]);

    useEffect(() => {
        setCart([]);
        setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
    }, [finalidade]);

    const addToCart = useCallback((produto) => {
        const quantidade = Number(produto.quantity || 1);
        setCart(prev => {
            const existe = prev.find(i => i.codigo === produto.codigo);
            if (existe) {
                return prev.map(i =>
                    i.codigo === produto.codigo
                        ? { ...i, quantity: i.quantity + quantidade }
                        : i
                );
            }
            return [...prev, { ...produto, quantity: quantidade }];
        });
    }, []);

    const updateQuantity = useCallback((codigo, delta) => {
        setCart(prev =>
            prev
                .map(i => i.codigo === codigo ? { ...i, quantity: i.quantity + delta } : i)
                .filter(i => i.quantity > 0)
        );
    }, []);

    const removeFromItem = useCallback((codigo) => {
        setCart(prev => prev.filter(i => i.codigo !== codigo));
    }, []);

    const clearCart = useCallback(() => setCart([]), []);

    const layoutProps = {
        cart,
        updateQuantity,
        removeFromItem,
        clearCart,
        cartOpen,
        setCartOpen,
        validacaoCarrinho,
        finalidade,
        setFinalidade,
    };

    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/aceitar-convite" element={<AceitarConvitePage />} />

            <Route
                path="/selecionar-filial"
                element={
                    <AuthRoute>
                        <FilialSelectPage />
                    </AuthRoute>
                }
            />

            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <Navigate to="/produtos-vp" replace />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/produtos-vp"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}>
                            <ProdutosVPPage
                                cart={cart}
                                addToCart={addToCart}
                                finalidade={finalidade}
                                setFinalidade={setFinalidade}
                                validacaoCarrinho={validacaoCarrinho}
                                setValidacaoCarrinho={setValidacaoCarrinho}
                                onOpenCart={() => setCartOpen(true)}
                            />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/history"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><HistoryPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/aprovacoes"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><AprovacoesPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/requisicao-servicos"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><RequisicaoServicosPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/requisicao-servicos/nova"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><RequisicaoServicoNovaPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/requisicao-servicos/lpu"
                element={
                    <AdminRoute>
                        <Layout {...layoutProps}><ServicoLpuPage /></Layout>
                    </AdminRoute>
                }
            />
            <Route
                path="/requisicao-servicos/:id"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><RequisicaoServicoDetalhePage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/outros-fornecedores"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}>
                            <OutrosFornecedoresPage
                                addToCart={addToCart}
                                finalidade={finalidade}
                                setFinalidade={setFinalidade}
                                validacaoCarrinho={validacaoCarrinho}
                                setValidacaoCarrinho={setValidacaoCarrinho}
                                onOpenCart={() => setCartOpen(true)}
                            />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/estoque-vp"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><EstoqueVPPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/estoque-escamax"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><EstoqueEscamaxPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/dashboard"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><DashboardPage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/sem-estoque"
                element={
                    <ProtectedRoute>
                        <Layout {...layoutProps}><PecasSemEstoquePage /></Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/usuarios/convidar"
                element={
                    <AdminRoute>
                        <Layout {...layoutProps}><ConvidarUsuarioPage /></Layout>
                    </AdminRoute>
                }
            />
            <Route
                path="/logs"
                element={
                    <AdminRoute>
                        <Layout {...layoutProps}><LogsPage /></Layout>
                    </AdminRoute>
                }
            />
        </Routes>
    );
}
