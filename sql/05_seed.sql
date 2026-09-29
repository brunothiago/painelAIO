-- =============================================================================
-- painelAIO — 05_seed.sql
-- Momentos do fluxo. Pode rodar de novo (atualiza).
-- A equipe com acesso fica em 05b_equipe.sql (fora do Git: tem e-mails).
-- =============================================================================

insert into momento (codigo, ordem, nome, cor, is_desvio, is_final, sla_dias) values
  ('SOLICITADO',      1,  'Solicitado pela Caixa',              '#8A96A8', false, false, 5),
  ('RECEBIDO',        2,  'Recebido na CGPAC',                  '#5992ED', false, false, 3),
  ('EM_ANALISE',      3,  'Em análise (checklist)',             '#1351B4', false, false, 10),
  ('TRAMITADO_GABSE', 4,  'Tramitado ao GAB-SE',                '#0C326F', false, false, 10),
  ('ASSINADO',        5,  'Assinado',                           '#071D41', false, false, 5),
  ('CONCLUIDO',       6,  'Concluído (AIO concedida)',          '#168821', false, true,  null),
  ('PENDENCIA_CGPAC', 90, 'Pendência na CGPAC',                 '#C79A00', true,  false, 15),
  ('DEVOLVIDO_SF',    91, 'Devolvido à Secretaria Finalística', '#D46A00', true,  false, 30),
  ('IMPEDIMENTO',     92, 'Impedimento judicial/TCU',           '#E52207', true,  false, null),
  ('CANCELADO',       99, 'Cancelado / não se aplica',          '#6B7280', true,  true,  null)
on conflict (codigo) do update set
  ordem = excluded.ordem, nome = excluded.nome, cor = excluded.cor,
  is_desvio = excluded.is_desvio, is_final = excluded.is_final, sla_dias = excluded.sla_dias;
