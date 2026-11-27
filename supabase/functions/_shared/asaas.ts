// Código comum às funções "pagamentos" e "asaas-webhook".
// Segredos (Edge Functions → Secrets): ASAAS_API_KEY (chave de API da Asaas) e ASAAS_WEBHOOK_TOKEN
// (token que a Asaas manda no cabeçalho asaas-access-token). Chave de testes (contém "_hmlg_") usa o
// ambiente sandbox; chave de produção usa a API de verdade.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const KEY = () => Deno.env.get("ASAAS_API_KEY") || "";
export const sandbox = () => KEY().includes("_hmlg_");
const BASE = () => sandbox() ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
export const checkoutUrl = (id: string) => (sandbox() ? "https://sandbox.asaas.com" : "https://asaas.com") + "/checkoutSession/show?id=" + id;

export class AsaasErro extends Error {
  constructor(public status: number, public detalhe: unknown) { super("asaas " + status); }
}
export async function asaas(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(BASE() + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", "User-Agent": "BarFacil-DigitalJew", "access_token": KEY() },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const txt = await r.text();
  let j: any = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = { texto: txt.slice(0, 300) }; }
  if (!r.ok) throw new AsaasErro(r.status, j);
  return j;
}
// mensagem amigável a partir do erro da Asaas (ex.: CPF inválido)
export function motivoAsaas(e: unknown): string {
  if (e instanceof AsaasErro) {
    const d: any = e.detalhe;
    const desc = d && Array.isArray(d.errors) && d.errors[0] && d.errors[0].description;
    if (desc) return String(desc);
  }
  return "Não foi possível falar com a Asaas agora. Tente de novo em instantes.";
}

