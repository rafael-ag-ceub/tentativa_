-- =====================================================================
-- PORTFY · Lembretes de tarefas por e-mail
-- Rode DEPOIS da migração inicial. É idempotente.
--   email_log            evita enviar o mesmo lembrete duas vezes no dia
--   due_task_reminders() lista quem deve receber e quais tarefas vencem
-- Ambos são usados SOMENTE pela Edge Function send-reminders (service role).
-- =====================================================================
create table if not exists public.email_log (
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null,
  day      date not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.email_log enable row level security;   -- sem policies: o navegador não acessa
revoke all on public.email_log from anon, authenticated;

create or replace function public.due_task_reminders(p_day date)
returns table (user_id uuid, email text, full_name text, titles text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, array_agg(t.title order by t.created_at)
  from public.profiles p
  join public.user_settings s on s.user_id = p.id and s.email_notifications
  join public.tasks t on t.user_id = p.id and not t.done and t.due_date <= p_day
  where p.email is not null
    and not exists (select 1 from public.email_log l
                    where l.user_id = p.id and l.kind = 'task_reminder' and l.day = p_day)
  group by p.id, p.email, p.full_name;
$$;
revoke all on function public.due_task_reminders(date) from public, anon, authenticated;
grant execute on function public.due_task_reminders(date) to service_role;
