/* Área interna do cliente: assinatura, dados de pagamento e meus dados.
 * Só abre para quem está logado; o login fica guardado até o cliente clicar em "Sair" (ver conta.js). */
(() => {
  const { cfg, sb, digits, maskPhone, phoneE164, validPhone, msg, busy } = window.DJ;
  const $ = id => document.getElementById(id);
  const ENTRAR = 'cadastro.html#entrar';
  let user = null, saindo = false;

  const PLANOS = { teste: 'Teste', basica: 'Básica', premium: 'Premium' };
  const PLATAFORMAS = { windows: 'Windows (computador)', mobile: 'Mobile (celular Android)' };
  const STATUS = { ativa: 'Ativa', teste: 'Em teste', atrasada: 'Pagamento pendente', cancelada: 'Cancelada' };
  const dataLonga = d => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));
  const reais = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- telas (menu) ---------- */
  function mostrarView(nome) {
    if (!document.querySelector(`.area-view[data-view="${nome}"]`)) nome = 'assinatura';
    document.querySelectorAll('.area-view').forEach(v => { v.hidden = v.dataset.view !== nome; });
    document.querySelectorAll('.area-nav [data-view]').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === nome));
  }
  function rota() {
    const h = location.hash.slice(1);
    if (h === 'pagamento') { mostrarView('assinatura'); abrirPagamento(); }
    else { fecharPagamento(true); mostrarView(h || 'assinatura'); }
  }
  window.addEventListener('hashchange', rota);

  /* ---------- assinatura ---------- */
  function cardAssinatura(a) {
    const plano = PLANOS[a.plano] || a.plano;
    const status = STATUS[a.status] || a.status || '';
    const emTeste = a.plano === 'teste';
    const dataRotulo = emTeste ? 'Fim do teste' : 'Próxima cobrança';
    const dataValor = emTeste ? a.teste_termina_em : a.proxima_cobranca;
    return `<article class="plan-card plan-${esc(a.plano)}">
      <div class="plan-top"><span class="plan-label">PLANO ATUAL</span>${status ? `<span class="plan-status status-${esc(a.status)}">${esc(status)}</span>` : ''}</div>
      <h2>BarFácil <span>${esc(plano)}</span></h2>
      <dl class="plan-meta">
        <div><dt>Versão do app</dt><dd>${esc(PLATAFORMAS[a.plataforma] || a.plataforma || '—')}</dd></div>
        <div><dt>${dataRotulo}</dt><dd>${dataValor ? esc(dataLonga(dataValor)) : '—'}</dd></div>
        <div><dt>Valor mensal</dt><dd>${a.valor_mensal != null && !emTeste ? esc(reais(a.valor_mensal)) : emTeste ? 'Grátis durante o teste' : '—'}</dd></div>
      </dl>
    </article>`;
  }

  async function carregarAssinaturas() {
    const { data, error } = await sb.from('assinaturas')
      .select('plano, plataforma, status, proxima_cobranca, teste_termina_em, valor_mensal')
      .order('created_at', { ascending: true });
    if (error) { console.error(error); return msg($('erro-assinatura'), 'Não foi possível carregar sua assinatura agora. Recarregue a página em instantes.'); }
    const ativas = (data || []).filter(a => a.status !== 'cancelada');
    $('assinaturas').innerHTML = ativas.map(cardAssinatura).join('');
    $('sem-assinatura').hidden = ativas.length > 0;
  }

  /* ---------- meus dados ---------- */
  async function carregarPerfil() {
    const { data } = await sb.from('clientes').select('nome, email, whatsapp').eq('id', user.id).maybeSingle();
    const m = user.user_metadata || {};
    const nome = (data && data.nome) || m.full_name || m.nome || '';
    $('usuario-nome').textContent = nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!';
    $('usuario-email').textContent = user.email || (data && data.email) || '';
    const f = $('form-perfil');
    f.nome.value = nome;
    f.email.value = user.email || (data && data.email) || '';
    f.whatsapp.value = maskPhone((data && data.whatsapp) || m.whatsapp || '');
    return !!data;
  }

  $('form-perfil').whatsapp.addEventListener('input', e => { e.target.value = maskPhone(e.target.value); });
  $('form-perfil').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = $('erro-perfil'), ok = $('ok-perfil');
    msg(ok, '');
    const nome = f.nome.value.trim();
    if (nome.length < 3) return msg(err, 'Digite seu nome completo.');
    if (!validPhone(f.whatsapp.value)) return msg(err, 'Digite um WhatsApp válido, com DDD.');
    msg(err, '');
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    const { error } = await sb.from('clientes').update({ nome, whatsapp: phoneE164(f.whatsapp.value) }).eq('id', user.id);
    busy(btn, false);
    if (error) return msg(err, 'Não foi possível salvar agora. Tente de novo.');
    $('usuario-nome').textContent = `Olá, ${nome.split(' ')[0]}!`;
    msg(ok, 'Dados atualizados.');
  });

  /* ---------- painel de pagamento (desliza da direita) ---------- */
  const drawer = $('pagamento'), fundo = $('pagamento-fundo');
  let voltarFoco = null;
  function abrirPagamento() {
    if (!drawer.hidden && drawer.classList.contains('open')) return;
    voltarFoco = document.activeElement;
    drawer.hidden = false; fundo.hidden = false;
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => { drawer.classList.add('open'); fundo.classList.add('open'); });
    setTimeout(() => $('form-cartao').numero.focus({ preventScroll: true }), 50);
  }
  function fecharPagamento(semHistorico) {
    if (drawer.hidden) return;
    drawer.classList.remove('open'); fundo.classList.remove('open');
    document.body.classList.remove('no-scroll');
    setTimeout(() => { drawer.hidden = true; fundo.hidden = true; }, 320);
    if (!semHistorico && location.hash === '#pagamento') history.replaceState(null, '', location.pathname + '#assinatura');
    if (voltarFoco) voltarFoco.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-abrir-pagamento]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); history.replaceState(null, '', '#pagamento'); abrirPagamento();
  }));
  $('pagamento-fechar').addEventListener('click', () => fecharPagamento());
  fundo.addEventListener('click', () => fecharPagamento());
  document.addEventListener('keydown', e => {
    if (drawer.hidden) return;
    if (e.key === 'Escape') return fecharPagamento();
    if (e.key === 'Tab') { // mantém o foco dentro do painel
      const f = [...drawer.querySelectorAll('button, input, a[href]')].filter(x => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- formulário do cartão (integração com a operadora: depois) ---------- */
  const BANDEIRAS = [
    ['Elo', /^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/],
    ['Hipercard', /^(606282|3841)/],
    ['American Express', /^3[47]/],
    ['Diners', /^3(0[0-5]|[68])/],
    ['Visa', /^4/],
    ['Mastercard', /^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/]
  ];
  const bandeira = n => (BANDEIRAS.find(([, r]) => r.test(n)) || [''])[0];
  function luhn(n) { let s = 0, dbl = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (dbl) { d *= 2; if (d > 9) d -= 9; } s += d; dbl = !dbl; } return s % 10 === 0; }
  function cpfValido(c) {
    if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
    const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +c[9] && dv(10) === +c[10];
  }
  const fc = $('form-cartao');
  fc.numero.addEventListener('input', () => {
    const n = digits(fc.numero.value).slice(0, 19), b = bandeira(n);
    fc.numero.value = b === 'American Express' ? n.replace(/^(\d{4})(\d{0,6})(\d{0,5}).*/, (m, a, b2, c) => [a, b2, c].filter(Boolean).join(' ')) : n.replace(/(\d{4})(?=\d)/g, '$1 ');
    $('bandeira').textContent = b;
    fc.cvv.maxLength = b === 'American Express' ? 4 : 3;
  });
  fc.validade.addEventListener('input', () => { const d = digits(fc.validade.value).slice(0, 4); fc.validade.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; });
  fc.cvv.addEventListener('input', () => { fc.cvv.value = digits(fc.cvv.value); });
  fc.cpf.addEventListener('input', () => {
    const d = digits(fc.cpf.value).slice(0, 11);
    fc.cpf.value = d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  });

  function validarCartao() {
    const n = digits(fc.numero.value), b = bandeira(n);
    if (n.length < 13 || !luhn(n)) return ['numero', 'Número do cartão inválido. Confira os dígitos.'];
    if (fc.nome.value.trim().length < 3) return ['nome', 'Digite o nome como está impresso no cartão.'];
    const [mm, aa] = fc.validade.value.split('/').map(Number);
    const fim = new Date(2000 + (aa || 0), mm || 0, 1); // primeiro dia do mês seguinte
    if (!mm || mm > 12 || !aa || fim <= new Date()) return ['validade', 'Validade inválida ou cartão vencido.'];
    if (!new RegExp(b === 'American Express' ? '^\\d{4}$' : '^\\d{3}$').test(fc.cvv.value)) return ['cvv', 'CVV inválido.'];
    if (!cpfValido(digits(fc.cpf.value))) return ['cpf', 'CPF do titular inválido.'];
    return null;
  }

  /* Ponto de integração: troque por chamada ao SDK da operadora (tokenização) quando estiver pronta. */
  async function salvarCartao(dados) {
    const integ = cfg.payments || {};
    if (!integ.ready) throw { naoIntegrado: true };
    return integ.salvarCartao(dados);
  }

  fc.addEventListener('submit', async e => {
    e.preventDefault();
    msg($('aviso-cartao'), '');
    fc.querySelectorAll('.invalid').forEach(i => i.classList.remove('invalid'));
    const erro = validarCartao();
    if (erro) { fc[erro[0]].classList.add('invalid'); fc[erro[0]].focus(); return msg($('erro-cartao'), erro[1]); }
    msg($('erro-cartao'), '');
    const btn = fc.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      await salvarCartao({
        numero: digits(fc.numero.value), nome: fc.nome.value.trim(), validade: fc.validade.value,
        cvv: fc.cvv.value, cpf: digits(fc.cpf.value), recorrente: fc.recorrente.checked
      });
    } catch (e2) {
      msg($('aviso-cartao'), e2 && e2.naoIntegrado
        ? 'Dados conferidos. O cadastro de cartões será liberado quando concluirmos a integração com a operadora de pagamento. Por segurança, nenhum dado do cartão foi salvo ou enviado.'
        : 'Não foi possível salvar o cartão agora. Tente de novo.');
    } finally {
      busy(btn, false);
      fc.numero.value = ''; fc.cvv.value = ''; $('bandeira').textContent = '';
    }
  });

  /* ---------- sair ---------- */
  $('sair').addEventListener('click', async () => {
    busy($('sair'), true, 'Saindo…');
    saindo = true;
    await sb.auth.signOut();
    location.replace('index.html');
  });

  /* ---------- início: só entra quem está logado ---------- */
  async function iniciar() {
    if (!sb) { $('area-carregando').textContent = 'A área do cliente ainda não está configurada neste site.'; return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    user = session.user;
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && !saindo) location.replace(ENTRAR); });
    const temCadastro = await carregarPerfil();
    if (!temCadastro) return location.replace('cadastro.html'); // logou mas não completou o cadastro
    $('area-carregando').hidden = true;
    $('area-conteudo').hidden = false;
    rota();
    carregarAssinaturas();
  }
  iniciar();
})();
