-- =============================================================================
-- painelAIO — 99_testes.sql
-- Confere as regras de acesso e de negócio. Não deixa rastro: tudo é desfeito
-- no final (rollback).
-- Resultado esperado: a última linha mostra "TODOS OS TESTES PASSARAM".
-- Se algum falhar, o SQL Editor mostra um erro começando com "FALHOU".
-- =============================================================================

begin;

insert into perfil (email, login, nome) values ('teste.membro@teste.local', 'teste.membro', 'Teste')
on conflict (email) do nothing;

-- 1) Visitante sem login não lê nada
set local role anon;
do $$
begin
  begin
    perform 1 from aio limit 1;
    raise exception 'FALHOU 1: visitante sem login conseguiu ler a tabela aio';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 2) Usuário logado que não está na tabela perfil não vê nem cria nada
select set_config('request.jwt.claims', '{"email":"intruso@teste.local","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from v_aio_painel;
  if n <> 0 then raise exception 'FALHOU 2a: usuário fora do perfil viu % AIOs', n; end if;
  begin
    perform criar_aio('{"contrato":{"nr_instrumento":"999001"},"aio":{}}');
    raise exception 'FALHOU 2b: usuário fora do perfil criou AIO';
  exception when raise_exception then
    if sqlerrm not like 'Acesso não liberado%' then raise; end if;
  end;
end $$;
reset role;

-- 3 a 10) Membro da equipe
select set_config('request.jwt.claims', '{"email":"teste.membro@teste.local","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_id bigint;
  v    aio;
  n    int;
begin
  -- 3) cria AIO e o histórico registra o autor
  v_id := criar_aio('{"contrato":{"nr_instrumento":"999001","municipio":"Teste","uf":"df"},
                      "aio":{"etapas":[1],"tipo":"EMISSAO"}}');
  select count(*) into n from v_aio_painel where id = v_id;
  if n <> 1 then raise exception 'FALHOU 3a: AIO criado não aparece no painel'; end if;
  select count(*) into n from aio_historico
   where aio_id = v_id and acao = 'criado' and por = 'teste.membro@teste.local';
  if n <> 1 then raise exception 'FALHOU 3b: histórico de criação sem o autor'; end if;

  -- 4) etapa sobreposta no mesmo contrato é recusada
  begin
    perform criar_aio('{"contrato":{"nr_instrumento":"999001"},"aio":{"etapas":[1,2]}}');
    raise exception 'FALHOU 4: aceitou duas vezes a etapa 1';
  exception when raise_exception then
    if sqlerrm not like 'Já existe um AIO em andamento%' then raise; end if;
  end;

  -- 5) desvio sem observação é recusado
  select * into v from aio where id = v_id;
  begin
    perform mudar_momento(v_id, 'PENDENCIA_CGPAC', current_date, null, v.versao);
    raise exception 'FALHOU 5: aceitou desvio sem observação';
  exception when raise_exception then
    if sqlerrm not like 'Informe uma observação%' then raise; end if;
  end;

  -- 6) mudança de momento grava histórico e data-marco
  perform mudar_momento(v_id, 'RECEBIDO', current_date, 'chegou no SEI', v.versao);
  select count(*) into n from aio_historico
   where aio_id = v_id and acao = 'momento' and momento_para = 'RECEBIDO' and obs = 'chegou no SEI';
  if n <> 1 then raise exception 'FALHOU 6a: mudança de momento sem histórico'; end if;
  select count(*) into n from aio where id = v_id and dt_entrada_cgpac = current_date;
  if n <> 1 then raise exception 'FALHOU 6b: data de entrada na CGPAC não preenchida'; end if;

  -- 7) versão antiga (outra pessoa alterou antes) é recusada
  begin
    perform mudar_momento(v_id, 'EM_ANALISE', current_date, null, v.versao);
    raise exception 'FALHOU 7: aceitou alteração com versão antiga';
  exception when others then
    if sqlerrm not like 'Este AIO foi alterado%' then raise; end if;
  end;

  -- 8) histórico não pode ser alterado
  begin
    update aio_historico set obs = 'x' where aio_id = v_id;
    raise exception 'FALHOU 8: histórico foi alterado';
  exception when insufficient_privilege then null;
  end;

  -- 9) só admin exclui
  begin
    update aio set excluido_em = now() where id = v_id;
    raise exception 'FALHOU 9: analista excluiu AIO';
  exception when raise_exception then
    if sqlerrm not like 'Só administradores%' then raise; end if;
  end;

  -- 10) data futura é recusada
  select * into v from aio where id = v_id;
  begin
    perform mudar_momento(v_id, 'EM_ANALISE', current_date + 3, null, v.versao);
    raise exception 'FALHOU 10: aceitou data futura';
  exception when raise_exception then
    if sqlerrm not like 'A data do momento não pode ser futura%' then raise; end if;
  end;

  -- 11) edição de campo gera diff no histórico
  update aio set obs = 'observação de teste' where id = v_id;
  select count(*) into n from aio_historico where aio_id = v_id and acao = 'edicao' and diff ? 'obs';
  if n <> 1 then raise exception 'FALHOU 11: edição sem diff no histórico'; end if;
end $$;
reset role;

rollback;

select 'TODOS OS TESTES PASSARAM' as resultado;