// ---------- datas (horário de Brasília) ----------
export function hojeBR(): string {
  const d = new Date(Date.now() - 3 * 3600000);
  return d.toISOString().slice(0, 10);
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// vencimento fixo: o dia de hoje (29, 30 e 31 viram 28); o próximo é no mês seguinte
export function diaVencimento(hoje = hojeBR()): number { return Math.min(28, parseInt(hoje.slice(8, 10), 10)); }
export function somaMeses(data: string, n: number, dia?: number): string {
  let y = parseInt(data.slice(0, 4), 10), m = parseInt(data.slice(5, 7), 10) + n;
  while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return ymd(y, m, dia ?? parseInt(data.slice(8, 10), 10));
}
export function primeiroVencimento(hoje = hojeBR()): string { return somaMeses(hoje, 1, diaVencimento(hoje)); }
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
// valor proporcional de um item mensal, de hoje até o próximo vencimento (abaixo de R$ 5,00: cortesia)
export function proporcional(mensal: number, proximoVenc: string, hoje = hojeBR()) {
  const inicio = somaMeses(proximoVenc, -1);
  const ciclo = Math.max(1, diasEntre(inicio, proximoVenc));
  const dias = Math.max(0, Math.min(ciclo, diasEntre(hoje, proximoVenc)));
  const valor = Math.round(mensal * dias / ciclo * 100) / 100;
  return { dias, ciclo, valor, cortesia: valor < 5 };
}
// licença paga vale até o vencimento + 3 dias (tempo para pagar o Pix do mês)
export const validadeAte = (venc: string) => new Date(Date.parse(venc + "T23:59:00-03:00") + 3 * 86400000).toISOString();

// ---------- CPF / CNPJ ----------
export function cpfCnpjValido(v: string): boolean {
  const d = (v || "").replace(/\D/g, "");
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    for (const k of [9, 10]) {
      let s = 0; for (let i = 0; i < k; i++) s += +d[i] * (k + 1 - i);
      const dv = (s * 10) % 11 % 10; if (dv !== +d[k]) return false;
    }
    return true;
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (n: number) => { const w = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      let s = 0; for (let i = 0; i < n; i++) s += +d[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === +d[12] && calc(13) === +d[13];
  }
  return false;
}

// ---------- regras comuns ----------
export async function precos(sb: SupabaseClient): Promise<Record<string, { valor: number; descricao: string }>> {
  const { data } = await sb.from("precos").select("chave, valor, descricao");
  const p: Record<string, { valor: number; descricao: string }> = {};
  (data || []).forEach((r: any) => { p[r.chave] = { valor: Number(r.valor), descricao: r.descricao }; });
  return p;
}
export async function valorMensalidade(sb: SupabaseClient, cliente: string): Promise<number> {
  const { data } = await sb.rpc("valor_mensalidade", { p_cliente: cliente });
  return Number(data || 0);
}
export async function itensMensalidade(sb: SupabaseClient, cliente: string) {
  const { data } = await sb.rpc("itens_mensalidade", { p_cliente: cliente });
  return (data || []).map((i: any) => ({ descricao: i.descricao, valor: Number(i.valor) }));
}

// Deixa a assinatura da Asaas com o valor da mensalidade atual (também as cobranças já geradas e
// ainda não pagas). Sem nada para cobrar, a assinatura é removida.
export async function sincronizarAssinatura(sb: SupabaseClient, cliente: string) {
  const { data: a } = await sb.from("assinaturas_asaas").select("*").eq("cliente_id", cliente).maybeSingle();
  if (!a) return { ok: true, valor: 0, sem_assinatura: true };
  const valor = await valorMensalidade(sb, cliente);
  if (a.status !== "ativa" || !a.asaas_subscription_id) {
    // assinatura removida (ex.: cancelou tudo) e o cliente reverteu: recria por Pix, no mesmo dia de vencimento
    if (valor <= 0) return { ok: true, valor: 0, sem_assinatura: true };
    const { data: cli } = await sb.from("clientes").select("asaas_customer_id").eq("id", cliente).maybeSingle();
    if (!cli || !cli.asaas_customer_id) return { ok: false, valor, motivo: "sem_cliente_asaas" };
    let venc = String(a.proximo_vencimento);
    while (venc <= hojeBR()) venc = somaMeses(venc, 1, a.dia_vencimento);
    const s = await asaas("POST", "/subscriptions", { customer: cli.asaas_customer_id, billingType: "PIX", value: valor, nextDueDate: venc,
      cycle: "MONTHLY", description: "BarFácil — mensalidade", externalReference: "cliente:" + cliente });
    await sb.from("assinaturas_asaas").update({ asaas_subscription_id: s.id, forma: "PIX", proximo_vencimento: venc, valor, status: "ativa",
      atualizado_em: new Date().toISOString() }).eq("cliente_id", cliente);
    return { ok: true, valor, recriada: true, forma_mudou: a.forma !== "PIX" };
  }
  if (valor <= 0) {
    await asaas("DELETE", `/subscriptions/${a.asaas_subscription_id}`);
    await sb.from("assinaturas_asaas").update({ status: "cancelada", valor: 0, atualizado_em: new Date().toISOString() }).eq("cliente_id", cliente);
    return { ok: true, valor: 0, cancelada: true };
  }
  if (Math.abs(valor - Number(a.valor)) > 0.004) {
    await asaas("POST", `/subscriptions/${a.asaas_subscription_id}`, { value: valor, updatePendingPayments: true });
    await sb.from("assinaturas_asaas").update({ valor, atualizado_em: new Date().toISOString() }).eq("cliente_id", cliente);
  }
  return { ok: true, valor };
}

// Aplica uma compra paga (ou cortesia): cria a licença ou soma as vagas de garçom e acerta a mensalidade.
// Pode ser chamada mais de uma vez para o mesmo pedido: só aplica uma vez.
export async function aplicarPedido(sb: SupabaseClient, pedidoId: string, pagamento?: any) {
  const { data: ped } = await sb.from("pedidos").select("*").eq("id", pedidoId).maybeSingle();
  if (!ped) return { ok: false, motivo: "pedido_nao_encontrado" };
  if (ped.status === "pago" || ped.status === "cortesia") return { ok: true, ja_aplicado: true };
  const { data: cli } = await sb.from("clientes").select("id, nome, email, asaas_customer_id").eq("id", ped.cliente_id).single();
  const { data: ass } = await sb.from("assinaturas_asaas").select("*").eq("cliente_id", ped.cliente_id).maybeSingle();
  const assAtiva = ass && ass.status === "ativa" ? ass : null;
  const venc: string = assAtiva ? assAtiva.proximo_vencimento : (ped.dados.proximo_vencimento || primeiroVencimento());
  let licencaId: string | null = null;

  // trava contra dois avisos ao mesmo tempo: marca o pedido antes de criar a licença
  const { data: trava } = await sb.from("pedidos").update({ status: ped.valor > 0 ? "pago" : "cortesia", pago_em: new Date().toISOString() })
    .eq("id", ped.id).eq("status", "aguardando").select("id");
  if (!trava || !trava.length) return { ok: true, ja_aplicado: true };

  if (ped.tipo === "licenca") {
    for (let i = 0; i < 5 && !licencaId; i++) {
      const { data: chave } = await sb.rpc("nova_chave_licenca");
      const { data: l, error } = await sb.from("licenses").insert({
        license_key: chave, platform: ped.dados.plataforma, tier: ped.dados.plano === "premium" ? "premium" : "basic",
        customer_name: cli?.nome || null, customer_contact: cli?.email || null, cliente_id: ped.cliente_id,
        estabelecimento_id: ped.dados.estabelecimento_id || null, max_activations: 1, cobranca_asaas: true,
        expires_at: validadeAte(venc),
      }).select("id").single();
      if (!error) licencaId = l.id; else if (!String(error.message).includes("duplicate")) throw error;
    }
    await sb.from("pedidos").update({ licenca_id: licencaId }).eq("id", ped.id);
  } else {
    const { data: lic } = await sb.from("licenses").select("id, aux_vagas").eq("id", ped.dados.licenca_id).single();
    await sb.from("licenses").update({ aux_vagas: (lic?.aux_vagas || 0) + (ped.dados.quantidade || 1) }).eq("id", ped.dados.licenca_id);
  }

  if (pagamento && pagamento.id) {
    await sb.from("faturas").upsert({
      asaas_payment_id: pagamento.id, cliente_id: ped.cliente_id, pedido_id: ped.id, descricao: ped.descricao,
      valor: Number(pagamento.value ?? ped.valor), vencimento: pagamento.dueDate || null, status: "paga",
      forma: pagamento.billingType || ped.forma, pago_em: new Date().toISOString(), link: pagamento.invoiceUrl || null,
    });
  }

  // mensalidade: cria a assinatura (1ª compra por Pix) ou acerta o valor da que já existe
  if (!assAtiva) {
    const valor = await valorMensalidade(sb, ped.cliente_id);
    if (pagamento && pagamento.subscription) {
      // cartão: o Checkout da Asaas já criou a assinatura
      const s = await asaas("GET", `/subscriptions/${pagamento.subscription}`);
      const pago = String(pagamento.dueDate || hojeBR()).slice(0, 10);
      const prox = somaMeses(pago, 1, Math.min(28, parseInt(pago.slice(8, 10), 10)));
      await sb.from("assinaturas_asaas").upsert({ cliente_id: ped.cliente_id, asaas_subscription_id: pagamento.subscription, forma: "CREDIT_CARD",
        dia_vencimento: Math.min(28, parseInt(prox.slice(8, 10), 10)), proximo_vencimento: prox, valor: Number(s.value || 0), status: "ativa",
        atualizado_em: new Date().toISOString() });
      if (licencaId) await sb.from("licenses").update({ expires_at: validadeAte(prox) }).eq("id", licencaId);
      await sincronizarAssinatura(sb, ped.cliente_id);
    } else if (valor > 0 && cli?.asaas_customer_id) {
      const s = await asaas("POST", "/subscriptions", {
        customer: cli.asaas_customer_id, billingType: "PIX", value: valor, nextDueDate: venc, cycle: "MONTHLY",
        description: "BarFácil — mensalidade", externalReference: "cliente:" + ped.cliente_id,
      });
      await sb.from("assinaturas_asaas").upsert({ cliente_id: ped.cliente_id, asaas_subscription_id: s.id, forma: "PIX",
        dia_vencimento: parseInt(venc.slice(8, 10), 10), proximo_vencimento: venc, valor, status: "ativa", atualizado_em: new Date().toISOString() });
    }
  } else {
    await sincronizarAssinatura(sb, ped.cliente_id);
  }
  return { ok: true, licenca_id: licencaId };
}
