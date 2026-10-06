-- =============================================================================
-- painelAIO — 07_padronizar.sql
-- Acerta valores digitados de jeitos diferentes para a grafia das listas fixas
-- do painel (docs/js/listas.js). Pode rodar de novo: só mexe no que ainda está fora.
--   python/aplicar_sql.py 07            (simula)
--   python/aplicar_sql.py 07 --commit   (grava)
-- =============================================================================

select set_config('app.autor', 'padronização de listas', true);

-- Modalidade: grafia do SACI
update contrato c set modalidade = m.novo
  from (values ('abastecimento de agua - rural',  'Abastecimento de água - Rural'),
               ('abastecimento de agua - urbano', 'Abastecimento de água - Urbano'),
               ('esgotamento sanitario',          'Esgotamento sanitário'),
               ('esgoto',                         'Esgotamento sanitário'),
               ('drenagem',                       'Drenagem Urbana'),
               ('contencao',                      'Contenção de Encostas'),
               ('urbanizacao',                    'Urbanização de Favelas')) m (chave, novo)
 where norm_txt(c.modalidade) = m.chave and c.modalidade <> m.novo;

-- Secretaria digitada no lugar da modalidade: apaga, e o painel mostra a modalidade do SACI
update contrato set modalidade = null where modalidade in ('SNSA', 'SNP', 'SNH', 'SEMOB');

-- Fase do PAC: "Novo PAC - Seleção 2024" -> "Novo PAC Seleção 2024"
update contrato set fase_pac = regexp_replace(fase_pac, '^Novo PAC\s*-\s*', 'Novo PAC ')
 where fase_pac ~ '^Novo PAC\s*-\s*';

-- UF e secretaria sempre em maiúsculas
update contrato set uf = upper(uf) where uf <> upper(uf);
update contrato set secretaria = upper(secretaria) where secretaria <> upper(secretaria);

-- Referência da solicitação: erro de digitação
update aio set referencia_solicitacao = replace(referencia_solicitacao, 'SPA Gllobal', 'SPA Global')
 where referencia_solicitacao like '%SPA Gllobal%';

-- Conferência: o que ficou
select 'modalidade' as campo, modalidade as valor, count(*) from contrato group by 2
union all
select 'fase_pac', fase_pac, count(*) from contrato group by 2
union all
select 'referencia_solicitacao', referencia_solicitacao, count(*) from aio where excluido_em is null group by 2
order by 1, 3 desc;
