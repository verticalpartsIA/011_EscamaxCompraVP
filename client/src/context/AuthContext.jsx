import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext();

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [filial, setFilialState] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const sessionExpiradaRef = useRef(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const savedUser = localStorage.getItem('escamax_user');
        const savedFilial = localStorage.getItem('escamax_filial');

        if (token && savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setIsAuthenticated(true);
            } catch {
                localStorage.removeItem('token');
                localStorage.removeItem('escamax_user');
            }
        }
        if (savedFilial) {
            try { setFilialState(JSON.parse(savedFilial)); } catch { /* ignorar */ }
        }
        setLoading(false);
    }, []);

    // Intercepta globalmente respostas 401 da API — sem isso, cada tela mostrava só o erro
    // cru ("Token inválido"/"Erro 401") quando a sessão expirava (token JWT dura 8h), sem
    // nunca levar o usuário de volta pro login.
    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            const isApiCall = url.includes('/api/') && !url.includes('/api/auth/login');
            if (response.status === 401 && isApiCall && localStorage.getItem('token') && !sessionExpiradaRef.current) {
                sessionExpiradaRef.current = true;
                localStorage.removeItem('token');
                localStorage.removeItem('escamax_user');
                setUser(null);
                setIsAuthenticated(false);
                navigate('/login', { state: { sessaoExpirada: true } });
            }
            return response;
        };
        return () => { window.fetch = originalFetch; };
    }, [navigate]);

    const login = async (email, senha) => {
        sessionExpiradaRef.current = false;
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'E-mail ou senha inválidos.');

        localStorage.setItem('token', data.token);
        localStorage.setItem('escamax_user', JSON.stringify(data.user));
        setUser(data.user);
        setIsAuthenticated(true);
        return true;
    };

    const selectFilial = (filialObj) => {
        setFilialState(filialObj);
        localStorage.setItem('escamax_filial', JSON.stringify(filialObj));
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('escamax_user');
        localStorage.removeItem('escamax_filial');
        setUser(null);
        setFilialState(null);
        setIsAuthenticated(false);
    };

    const value = { user, filial, isAuthenticated, login, selectFilial, logout, loading };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}
