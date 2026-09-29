// Configuração pública do painelAIO.
// A chave abaixo é a "publishable"/anon do Supabase: pode ficar no site porque
// o banco só entrega dados a usuários logados que estão na tabela perfil (RLS).
// NUNCA coloque aqui a secret/service_role key.
export const CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'COLE_AQUI_A_PUBLISHABLE_KEY',
  SUPABASE_JS: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm',
  SHEETJS: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
};
