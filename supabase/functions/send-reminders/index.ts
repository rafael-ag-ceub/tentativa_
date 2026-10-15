// =====================================================================
// PORTFY · supabase/functions/send-reminders/index.ts
// Camada: CONTROLLER. Envia o lembrete diário de tarefas por e-mail.
// Quem chama é um agendador (Cron), com o cabeçalho x-cron-secret.
//
// Deploy:  npx supabase functions deploy send-reminders --no-verify-jwt
//          (sem verificação de login, porque o agendador não é um usuário;
//           a proteção é o segredo CRON_SECRET abaixo)
// Secrets: RESEND_API_KEY, MAIL_FROM, CRON_SECRET, SITE_URL
// =====================================================================
import { json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/clients.ts'
import { sendMail } from '../_shared/mail.service.ts'
import { reminderEmail } from '../_shared/reminder.template.ts'

type Reminder = { user_id: string; email: string; full_name: string; titles: string[] }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  // 1. Só o agendador pode chamar
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Não autorizado.' }, 401)

  try {
    const admin = adminClient()
    const day = new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' }) // AAAA-MM-DD em Brasília

    // 2. Quem deve receber hoje (respeita a opção Notificações por e-mail e evita duplicados)
    const { data, error } = await admin.rpc('due_task_reminders', { p_day: day })
    if (error) throw error
    const siteUrl = Deno.env.get('SITE_URL') ?? ''

    // 3. Envia um por um e registra cada envio
    let sent = 0, failed = 0
    for (const r of (data ?? []) as Reminder[]) {
      try {
        await sendMail({ to: r.email, ...reminderEmail(r.full_name, r.titles, siteUrl) })
        await admin.from('email_log').insert({ user_id: r.user_id, kind: 'task_reminder', day })
        sent++
      } catch (e) {
        console.error('Falha para', r.user_id, e)
        failed++
      }
    }
    return json({ day, sent, failed })
  } catch (err) {
    console.error(err)
    return json({ error: 'Erro interno.' }, 500)
  }
})
