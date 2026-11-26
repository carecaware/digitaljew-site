-- Downloads e chave de teste na área do cliente (area.html → Downloads).
-- Rode DEPOIS de clientes.sql e licencas-cliente.sql (e das migrações do app até a migration-008).
-- Se mudar clientes.sql ou licencas-cliente.sql, rode os três de novo, nesta ordem.
-- SQL Editor -> New query -> colar -> Run. Seguro para rodar mais de uma vez.

-- ---------------------------------------------------------------------------------------------
-- 1) Chave do cliente por plataforma: devolve a chave que ele já tem ou, se pedir, cria UMA chave
--    de TESTE de 7 dias (contados a partir da primeira ativação). Regras:
--    - prefere uma chave paga (básica/premium) do cliente nessa plataforma;
--    - uma chave de teste por conta e por plataforma, para sempre (mesmo depois de vencida);
--    - o limite de UM teste por aparelho é aplicado na ativação (validate-license + trial_devices).
--    Erros: nao_autenticado | plataforma_invalida | sem_cadastro | teste_ja_usado
-- ---------------------------------------------------------------------------------------------
create or replace function nova_chave_licenca() returns text
language sql volatile set search_path = public as $$
  -- 16 caracteres do mesmo alfabeto do generate-keys.js (sem O/0/I/1), em 4 grupos de 4
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(b, i) % 32 + 1, 1)
                    || case when i in (3, 7, 11) then '-' else '' end, '' order by i)
  from (select uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) as b) r,
       generate_series(0, 15) i;
$$;
revoke all on function nova_chave_licenca() from public, anon, authenticated;

drop function if exists minha_chave(text, boolean);
create function minha_chave(p_plataforma text, p_criar boolean default false)
returns table (chave text, plano text, teste boolean, criada_agora boolean)
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text := lower(auth.jwt() ->> 'email');
  cli clientes%rowtype;
  l licenses%rowtype;
begin
  if uid is null then raise exception 'nao_autenticado'; end if;
  if p_plataforma is null or p_plataforma not in ('windows', 'mobile') then raise exception 'plataforma_invalida'; end if;
  select * into cli from clientes where id = uid;
  if not found then raise exception 'sem_cadastro'; end if;

  -- evita criar duas chaves se o cliente clicar duas vezes
  perform pg_advisory_xact_lock(hashtext('minha_chave:' || uid::text || ':' || p_plataforma));

  select * into l from licenses x
  where x.platform = p_plataforma and not x.revoked
    and (x.cliente_id = uid or (x.cliente_id is null and mail is not null and lower(trim(x.customer_contact)) = mail))
  order by (x.trial_days is null) desc, x.created_at
  limit 1;
  if found then
    return query select l.license_key,
      case when l.trial_days is not null then 'teste' when l.tier = 'premium' then 'premium' else 'basica' end,
      l.trial_days is not null, false;
    return;
  end if;

  -- já teve teste nesta plataforma (chave revogada): não ganha outro
  if exists (select 1 from licenses x where x.platform = p_plataforma and x.trial_days is not null
             and (x.cliente_id = uid or (mail is not null and lower(trim(x.customer_contact)) = mail))) then
    raise exception 'teste_ja_usado';
  end if;

  if not p_criar then return; end if;

  loop
    begin
      insert into licenses (license_key, platform, customer_name, client_temp_name, customer_contact, cliente_id, tier, trial_days, max_activations)
      values (nova_chave_licenca(), p_plataforma, cli.nome, nome_google(uid), coalesce(cli.email, mail), uid, 'premium', 7, 1)
      returning * into l;
      exit;
    exception when unique_violation then
      -- chave repetida (muito raro): tenta outra
    end;
  end loop;
  return query select l.license_key, 'teste'::text, true, true;
end $$;

revoke all on function minha_chave(text, boolean) from public, anon;
grant execute on function minha_chave(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2) Quem pode baixar os instaladores: logado E com cadastro completo. Usada pela função
--    download-instalador (supabase/functions), que busca o arquivo nas releases privadas do GitHub.
-- ---------------------------------------------------------------------------------------------
create or replace function eh_cliente() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clientes where id = auth.uid());
$$;
revoke all on function eh_cliente() from public, anon;
grant execute on function eh_cliente() to authenticated;
