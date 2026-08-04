-- Table principale : une ligne par utilisateur, equivalent du document Firestore links/{uid}.
create table public.user_data (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  items          jsonb not null default '[]'::jsonb,
  category_order jsonb not null default '[]'::jsonb,
  notes_list     jsonb not null default '[]'::jsonb,
  sessions       jsonb not null default '[]'::jsonb,
  events         jsonb not null default '[]'::jsonb,
  time_log       jsonb not null default '[]'::jsonb,
  plan           text not null default 'free' check (plan in ('free', 'pro', 'unlimited', 'admin')),
  updated_at     timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "select own row" on public.user_data
  for select using (auth.uid() = user_id);

create policy "update own row" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime : necessaire pour la synchronisation multi-appareils (equivalent onSnapshot).
alter publication supabase_realtime add table public.user_data;

-- Empeche un utilisateur de s'auto-attribuer un forfait via la console du navigateur :
-- seul le webhook Stripe (qui utilise la service_role key) peut modifier "plan".
create or replace function public.protect_plan_column()
returns trigger
language plpgsql
security definer
as $$
begin
  if auth.role() <> 'service_role' then
    new.plan := old.plan;
  end if;
  return new;
end;
$$;

create trigger protect_plan_before_update
  before update on public.user_data
  for each row execute function public.protect_plan_column();

-- Auto-provisioning admin : cree la ligne de donnees a la creation du compte,
-- et assigne le forfait "admin" aux emails de la liste (equivalent ADMIN_EMAILS).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_emails text[] := array[
    'mathis.schwob@gmail.com',
    'cg.patricia.m@gmail.com',
    'smartech.reparation33@gmail.com',
    'lobbydallas74@gmail.com',
    'maena.girardet@gmail.com'
  ];
  initial_plan text := case when new.email = any(admin_emails) then 'admin' else 'free' end;
begin
  insert into public.user_data (user_id, plan) values (new.id, initial_plan);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
