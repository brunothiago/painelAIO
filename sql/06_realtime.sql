-- =============================================================================
-- painelAIO — 06_realtime.sql
-- Liga o "tempo real": quando alguém altera um AIO, os outros navegadores
-- recebem o aviso e recarregam. Pode rodar de novo.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['aio', 'contrato', 'caixa_lista'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
