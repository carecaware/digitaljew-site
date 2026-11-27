// Edge Function: asaas-webhook — recebe os avisos (webhooks) da Asaas.
// A Asaas manda o token configurado no cabeçalho "asaas-access-token"; ele precisa bater com o segredo
// ASAAS_WEBHOOK_TOKEN. Cada aviso tem um id e é processado uma vez só (tabela asaas_eventos).
//
//  PAYMENT_CONFIRMED / PAYMENT_RECEIVED:
//    - compra feita na área do cliente (externalReference "pedido:<id>") -> cria a licença ou soma as vagas
//      de garçom e acerta a mensalidade;
//    - cartão (1ª compra pelo Checkout): a cobrança vem da assinatura criada pelo Checkout -> idem;
//    - mensalidade -> registra a fatura paga, avança o vencimento e renova a validade das licenças.
//  PAYMENT_OVERDUE / PAYMENT_REFUNDED / PAYMENT_DELETED -> atualiza a fatura (a licença vence sozinha).
//  CHECKOUT_EXPIRED / CHECKOUT_CANCELED -> marca o pedido.
//
// Implantação: supabase functions deploy asaas-webhook --no-verify-jwt
import { admin, asaas, json, cors, aplicarPedido, itensMensalidade, validadeAte, somaMeses } from "../_shared/asaas.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const esperado = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  if (!esperado || req.headers.get("asaas-access-token") !== esperado) return json({ ok: false }, 401);
  const sb = admin();
  const ev = await req.json().catch(() => null);
  if (!ev || !ev.id || !ev.event) return json({ ok: true, ignorado: true });

  const { error: dup } = await sb.from("asaas_eventos").insert({ id: String(ev.id), evento: ev.event, payload: ev });
  if (dup) {
    const { data: ja } = await sb.from("asaas_eventos").select("processado_em").eq("id", String(ev.id)).maybeSingle();
    if (ja && ja.processado_em) return json({ ok: true, repetido: true });
  }
  try {
    await processar(sb, ev);
    await sb.from("asaas_eventos").update({ processado_em: new Date().toISOString(), erro: null }).eq("id", String(ev.id));
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    await sb.from("asaas_eventos").update({ erro: String((e as Error).message || e).slice(0, 500) }).eq("id", String(ev.id));
    return json({ ok: false }, 500);   // a Asaas tenta de novo
  }
});

async function pedidoDoPagamento(sb: any, p: any) {
  const ref = String(p.externalReference || "");
  if (ref.startsWith("pedido:")) return ref.slice(7);
  // cartão: cobrança gerada pelo Checkout (a referência fica no Checkout); acha o pedido pelo cliente
  if (p.subscription && p.customer) {
    const { data: cli } = await sb.from("clientes").select("id").eq("asaas_customer_id", p.customer).maybeSingle();
    if (cli) {
      const { data: ass } = await sb.from("assinaturas_asaas").select("asaas_subscription_id").eq("cliente_id", cli.id).maybeSingle();
      if (ass && ass.asaas_subscription_id === p.subscription) return null;   // mensalidade normal
      const { data: ped } = await sb.from("pedidos").select("id").eq("cliente_id", cli.id).eq("status", "aguardando")
        .eq("forma", "CREDIT_CARD").not("asaas_checkout_id", "is", null).order("criado_em", { ascending: false }).limit(1);
      if (ped && ped.length) return ped[0].id;
    }
  }
  return null;
}

