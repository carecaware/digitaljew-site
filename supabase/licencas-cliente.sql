-- Licenças do BarFácil na área do cliente (area.html → Assinatura).
-- Rode DEPOIS de clientes.sql e das migrações do app (schema.sql e migration-002 a 006).
-- SQL Editor -> New query -> colar -> Run. Seguro para rodar mais de uma vez.
--
-- Como uma licença aparece para o cliente:
--   1) automático: o e-mail da conta é igual ao customer_contact da licença; ou
--   2) manual:     update licenses set cliente_id = (select id from clientes where email = 'cliente@exemplo.com')
--                  where license_key = 'XXXX-XXXX-XXXX-XXXX';
-- A tabela licenses continua fechada (sem policy): o site só recebe o resumo calculado pela
-- função minhas_licencas(), nunca a chave inteira nem os outros campos internos.

alter table licenses add column if not exists cliente_id uuid references clientes(id) on delete set null;
create index if not exists licenses_cliente_idx on licenses(cliente_id);

-- Próximo dia de cobrança: o mesmo dia do mês em que a cobrança começou (ajustado ao tamanho do
-- mês), contado no horário de Brasília. Mesma regra da função schedule-downgrade do app.
create or replace function proxima_data_cobranca(desde timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  dia int := extract(day from desde at time zone 'America/Sao_Paulo');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  mes date := date_trunc('month', hoje)::date;
  d date;
begin
  for i in 0..2 loop
    d := (mes + make_interval(months => i))::date;
    d := d + (least(dia, extract(day from (d + interval '1 month - 1 day'))::int) - 1);
    if d > hoje then return d::timestamp at time zone 'America/Sao_Paulo'; end if;
  end loop;
  return null;
end $$;

drop function if exists minhas_licencas();
create function minhas_licencas()
returns table (
  final_chave text,                 -- últimos 4 caracteres da chave, para o cliente reconhecer
  plataforma text,                  -- windows | mobile | web
  plano text,                       -- teste | basica | premium
  situacao text,                    -- ativa | teste | aguardando_ativacao | teste_encerrado | expirada
  dias_teste int,
  teste_termina_em timestamptz,
  proxima_cobranca timestamptz,
  volta_para_basica_em timestamptz, -- o cliente pediu para voltar à Básica (premium até essa data)
  ativada boolean
)
language sql stable security definer set search_path = public as $$
  with l as (
    select lic.*,
      (select min(a.activated_at) from license_activations a where a.license_id = lic.id) as primeira_ativacao,
      (select min(p.redeemed_at) from premium_keys p where p.license_id = lic.id and not p.revoked) as premium_desde,
      exists (select 1 from premium_keys p where p.license_id = lic.id and not p.revoked) as tem_chave_premium
    from licenses lic
    where auth.uid() is not null
      and not lic.revoked
      and (lic.cliente_id = auth.uid()
           or (lic.cliente_id is null
               and lower(trim(lic.customer_contact)) = lower(auth.jwt() ->> 'email')))
  ), c as (
    select l.*,
      l.trial_days is not null as teste,
      l.expires_at is not null and l.expires_at < now() as vencida,
      case when (l.tier = 'premium' or l.tem_chave_premium)
                and not (l.downgrade_at is not null and l.downgrade_at <= now())
           then 'premium' else 'basica' end as plano_pago,
      -- início da cobrança: ativação (premium/básica) ou uso da chave premium
      case when l.tier <> 'premium' and l.tem_chave_premium then coalesce(l.premium_desde, l.primeira_ativacao)
           else l.primeira_ativacao end as cobranca_desde
    from l
  )
  select
    right(c.license_key, 4),
    c.platform,
    case when c.teste then 'teste' else c.plano_pago end,
    case when c.teste and c.expires_at is null then 'aguardando_ativacao'
         when c.vencida and c.teste then 'teste_encerrado'
         when c.vencida then 'expirada'
         when c.teste then 'teste'
         else 'ativa' end,
    c.trial_days,
    case when c.teste then c.expires_at end,
    case when c.teste or c.vencida or c.cobranca_desde is null then null
         else proxima_data_cobranca(c.cobranca_desde) end,
    case when not c.teste and c.downgrade_at > now() then c.downgrade_at end,
    c.primeira_ativacao is not null
  from c
  order by c.created_at;
$$;

revoke all on function minhas_licencas() from public, anon;
grant execute on function minhas_licencas() to authenticated;

-- A tabela "assinaturas" da versão anterior não é mais usada pelo site. Se você chegou a criá-la
-- e não tem nada nela, pode apagar com:  drop table if exists assinaturas;
