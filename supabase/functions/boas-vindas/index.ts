// Edge Function: boas-vindas
// Envia o e-mail de boas-vindas UMA vez, para o cliente logado que acabou de concluir o cadastro.
// O site chama esta função logo depois de salvar o cadastro; se ela falhar, o cadastro continua valendo.
//
// Resposta: { ok: true } | { ok: true, ja_enviado: true }
//           { ok: false, motivo }  nao_autenticado | sem_cadastro | nao_configurado | falha_envio
//
// Segredos (Supabase -> Edge Functions -> Secrets):
//   BREVO_API_KEY     chave da API do Brevo (Brevo -> SMTP & API -> API Keys)
//   EMAIL_REMETENTE   e-mail remetente já verificado no Brevo
//   SITE_URL          opcional: endereço público do site (para o botão "Baixar o BarFácil")
// Implantação:  supabase functions deploy boas-vindas --no-verify-jwt
// Depende da coluna clientes.boas_vindas_em (supabase/clientes.sql).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { boasVindas } from "./modelo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false },
    });
    const { data: u, error: eu } = await usuario.auth.getUser();
    if (eu || !u?.user) return json({ ok: false, motivo: "nao_autenticado" }, 401);

    const apiKey = Deno.env.get("BREVO_API_KEY"), remetente = Deno.env.get("EMAIL_REMETENTE");
    if (!apiKey || !remetente) return json({ ok: false, motivo: "nao_configurado" });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    // marca ANTES de enviar (evita dois e-mails se a função for chamada duas vezes ao mesmo tempo)
    const { data: marcado, error: em } = await admin.from("clientes")
      .update({ boas_vindas_em: new Date().toISOString() })
      .eq("id", u.user.id).is("boas_vindas_em", null)
      .select("nome, email");
    if (em) { console.error("clientes", em.message); return json({ ok: false, motivo: "nao_configurado" }, 500); }
    if (!marcado || !marcado.length) {
      const { data: existe } = await admin.from("clientes").select("id").eq("id", u.user.id).maybeSingle();
      return existe ? json({ ok: true, ja_enviado: true }) : json({ ok: false, motivo: "sem_cadastro" }, 403);
    }

    const cli = marcado[0];
    const para = cli.email || u.user.email;
    const { assunto, html, texto } = boasVindas({ nome: cli.nome, siteUrl: Deno.env.get("SITE_URL") });
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "DigitalJew Software", email: remetente },
        to: [{ email: para, name: cli.nome }],
        replyTo: { email: remetente, name: "DigitalJew Software" },
        subject: assunto, htmlContent: html, textContent: texto,
        tags: ["boas-vindas"],
      }),
    });
    if (!r.ok) {
      console.error("brevo", r.status, await r.text());
      // desfaz a marca para poder tentar de novo depois
      await admin.from("clientes").update({ boas_vindas_em: null }).eq("id", u.user.id);
      return json({ ok: false, motivo: "falha_envio" }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, motivo: "falha_envio" }, 500);
  }
});