async function processar(sb: any, ev: any) {
  const tipo = String(ev.event);
  if (tipo === "CHECKOUT_EXPIRED" || tipo === "CHECKOUT_CANCELED") {
    const id = ev.checkout && ev.checkout.id;
    if (id) await sb.from("pedidos").update({ status: tipo === "CHECKOUT_EXPIRED" ? "expirado" : "cancelado" }).eq("asaas_checkout_id", id).eq("status", "aguardando");
    return;
  }
  if (tipo === "CHECKOUT_PAID") {
    // cartão pela página da Asaas: liga o pedido ao cliente e à cobrança (e à assinatura) criados por ela
    const co = ev.checkout || {};
    const { data: ped } = await sb.from("pedidos").select("id, cliente_id, status").eq("asaas_checkout_id", co.id).maybeSingle();
    if (!ped || ped.status !== "aguardando") return;
    let customer = co.customer;
    if (!customer) {
      const { data: cli } = await sb.from("clientes").select("asaas_customer_id").eq("id", ped.cliente_id).single();
      const antigo = cli && cli.asaas_customer_id ? await asaas("GET", `/customers/${cli.asaas_customer_id}`) : null;
      if (antigo && antigo.cpfCnpj) {
        const l = await asaas("GET", `/customers?cpfCnpj=${antigo.cpfCnpj}&limit=10`);
        const novos = (l.data || []).sort((a: any, b: any) => String(b.dateCreated).localeCompare(String(a.dateCreated)));
        if (novos[0]) customer = novos[0].id;
      }
    }
    if (!customer) throw new Error("checkout pago sem cliente identificado");
    await sb.from("clientes").update({ asaas_customer_id: customer }).eq("id", ped.cliente_id);
    const pgs = await asaas("GET", `/payments?customer=${customer}&limit=20`);
    const pago = (pgs.data || []).filter((x: any) => ["CONFIRMED", "RECEIVED"].includes(x.status))
      .sort((a: any, b: any) => String(b.dateCreated).localeCompare(String(a.dateCreated)))[0];
    if (!pago) throw new Error("checkout pago sem cobrança confirmada ainda");   // a Asaas reenvia
    await aplicarPedido(sb, ped.id, pago);
    return;
  }
  const p = ev.payment;
  if (!p || !p.id) return;
  const statusFatura: Record<string, string> = { PAYMENT_OVERDUE: "vencida", PAYMENT_REFUNDED: "estornada", PAYMENT_DELETED: "removida",
    PAYMENT_CREATED: "pendente", PAYMENT_UPDATED: "pendente" };

  if (tipo === "PAYMENT_CONFIRMED" || tipo === "PAYMENT_RECEIVED" || tipo === "PAYMENT_RECEIVED_IN_CASH") {
    const pedidoId = await pedidoDoPagamento(sb, p);
    if (pedidoId) { await aplicarPedido(sb, pedidoId, p); return; }
    if (!p.subscription) return;
    // mensalidade paga
    const { data: ass } = await sb.from("assinaturas_asaas").select("*").eq("asaas_subscription_id", p.subscription).maybeSingle();
    if (!ass) return;
    const { data: jaPaga } = await sb.from("faturas").select("status").eq("asaas_payment_id", p.id).maybeSingle();
    if (jaPaga && jaPaga.status === "paga") return;
    const itens = await itensMensalidade(sb, ass.cliente_id);
    await sb.from("faturas").upsert({ asaas_payment_id: p.id, cliente_id: ass.cliente_id, descricao: "Mensalidade BarFácil",
      valor: Number(p.value), vencimento: p.dueDate || null, status: "paga", forma: p.billingType, pago_em: new Date().toISOString(),
      link: p.invoiceUrl || null, itens });
    // próximo vencimento = vencimento desta cobrança + 1 mês, no dia fixo do cliente
    // (a "nextDueDate" da Asaas já pula para a frente quando ela gera a cobrança do mês, por isso não serve aqui)
    const venc = String(p.dueDate || ass.proximo_vencimento).slice(0, 10);
    let prox = somaMeses(venc, 1, ass.dia_vencimento);
    if (prox < ass.proximo_vencimento) prox = ass.proximo_vencimento;
    await sb.from("assinaturas_asaas").update({ proximo_vencimento: prox, atualizado_em: new Date().toISOString() }).eq("cliente_id", ass.cliente_id);
    await sb.from("licenses").update({ expires_at: validadeAte(prox) })
      .eq("cliente_id", ass.cliente_id).eq("cobranca_asaas", true).eq("revoked", false).is("cancelada_ate", null);
    return;
  }

  if (statusFatura[tipo]) {
    const { data: ass } = p.subscription ? await sb.from("assinaturas_asaas").select("cliente_id").eq("asaas_subscription_id", p.subscription).maybeSingle() : { data: null };
    const pedidoId = String(p.externalReference || "").startsWith("pedido:") ? String(p.externalReference).slice(7) : null;
    const { data: ped } = pedidoId ? await sb.from("pedidos").select("cliente_id, descricao").eq("id", pedidoId).maybeSingle() : { data: null };
    const cliente = (ass && ass.cliente_id) || (ped && ped.cliente_id);
    if (!cliente) return;
    const { data: atual } = await sb.from("faturas").select("status").eq("asaas_payment_id", p.id).maybeSingle();
    if (atual && atual.status === "paga" && statusFatura[tipo] === "pendente") return;
    await sb.from("faturas").upsert({ asaas_payment_id: p.id, cliente_id: cliente, pedido_id: pedidoId, descricao: ped ? ped.descricao : "Mensalidade BarFácil",
      valor: Number(p.value), vencimento: p.dueDate || null, status: statusFatura[tipo], forma: p.billingType, link: p.invoiceUrl || null });
    if (pedidoId && (tipo === "PAYMENT_DELETED")) await sb.from("pedidos").update({ status: "cancelado" }).eq("id", pedidoId).eq("status", "aguardando");
  }
}
