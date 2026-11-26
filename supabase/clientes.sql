-- Cadastro de clientes do site (cadastro.html).
-- Rode no Supabase: SQL Editor -> New query -> colar -> Run. Seguro para rodar mais de uma vez.

create table if not exists clientes (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  whatsapp text,
  origem text,                -- "onde ouviu falar de nós"
  metodo text check (metodo in ('email', 'google')),  -- como confirmou o cadastro
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Campos adicionados depois (seguro rodar de novo)
alter table clientes add column if not exists tipo_comercio text;        -- bar/pub, pizzaria, restaurante...
alter table clientes add column if not exists boas_vindas_em timestamptz; -- quando o e-mail de boas-vindas foi enviado
alter table clientes alter column origem drop not null;

alter table clientes enable row level security;

-- Cada cliente só enxerga e altera o próprio cadastro.
drop policy if exists "cliente le o proprio cadastro" on clientes;
create policy "cliente le o proprio cadastro" on clientes
  for select to authenticated using (id = auth.uid());

drop policy if exists "cliente cria o proprio cadastro" on clientes;
create policy "cliente cria o proprio cadastro" on clientes
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "cliente atualiza o proprio cadastro" on clientes;
create policy "cliente atualiza o proprio cadastro" on clientes
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function clientes_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists clientes_touch on clientes;
create trigger clientes_touch before update on clientes for each row execute function clientes_touch();
