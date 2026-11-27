// Edge Function: pagamentos — chamada pela área do cliente (precisa do login do cliente).
//
//   { acao: "iniciar", tipo: "licenca", plano: "basica"|"premium", plataforma: "windows"|"mobile",
//     estabelecimento_id, forma: "PIX"|"CREDIT_CARD", cpf_cnpj?, voltar? }
//   { acao: "iniciar", tipo: "garcom", licenca_id, quantidade, forma, cpf_cnpj?, voltar? }
//      -> { ok, pedido_id, valor, cortesia?, pix?: { payload, imagem, expira }, link?, precisa_cpf? }
//   { acao: "status", pedido_id }   -> { ok, status, licenca_id }
//   { acao: "sincronizar" }         -> acerta o valor da mensalidade na Asaas (depois de cancelar/reverter)
//   { acao: "cancelar_pedido", pedido_id } -> desiste de um Pix ainda não pago
//
// Erros: { ok: false, motivo, mensagem }. Implantação: supabase functions deploy pagamentos
import {
  admin, asaas, AsaasErro, motivoAsaas, cors, json, checkoutUrl, precos, valorMensalidade, sincronizarAssinatura,
  aplicarPedido, cpfCnpjValido, hojeBR, primeiroVencimento, proporcional,
} from "../_shared/asaas.ts";

