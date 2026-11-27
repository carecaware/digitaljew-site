-- Pagamentos pela Asaas (Pix e cartão): compras na área do cliente e mensalidade única por cliente.
-- Rode DEPOIS de licencas-cliente.sql, estabelecimentos.sql e da migration-010 do app (aux_vagas).
-- Depois implante as funções:  supabase functions deploy pagamentos   e
--                               supabase functions deploy asaas-webhook --no-verify-jwt
-- Seguro para rodar mais de uma vez.
--
-- Como funciona (regras em docs/PACOTE-01 do app, item 5):
--  - Cada cliente tem UMA assinatura na Asaas (fatura única), sempre no mesmo dia do mês (29-31 -> 28).
--  - A 1ª compra é paga na hora; a assinatura começa no mês seguinte. Compras seguintes (outra licença,
--    aparelho de garçom) pagam na hora só os dias até o vencimento; abaixo de R$ 5,00 é cortesia.
--  - Valor da mensalidade = soma das licenças pagas ativas (Básica/Premium) + aparelhos de garçom.
--  - Licença paga vale até o próximo vencimento + 3 dias (tempo para pagar o Pix). Pagou, renova.
--  - O servidor cobra pelos preços desta tabela (o site mostra os mesmos).

create table if not exists precos (
  chave text primary key,            -- basica | premium | garcom
  valor numeric(10,2) not null,
  descricao text not null
);
insert into precos (chave, valor, descricao) values
  ('basica', 80.00, 'BarFácil Básica'), ('premium', 120.00, 'BarFácil Premium'), ('garcom', 20.00, 'Aparelho de garçom')
on conflict (chave) do nothing;
alter table precos enable row level security;
drop policy if exists "todos leem precos" on precos;
create policy "todos leem precos" on precos for select using (true);

alter table clientes add column if not exists asaas_customer_id text;
alter table licenses add column if not exists cobranca_asaas boolean not null default false;

-- a assinatura (fatura única) de cada cliente na Asaas
create table if not exists assinaturas_asaas (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  asaas_subscription_id text unique,
  forma text not null check (forma in ('PIX','CREDIT_CARD')),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  proximo_vencimento date not null,
  valor numeric(10,2) not null default 0,
  status text not null default 'ativa',          -- ativa | cancelada
  atualizado_em timestamptz not null default now()
);

-- cada compra feita na área do cliente
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo in ('licenca','garcom')),
  dados jsonb not null,                           -- plano, plataforma, estabelecimento_id | licenca_id, quantidade; proximo_vencimento
  descricao text not null,
  valor numeric(10,2) not null,                   -- cobrado agora (0 = cortesia)
  valor_mensal numeric(10,2) not null,            -- quanto passa a somar na mensalidade
  forma text check (forma in ('PIX','CREDIT_CARD')),
  asaas_payment_id text,
  asaas_checkout_id text,
  status text not null default 'aguardando',      -- aguardando | pago | cortesia | expirado | cancelado
  licenca_id uuid references licenses(id) on delete set null,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
create index if not exists pedidos_cliente_idx on pedidos(cliente_id, criado_em desc);
create index if not exists pedidos_payment_idx on pedidos(asaas_payment_id);
create index if not exists pedidos_checkout_idx on pedidos(asaas_checkout_id);

-- histórico de cobranças (compras e mensalidades)
create table if not exists faturas (
  asaas_payment_id text primary key,
  cliente_id uuid not null references clientes(id) on delete cascade,
  pedido_id uuid references pedidos(id) on delete set null,
  descricao text,
  valor numeric(10,2) not null,
  vencimento date,
  status text not null,                           -- pendente | paga | vencida | estornada | removida
  forma text,
  pago_em timestamptz,
  link text,                                      -- página da cobrança na Asaas (2ª via)
  itens jsonb,                                    -- o que a mensalidade cobriu
  criado_em timestamptz not null default now()
);
create index if not exists faturas_cliente_idx on faturas(cliente_id, criado_em desc);

