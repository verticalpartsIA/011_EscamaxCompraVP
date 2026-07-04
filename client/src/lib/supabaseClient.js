import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3ZsY3NreG9wcnlxdmhvZnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc0NjIsImV4cCI6MjA5MDM2MzQ2Mn0.Hzl6k-TM_U1Ae8cNUPtz8MFBbZ4EVF3EGOhvgV7xnqk';

// Usado só para o fluxo de aceite de convite (criação de senha) — a sessão do
// portal em si continua sendo o JWT próprio (localStorage 'token'), não o
// supabase-js. Aqui só aproveitamos o parsing automático do token de convite
// que o Supabase Auth coloca na URL.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        detectSessionInUrl: true,
        persistSession: false,
        autoRefreshToken: false,
    },
});