const NOME_PLAT: Record<string, string> = { windows: "Windows", mobile: "Android" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    const user = u && u.user;
    if (!user) return json({ ok: false, motivo: "sem_login", mensagem: "Entre na sua conta para continuar." }, 401);
    const body = await req.json().catch(() => ({}));
    const acao = String(body.acao || "");

    if (acao === "status") {
      const { data: p } = await sb.from("pedidos").select("status, licenca_id").eq("id", body.pedido_id).eq("cliente_id", user.id).maybeSingle();
      if (!p) return json({ ok: false, motivo: "nao_encontrado" });
      return json({ ok: true, status: p.status, licenca_id: p.licenca_id });
    }
    if (acao === "sincronizar") return json(await sincronizarAssinatura(sb, user.id));
    if (acao === "cancelar_pedido") {
      const { data: p } = await sb.from("pedidos").select("*").eq("id", body.pedido_id).eq("cliente_id", user.id).maybeSingle();
      if (!p || p.status !== "aguardando") return json({ ok: true });
      try { if (p.asaas_payment_id) await asaas("DELETE", `/payments/${p.asaas_payment_id}`); } catch (_e) { /* já paga ou removida */ }
      try { if (p.asaas_checkout_id) await asaas("POST", `/checkouts/${p.asaas_checkout_id}/cancel`); } catch (_e) { /* idem */ }
      await sb.from("pedidos").update({ status: "cancelado" }).eq("id", p.id).eq("status", "aguardando");
      return json({ ok: true });
    }
    if (acao !== "iniciar") return json({ ok: false, motivo: "acao_invalida" }, 400);

    // ---------- iniciar uma compra ----------
    const forma = body.forma === "CREDIT_CARD" ? "CREDIT_CARD" : "PIX";
    const { data: cli } = await sb.from("clientes").select("id, nome, email, whatsapp, asaas_customer_id").eq("id", user.id).maybeSingle();
    if (!cli) return json({ ok: false, motivo: "sem_cadastro", mensagem: "Complete o seu cadastro antes de comprar." });
    const P = await precos(sb);
    let tipo = body.tipo === "garcom" ? "garcom" : "licenca", dados: any, descricao: string, mensal: number;
    if (tipo === "licenca") {
      const plano = body.plano === "premium" ? "premium" : "basica", plataforma = body.plataforma === "mobile" ? "mobile" : "windows";
      const { data: est } = await sb.from("estabelecimentos").select("id, titulo").eq("id", body.estabelecimento_id).eq("cliente_id", user.id).maybeSingle();
      if (!est) return json({ ok: false, motivo: "estabelecimento", mensagem: "Escolha um dos seus estabelecimentos." });
      dados = { plano, plataforma, estabelecimento_id: est.id };
      descricao = `${P[plano].descricao} · ${NOME_PLAT[plataforma]} · ${est.titulo}`;
      mensal = P[plano].valor;
    } else {
      const qtd = Math.max(1, Math.min(10, parseInt(body.quantidade, 10) || 1));
      const { data: lic } = await sb.from("licenses").select("id, license_key, cliente_id, cobranca_asaas, revoked, cancelada_ate, expires_at")
        .eq("id", body.licenca_id).maybeSingle();
      if (!lic || lic.cliente_id !== user.id || lic.revoked) return json({ ok: false, motivo: "licenca", mensagem: "Licença não encontrada." });
      if (lic.cancelada_ate || (lic.expires_at && Date.parse(lic.expires_at) < Date.now()))
        return json({ ok: false, motivo: "licenca", mensagem: "Esta licença está cancelada ou vencida." });
      if (!lic.cobranca_asaas)
        return json({ ok: false, motivo: "licenca_manual", mensagem: "Esta licença não é cobrada pelo site. Fale com a gente pelo WhatsApp para adicionar aparelhos." });
      dados = { licenca_id: lic.id, quantidade: qtd };
      descricao = `${qtd} aparelho${qtd > 1 ? "s" : ""} de garçom · licença •••• ${String(lic.license_key).slice(-4)}`;
      mensal = P.garcom.valor * qtd;
    }

    // cliente na Asaas (o CPF/CNPJ é pedido só na primeira compra)
    let customer = cli.asaas_customer_id;
    if (!customer) {
      const doc = String(body.cpf_cnpj || "").replace(/\D/g, "");
      if (!doc) return json({ ok: false, motivo: "precisa_cpf", precisa_cpf: true, mensagem: "Informe o CPF ou CNPJ de quem paga." });
      if (!cpfCnpjValido(doc)) return json({ ok: false, motivo: "cpf_invalido", precisa_cpf: true, mensagem: "CPF ou CNPJ inválido. Confira os números." });
      const fone = String(cli.whatsapp || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      const c = await asaas("POST", "/customers", { name: cli.nome || cli.email, email: cli.email, cpfCnpj: doc,
        mobilePhone: fone || undefined, externalReference: "cliente:" + cli.id, notificationDisabled: false });
      customer = c.id;
      await sb.from("clientes").update({ asaas_customer_id: customer }).eq("id", cli.id);
    }

    // valor de agora: 1ª compra paga o mês inteiro; as seguintes, só os dias até o vencimento
    const { data: ass } = await sb.from("assinaturas_asaas").select("*").eq("cliente_id", user.id).eq("status", "ativa").maybeSingle();
    let valor = mensal, proximo = primeiroVencimento(), cortesia = false, dias: number | null = null;
    if (ass) {
      const pr = proporcional(mensal, ass.proximo_vencimento);
      proximo = ass.proximo_vencimento; dias = pr.dias; valor = pr.cortesia ? 0 : pr.valor; cortesia = pr.cortesia;
    }
    dados.proximo_vencimento = proximo;
    const { data: ped, error: e1 } = await sb.from("pedidos").insert({
      cliente_id: user.id, tipo, dados, descricao, valor, valor_mensal: mensal, forma,
    }).select("id").single();
    if (e1) throw e1;

    if (cortesia || valor <= 0) {
      await aplicarPedido(sb, ped.id);
      return json({ ok: true, pedido_id: ped.id, valor: 0, cortesia: true, dias, mensal, proximo_vencimento: proximo });
    }

    const ref = "pedido:" + ped.id;
    if (forma === "PIX") {
      const pg = await asaas("POST", "/payments", { customer, billingType: "PIX", value: valor, dueDate: hojeBR(),
        description: descricao + (ass ? ` (proporcional: ${dias} dias)` : ""), externalReference: ref });
      await sb.from("pedidos").update({ asaas_payment_id: pg.id }).eq("id", ped.id);
      let pix: any = null;
      try { const q = await asaas("GET", `/payments/${pg.id}/pixQrCode`); pix = { payload: q.payload, imagem: q.encodedImage, expira: q.expirationDate }; }
      catch (_e) { pix = null; } // sem QR (ex.: chave Pix ainda não ativa): o cliente paga pela página da cobrança
      return json({ ok: true, pedido_id: ped.id, valor, dias, mensal, proximo_vencimento: proximo, pix, link: pg.invoiceUrl });
    }

    // cartão: página de pagamento da própria Asaas (o cartão não passa por aqui)
    const voltar = /^https?:\/\//.test(String(body.voltar || "")) ? String(body.voltar) : (Deno.env.get("SITE_URL") || "https://www.asaas.com");
    const base = voltar.split("#")[0].split("?")[0];
    const co: any = {
      billingTypes: ["CREDIT_CARD"], chargeTypes: [ass ? "DETACHED" : "RECURRENT"], minutesToExpire: 60,
      externalReference: ref, customer,
      callback: { successUrl: base + "?pagamento=ok#assinatura", cancelUrl: base + "?pagamento=cancelado#assinatura", expiredUrl: base + "?pagamento=expirado#assinatura" },
      items: [{ name: (tipo === "licenca" ? P[dados.plano].descricao : "Aparelho de garçom").slice(0, 30), description: descricao + (ass ? ` (proporcional: ${dias} dias)` : " (1ª mensalidade)"), quantity: 1, value: valor }],
    };
    if (!ass) co.subscription = { cycle: "MONTHLY", nextDueDate: hojeBR() + " 12:00:00" };
    // a Asaas exige endereço para cartão: sem endereço cadastrado, o cliente preenche os dados na página dela
    // (o aviso de "checkout pago" liga o cliente criado lá a esta conta)
    const cus = await asaas("GET", `/customers/${customer}`);
    if (!(cus && cus.postalCode && cus.address)) delete co.customer;
    const c = await asaas("POST", "/checkouts", co);
    await sb.from("pedidos").update({ asaas_checkout_id: c.id }).eq("id", ped.id);
    return json({ ok: true, pedido_id: ped.id, valor, dias, mensal, proximo_vencimento: proximo, link: c.link || checkoutUrl(c.id) });
  } catch (e) {
    console.error(e instanceof AsaasErro ? JSON.stringify(e.detalhe) : e);
    return json({ ok: false, motivo: "erro", mensagem: motivoAsaas(e) });
  }
});