-- avisos da Asaas (cada um processado uma vez só)
create table if not exists asaas_eventos (
  id text primary key,
  evento text not null,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

alter table assinaturas_asaas enable row level security;
alter table pedidos enable row level security;
alter table faturas enable row level security;
alter table asaas_eventos enable row level security;   -- sem políticas: só as funções (service role)
drop policy if exists "cliente vê a própria assinatura" on assinaturas_asaas;
create policy "cliente vê a própria assinatura" on assinaturas_asaas for select using (cliente_id = auth.uid());
drop policy if exists "cliente vê os próprios pedidos" on pedidos;
create policy "cliente vê os próprios pedidos" on pedidos for select using (cliente_id = auth.uid());
drop policy if exists "cliente vê as próprias faturas" on faturas;
create policy "cliente vê as próprias faturas" on faturas for select using (cliente_id = auth.uid());

-- itens que entram na mensalidade de um cliente (licenças pagas ativas + aparelhos de garçom)
create or replace function itens_mensalidade(p_cliente uuid)
returns table (licenca_id uuid, descricao text, valor numeric)
language sql stable security definer set search_path = public as $$
  with l as (
    select lic.*, coalesce(e.titulo, '') as estab
    from licenses lic left join estabelecimentos e on e.id = lic.estabelecimento_id
    where lic.cliente_id = p_cliente and lic.cobranca_asaas and not lic.revoked
      and lic.cancelada_ate is null
  )
  select l.id,
    (select descricao from precos where chave = case when l.tier = 'premium' and (l.downgrade_at is null or l.downgrade_at > now()) then 'premium' else 'basica' end)
      || ' · ' || case l.platform when 'mobile' then 'Android' when 'web' then 'Web' else 'Windows' end
      || ' · •••• ' || right(l.license_key, 4) || case when l.estab <> '' then ' · ' || l.estab else '' end,
    (select valor from precos where chave = case when l.tier = 'premium' and (l.downgrade_at is null or l.downgrade_at > now()) then 'premium' else 'basica' end)
  from l
  union all
  select l.id, l.aux_vagas || ' aparelho' || case when l.aux_vagas > 1 then 's' else '' end || ' de garçom · •••• ' || right(l.license_key, 4),
    l.aux_vagas * (select valor from precos where chave = 'garcom')
  from l where l.aux_vagas > 0;
$$;
revoke all on function itens_mensalidade(uuid) from public, anon, authenticated;

create or replace function valor_mensalidade(p_cliente uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(valor), 2), 0) from itens_mensalidade(p_cliente);
$$;
revoke all on function valor_mensalidade(uuid) from public, anon, authenticated;

-- área do cliente: próxima fatura (com os itens) e as últimas cobranças
create or replace function minha_fatura() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'assinatura', (select jsonb_build_object('forma', a.forma, 'vencimento', a.proximo_vencimento, 'dia', a.dia_vencimento, 'status', a.status)
                   from assinaturas_asaas a where a.cliente_id = auth.uid()),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('descricao', descricao, 'valor', valor)) from itens_mensalidade(auth.uid())), '[]'::jsonb),
    'total', valor_mensalidade(auth.uid()),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('descricao', f.descricao, 'valor', f.valor, 'vencimento', f.vencimento,
                                   'status', f.status, 'forma', f.forma, 'pago_em', f.pago_em, 'link', f.link) order by f.criado_em desc)
                           from (select * from faturas where cliente_id = auth.uid() order by criado_em desc limit 24) f), '[]'::jsonb)
  ) where auth.uid() is not null;
$$;
revoke all on function minha_fatura() from public, anon;
grant execute on function minha_fatura() to authenticated;

-- chave completa de uma licença minha (para ativar o app)
create or replace function chave_da_licenca(p_licenca uuid) returns text
language sql stable security definer set search_path = public as $$
  select lic.license_key from licenses lic where lic.id = p_licenca and not lic.revoked and eh_minha_licenca(lic);
$$;
revoke all on function chave_da_licenca(uuid) from public, anon;
grant execute on function chave_da_licenca(uuid) to authenticated;

-- Licença paga pela Asaas: a próxima cobrança é o vencimento da assinatura do cliente
-- (também é até quando ela vale se for cancelada).
create or replace function proxima_cobranca_licenca(lic licenses, desde timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare v date;
begin
  if lic.cobranca_asaas then
    select proximo_vencimento into v from assinaturas_asaas where cliente_id = lic.cliente_id and status = 'ativa';
    if v is not null then return (v::timestamp + interval '23 hours 59 minutes') at time zone 'America/Sao_Paulo'; end if;
  end if;
  return case when desde is null then null else proxima_data_cobranca(desde) end;
end $$;
revoke all on function proxima_cobranca_licenca(licenses, timestamptz) from public, anon, authenticated;
