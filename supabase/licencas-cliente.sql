-- Licenças do BarFácil na área do cliente (area.html → Assinatura).
-- Rode DEPOIS de clientes.sql e das migrações do app (schema.sql, migration-002 a 006 e migration-010).
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

-- Estabelecimento (ver estabelecimentos.sql) e cancelamento pelo próprio cliente.
alter table licenses add column if not exists estabelecimento_id uuid;
alter table licenses add column if not exists cancelada_em timestamptz;          -- quando o cliente cancelou
alter table licenses add column if not exists cancelada_ate timestamptz;         -- até quando ainda pode usar
alter table licenses add column if not exists expira_antes_do_cancelamento timestamptz; -- para desfazer sem perder uma validade antiga

-- Nome que veio da conta Google no primeiro login (provisório: o cliente confirma o nome dele no
-- cadastro, e esse fica em customer_name). Fica vazio para quem se cadastra por e-mail.
alter table licenses add column if not exists client_temp_name text;

create or replace function nome_google(uid uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), '')
  from auth.users u
  where u.id = uid
    and (u.raw_app_meta_data ->> 'provider' = 'google' or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google');
$$;
revoke all on function nome_google(uuid) from public, anon, authenticated;

-- Quando o cadastro é concluído, as licenças que já eram dele (pelo e-mail) recebem o nome do Google.
create or replace function clientes_nome_google_nas_licencas() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text := nome_google(new.id);
begin
  if g is not null then
    update licenses set client_temp_name = g
    where client_temp_name is null
      and (cliente_id = new.id or (cliente_id is null and lower(trim(customer_contact)) = lower(new.email)));
  end if;
  return new;
end $$;
drop trigger if exists clientes_nome_google on clientes;
create trigger clientes_nome_google after insert on clientes
  for each row execute function clientes_nome_google_nas_licencas();

-- Próximo dia de cobrança: o mesmo dia do mês em que a cobrança começou, contado no horário de
-- Brasília. Quem começou no dia 29, 30 ou 31 vence sempre no dia 28 (assim o dia nunca muda).
-- Mesma regra da função schedule-downgrade do app.
create or replace function proxima_data_cobranca(desde timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  dia int := least(28, extract(day from desde at time zone 'America/Sao_Paulo')::int);
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

-- A licença é deste cliente? (pelo cliente_id ou, se ainda não ligada, pelo e-mail da conta)
create or replace function eh_minha_licenca(lic licenses) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (lic.cliente_id = auth.uid()
    or (lic.cliente_id is null and lower(trim(lic.customer_contact)) = lower(auth.jwt() ->> 'email')));
$$;
revoke all on function eh_minha_licenca(licenses) from public, anon, authenticated;

-- Início da cobrança: 1ª ativação (premium/básica) ou uso da chave premium (mesma regra do app)
create or replace function inicio_cobranca(lic licenses) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when lic.tier <> 'premium' and exists (select 1 from premium_keys p where p.license_id = lic.id and not p.revoked)
      then coalesce((select min(p.redeemed_at) from premium_keys p where p.license_id = lic.id and not p.revoked),
                    (select min(a.activated_at) from license_activations a where a.license_id = lic.id))
    else (select min(a.activated_at) from license_activations a where a.license_id = lic.id) end;
$$;
revoke all on function inicio_cobranca(licenses) from public, anon, authenticated;

drop function if exists minhas_licencas();
create function minhas_licencas()
returns table (
  id uuid,                          -- identificador interno (para cancelar, reverter e ligar a um estabelecimento)
  final_chave text,                 -- últimos 4 caracteres da chave, para o cliente reconhecer
  plataforma text,                  -- windows | mobile | web
  plano text,                       -- teste | basica | premium
  situacao text,                    -- ativa | cancelada | teste | aguardando_ativacao | teste_encerrado | expirada
  dias_teste int,
  teste_termina_em timestamptz,
  proxima_cobranca timestamptz,
  volta_para_basica_em timestamptz, -- o cliente pediu para voltar à Básica (premium até essa data)
  ativada boolean,
  cancelada_ate timestamptz,        -- cancelada: pode usar até essa data (dá para reverter até lá)
  pode_cancelar boolean,
  estabelecimento_id uuid,
  aux_vagas int,                    -- vagas pagas para aparelhos de garçom (migration-010 do app)
  aux_em_uso int                    -- aparelhos de garçom conectados agora
)
language sql stable security definer set search_path = public as $$
  with l as (
    select lic.*,
      (select min(a.activated_at) from license_activations a where a.license_id = lic.id) as primeira_ativacao,
      exists (select 1 from premium_keys p where p.license_id = lic.id and not p.revoked) as tem_chave_premium,
      inicio_cobranca(lic) as cobranca_desde
    from licenses lic
    where not lic.revoked and eh_minha_licenca(lic)
  ), c as (
    select l.*,
      l.trial_days is not null as teste,
      l.expires_at is not null and l.expires_at < now() as vencida,
      l.cancelada_ate is not null and l.cancelada_ate > now() as cancelada,
      case when (l.tier = 'premium' or l.tem_chave_premium)
                and not (l.downgrade_at is not null and l.downgrade_at <= now())
           then 'premium' else 'basica' end as plano_pago
    from l
  )
  select
    c.id,
    right(c.license_key, 4),
    c.platform,
    case when c.teste then 'teste' else c.plano_pago end,
    case when c.teste and c.expires_at is null then 'aguardando_ativacao'
         when c.vencida and c.teste then 'teste_encerrado'
         when c.vencida then 'expirada'
         when c.cancelada then 'cancelada'
         when c.teste then 'teste'
         else 'ativa' end,
    c.trial_days,
    case when c.teste then c.expires_at end,
    case when c.teste or c.vencida or c.cancelada or c.cobranca_desde is null then null
         else proxima_data_cobranca(c.cobranca_desde) end,
    case when not c.teste and not c.cancelada and c.downgrade_at > now() then c.downgrade_at end,
    c.primeira_ativacao is not null,
    case when c.cancelada then c.cancelada_ate end,
    not c.teste and not c.vencida and not c.cancelada,
    c.estabelecimento_id,
    coalesce(c.aux_vagas, 0),
    (select count(*)::int from aux_devices d where d.license_id = c.id and d.desconectado_em is null)
  from c
  order by c.created_at;
$$;

revoke all on function minhas_licencas() from public, anon;
grant execute on function minhas_licencas() to authenticated;

-- Cancelar: a assinatura continua valendo até o fim do período já pago (a próxima data de cobrança)
-- e depois o app para de funcionar. Licença paga que nunca foi ativada termina na hora.
-- Devolve a data final. Erros: nao_encontrada | nao_pode_cancelar
create or replace function cancelar_assinatura(p_licenca uuid) returns timestamptz
language plpgsql volatile security definer set search_path = public as $$
declare lic licenses%rowtype; fim timestamptz; ini timestamptz;
begin
  select * into lic from licenses where id = p_licenca for update;
  if not found or lic.revoked or not eh_minha_licenca(lic) then raise exception 'nao_encontrada'; end if;
  if lic.trial_days is not null or (lic.expires_at is not null and lic.expires_at < now())
     or (lic.cancelada_ate is not null and lic.cancelada_ate > now()) then raise exception 'nao_pode_cancelar'; end if;
  ini := inicio_cobranca(lic);
  fim := case when ini is null then now() else proxima_data_cobranca(ini) end;
  if lic.expires_at is not null and lic.expires_at < fim then fim := lic.expires_at; end if;
  update licenses set cancelada_em = now(), cancelada_ate = fim,
         expira_antes_do_cancelamento = lic.expires_at, expires_at = fim
  where id = lic.id;
  return fim;
end $$;

-- Reverter: só enquanto ainda está dentro do período (antes da data final). Volta tudo como era.
-- Erros: nao_encontrada | nao_esta_cancelada
create or replace function reverter_cancelamento(p_licenca uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare lic licenses%rowtype;
begin
  select * into lic from licenses where id = p_licenca for update;
  if not found or lic.revoked or not eh_minha_licenca(lic) then raise exception 'nao_encontrada'; end if;
  if lic.cancelada_ate is null or lic.cancelada_ate <= now() then raise exception 'nao_esta_cancelada'; end if;
  update licenses set expires_at = lic.expira_antes_do_cancelamento, expira_antes_do_cancelamento = null,
         cancelada_em = null, cancelada_ate = null
  where id = lic.id;
  return true;
end $$;

revoke all on function cancelar_assinatura(uuid) from public, anon;
revoke all on function reverter_cancelamento(uuid) from public, anon;
grant execute on function cancelar_assinatura(uuid) to authenticated;
grant execute on function reverter_cancelamento(uuid) to authenticated;

-- A tabela "assinaturas" da versão anterior não é mais usada pelo site. Se você chegou a criá-la
-- e não tem nada nela, pode apagar com:  drop table if exists assinaturas;
