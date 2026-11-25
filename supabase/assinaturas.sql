-- Assinaturas do BarFácil mostradas na área do cliente (area.html).
-- Rode DEPOIS de clientes.sql: SQL Editor -> New query -> colar -> Run. Seguro para rodar mais de uma vez.

create table if not exists assinaturas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  license_id uuid references licenses(id) on delete set null,   -- chave do app, se houver
  plano text not null check (plano in ('teste', 'basica', 'premium')),
  plataforma text not null check (plataforma in ('windows', 'mobile')),
  status text not null default 'ativa' check (status in ('ativa', 'teste', 'atrasada', 'cancelada')),
  valor_mensal numeric(10,2),
  proxima_cobranca date,
  teste_termina_em date,
  created_at timestamptz not null default now()
);
create index if not exists assinaturas_cliente_idx on assinaturas(cliente_id);

alter table assinaturas enable row level security;

-- O cliente só LÊ as próprias assinaturas. Criar e alterar: só pelo painel do Supabase
-- (ou, no futuro, pela integração de pagamento usando a service role).
drop policy if exists "cliente le as proprias assinaturas" on assinaturas;
create policy "cliente le as proprias assinaturas" on assinaturas
  for select to authenticated using (cliente_id = auth.uid());

-- EXEMPLOS (troque o e-mail do cliente):
--   Teste de 7 dias no Windows:
--     insert into assinaturas (cliente_id, plano, plataforma, status, teste_termina_em)
--     select id, 'teste', 'windows', 'teste', current_date + 7 from clientes where email = 'cliente@exemplo.com';
--   Premium mensal no celular:
--     insert into assinaturas (cliente_id, plano, plataforma, status, valor_mensal, proxima_cobranca)
--     select id, 'premium', 'mobile', 'ativa', 49.90, current_date + 30 from clientes where email = 'cliente@exemplo.com';
