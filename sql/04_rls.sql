-- =============================================================================
-- painelAIO — 04_rls.sql
-- Quem pode ler e gravar. Só usuários logados que estão na tabela perfil
-- (ativo = true) enxergam os dados. Os scripts usam a service key, que ignora
-- estas regras. Pode rodar de novo.
-- =============================================================================

alter table momento          enable row level security;
alter table perfil           enable row level security;
alter table contrato         enable row level security;
alter table aio              enable row level security;
alter table aio_historico    enable row level security;
alter table caixa_lista      enable row level security;
alter table caixa_lista_item enable row level security;
alter table referencia       enable row level security;
alter table sync_log         enable row level security;

-- Visitante sem login (anon) não acessa nada.
revoke all on momento, perfil, contrato, aio, aio_historico, caixa_lista, caixa_lista_item,
              referencia, sync_log, v_aio_painel, v_caixa_sem_cadastro, v_caixa_listas, v_atividade
  from anon;
revoke execute on function criar_aio(jsonb), mudar_momento(bigint, text, date, text, int),
                           importar_lista_caixa(jsonb)
  from anon, public;
grant execute on function criar_aio(jsonb), mudar_momento(bigint, text, date, text, int),
                          importar_lista_caixa(jsonb)
  to authenticated, service_role;

-- Tabelas que o painel só lê (gravação só por script ou por função do banco).
revoke insert, update, delete on aio_historico, caixa_lista_item, referencia, sync_log from authenticated;
revoke insert, update on caixa_lista from authenticated;
revoke delete on contrato, aio from authenticated;

-- momento / perfil: todos leem; só admin altera
drop policy if exists momento_ler on momento;
create policy momento_ler on momento for select to authenticated using (is_membro());
drop policy if exists momento_admin on momento;
create policy momento_admin on momento for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists perfil_ler on perfil;
create policy perfil_ler on perfil for select to authenticated using (is_membro());
drop policy if exists perfil_admin on perfil;
create policy perfil_admin on perfil for all to authenticated using (is_admin()) with check (is_admin());

-- contrato / aio: a equipe lê, cria e altera (excluir = exclusão lógica, só admin, no trigger)
drop policy if exists contrato_ler on contrato;
create policy contrato_ler on contrato for select to authenticated using (is_membro());
drop policy if exists contrato_criar on contrato;
create policy contrato_criar on contrato for insert to authenticated with check (is_membro());
drop policy if exists contrato_alterar on contrato;
create policy contrato_alterar on contrato for update to authenticated using (is_membro()) with check (is_membro());

drop policy if exists aio_ler on aio;
create policy aio_ler on aio for select to authenticated using (is_membro());
drop policy if exists aio_criar on aio;
create policy aio_criar on aio for insert to authenticated with check (is_membro());
drop policy if exists aio_alterar on aio;
create policy aio_alterar on aio for update to authenticated using (is_membro()) with check (is_membro());

-- somente leitura para a equipe
drop policy if exists historico_ler on aio_historico;
create policy historico_ler on aio_historico for select to authenticated using (is_membro());
drop policy if exists caixa_lista_ler on caixa_lista;
create policy caixa_lista_ler on caixa_lista for select to authenticated using (is_membro());
drop policy if exists caixa_lista_excluir on caixa_lista;
create policy caixa_lista_excluir on caixa_lista for delete to authenticated using (is_admin());
drop policy if exists caixa_item_ler on caixa_lista_item;
create policy caixa_item_ler on caixa_lista_item for select to authenticated using (is_membro());
drop policy if exists referencia_ler on referencia;
create policy referencia_ler on referencia for select to authenticated using (is_membro());
drop policy if exists sync_log_ler on sync_log;
create policy sync_log_ler on sync_log for select to authenticated using (is_membro());
