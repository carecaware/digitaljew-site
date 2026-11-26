-- Meus estabelecimentos (area.html → Meus estabelecimentos).
-- Rode DEPOIS de clientes.sql, licencas-cliente.sql e downloads-e-chaves.sql.
-- SQL Editor -> New query -> colar -> Run. Seguro para rodar mais de uma vez.
--
-- Cada cliente cadastra os estabelecimentos dele (título, endereço opcional e tipo) e liga a cada um
-- as licenças do BarFácil que usa ali. A compra de uma licença nova para um estabelecimento (Pix,
-- Asaas) será ligada aqui quando a integração de pagamento existir.

create table if not exists estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null default auth.uid() references clientes(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 80),
  endereco text check (endereco is null or length(endereco) <= 200),
  tipo text not null check (length(trim(tipo)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists estabelecimentos_cliente_idx on estabelecimentos(cliente_id);

alter table estabelecimentos enable row level security;
drop policy if exists "cliente le os proprios estabelecimentos" on estabelecimentos;
create policy "cliente le os proprios estabelecimentos" on estabelecimentos
  for select to authenticated using (cliente_id = auth.uid());
drop policy if exists "cliente cria estabelecimentos" on estabelecimentos;
create policy "cliente cria estabelecimentos" on estabelecimentos
  for insert to authenticated with check (cliente_id = auth.uid() and public.eh_cliente());
drop policy if exists "cliente altera os proprios estabelecimentos" on estabelecimentos;
create policy "cliente altera os proprios estabelecimentos" on estabelecimentos
  for update to authenticated using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
drop policy if exists "cliente apaga os proprios estabelecimentos" on estabelecimentos;
create policy "cliente apaga os proprios estabelecimentos" on estabelecimentos
  for delete to authenticated using (cliente_id = auth.uid());
grant select, insert, update, delete on estabelecimentos to authenticated;

drop trigger if exists estabelecimentos_touch on estabelecimentos;
create trigger estabelecimentos_touch before update on estabelecimentos for each row execute function clientes_touch();

-- licença -> estabelecimento (se o estabelecimento for apagado, a licença só fica sem estabelecimento)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'licenses_estabelecimento_fk') then
    alter table licenses add constraint licenses_estabelecimento_fk
      foreign key (estabelecimento_id) references estabelecimentos(id) on delete set null;
  end if;
end $$;
create index if not exists licenses_estabelecimento_idx on licenses(estabelecimento_id);

-- Ligar (ou desligar, com p_estabelecimento = null) uma licença do cliente a um estabelecimento dele.
-- Erros: nao_encontrada | estabelecimento_invalido
create or replace function vincular_estabelecimento(p_licenca uuid, p_estabelecimento uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare lic licenses%rowtype;
begin
  select * into lic from licenses where id = p_licenca for update;
  if not found or lic.revoked or not eh_minha_licenca(lic) then raise exception 'nao_encontrada'; end if;
  if p_estabelecimento is not null and not exists
     (select 1 from estabelecimentos e where e.id = p_estabelecimento and e.cliente_id = auth.uid()) then
    raise exception 'estabelecimento_invalido';
  end if;
  update licenses set estabelecimento_id = p_estabelecimento where id = lic.id;
  return true;
end $$;
revoke all on function vincular_estabelecimento(uuid, uuid) from public, anon;
grant execute on function vincular_estabelecimento(uuid, uuid) to authenticated;
