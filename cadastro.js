/* Página de cadastro e de entrada do cliente.
 * Código de confirmação por e-mail e login com Google, feitos pelo Supabase Auth.
 * Configuração (URL, chave pública, validade do código) em config.js; base em conta.js. */
(() => {
  const { cfg, sb, digits, maskPhone, phoneE164, validPhone, validEmail, hideEmail, msg, busy } = window.DJ;
  const TTL_MS = (cfg.codeTtlMinutes || 10) * 60 * 1000;
  const COOLDOWN_S = cfg.resendCooldownSeconds || 60;
  const $ = id => document.getElementById(id);
  const AREA = 'area.html';

  // Estado: modo "cadastro" (conta nova) ou "entrar" (conta existente)
  const st = { modo: 'cadastro', dados: null, expiraEm: 0, esperaAte: 0, timer: null };

  function show(step) {
    document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== step; });
    const first = document.querySelector(`.step[data-step="${step}"] input:not([readonly])`);
    if (first && step !== 'dados') first.focus({ preventScroll: true });
  }
  function origemDe(form) {
    const o = form.origem.value;
    return o === 'Outro' && form.origem_outro.value.trim() ? 'Outro: ' + form.origem_outro.value.trim() : o;
  }
  function sendError(err) {
    const code = err && (err.code || ''), status = err && err.status;
    if (status === 429 || /rate_limit/.test(code)) return 'Muitos pedidos de código seguidos. Aguarde um minuto e tente de novo.';
    if (/otp_disabled|signup_disabled|user_not_found/.test(code) || /signups not allowed/i.test(err && err.message || ''))
      return 'Não encontramos uma conta com este e-mail. Confira o endereço ou cadastre-se.';
    if (/email_provider_disabled|email_address_invalid/.test(code)) return 'Não conseguimos enviar para este e-mail. Confira o endereço e tente de novo.';
    return 'Não foi possível enviar o código agora. Tente de novo em instantes.';
  }
  function notConfigured(el) { msg(el, 'O cadastro ainda não está configurado neste site (falta a conexão com o Supabase em config.js).'); }

  /* ---------- máscara do WhatsApp e campo "Outro" ---------- */
  document.querySelectorAll('input[name="whatsapp"]').forEach(i => i.addEventListener('input', () => { i.value = maskPhone(i.value); }));
  document.querySelectorAll('select[name="origem"]').forEach(sel => {
    const extra = sel.form.origem_outro.closest('.field');
    sel.addEventListener('change', () => { extra.hidden = sel.value !== 'Outro'; });
  });

  /* ---------- alternar entre cadastro e entrar ---------- */
  document.querySelectorAll('[data-ir]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    st.modo = a.dataset.ir === 'entrar' ? 'entrar' : 'cadastro';
    history.replaceState(null, '', a.dataset.ir === 'entrar' ? '#entrar' : location.pathname);
    show(a.dataset.ir);
  }));
  $('voltar-codigo').addEventListener('click', () => show(st.modo === 'entrar' ? 'entrar' : 'dados'));

  /* ---------- passo 1: dados ---------- */
  function validar(form, errEl) {
    const nome = form.nome.value.trim(), email = form.email.value.trim(), whats = form.whatsapp.value;
    if (nome.length < 3) return msg(errEl, 'Digite seu nome completo.'), form.nome.focus(), null;
    if (!validEmail(email)) return msg(errEl, 'Digite um e-mail válido.'), form.email.focus(), null;
    if (!validPhone(whats)) return msg(errEl, 'Digite um WhatsApp válido, com DDD.'), form.whatsapp.focus(), null;
    if (!form.origem.value) return msg(errEl, 'Conte pra gente onde ouviu falar de nós.'), form.origem.focus(), null;
    msg(errEl, '');
    return { nome, email: email.toLowerCase(), whatsapp: phoneE164(whats), origem: origemDe(form) };
  }

  /* ---------- enviar o código por e-mail ---------- */
  async function enviarCodigo() {
    if (!sb) throw { code: 'not_configured' };
    const opts = st.modo === 'entrar'
      ? { shouldCreateUser: false }
      : { shouldCreateUser: true, data: { nome: st.dados.nome, email: st.dados.email, whatsapp: st.dados.whatsapp, origem: st.dados.origem } };
    const r = await sb.auth.signInWithOtp({ email: st.dados.email, options: opts });
    if (r.error) throw r.error;
    st.expiraEm = Date.now() + TTL_MS;
    iniciarEspera();
  }
  const textoEnvio = novo => `Enviamos um${novo ? ' novo' : ''} código para o e-mail ${hideEmail(st.dados.email)}. Ele vale por ${cfg.codeTtlMinutes || 10} minutos.`;

  async function pedirCodigo(form, errEl, label) {
    const btn = form.querySelector('button[type="submit"]');
    busy(btn, true, label);
    try {
      await enviarCodigo();
      $('codigo-texto').textContent = textoEnvio(false);
      $('form-codigo').reset();
      erroCodigo('');
      show('codigo');
    } catch (e2) {
      msg(errEl, e2 && e2.code === 'not_configured' ? '' : sendError(e2));
    } finally { busy(btn, false); }
  }

  $('form-dados').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('erro-dados');
    const dados = validar(e.target, err);
    if (!dados) return;
    if (!sb) return notConfigured(err);
    st.modo = 'cadastro'; st.dados = dados;
    pedirCodigo(e.target, err, 'Enviando código…');
  });

  $('form-entrar').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('erro-entrar'), email = e.target.email.value.trim();
    if (!validEmail(email)) return msg(err, 'Digite um e-mail válido.'), e.target.email.focus();
    if (!sb) return notConfigured(err);
    msg(err, '');
    st.modo = 'entrar'; st.dados = { email: email.toLowerCase() };
    pedirCodigo(e.target, err, 'Enviando código…');
  });

  /* ---------- passo 2: código ---------- */
  const campo = $('campo-codigo');
  campo.addEventListener('input', () => { campo.value = digits(campo.value).slice(0, 10); campo.classList.remove('invalid'); });

  function erroCodigo(text) { msg($('erro-codigo'), text); campo.classList.toggle('invalid', !!text); }

  $('form-codigo').addEventListener('submit', async e => {
    e.preventDefault();
    const token = digits(campo.value);
    if (token.length < 6) return erroCodigo('Digite o código completo que você recebeu.');
    if (Date.now() > st.expiraEm) return erroCodigo('O código está expirado. Clique abaixo para enviar um novo código.');
    const btn = e.target.querySelector('button[type="submit"]');
    busy(btn, true, 'Conferindo…');
    try {
      const r = await sb.auth.verifyOtp({ email: st.dados.email, token, type: 'email' });
      if (r.error) {
        // O Supabase usa "otp_expired" tanto para código vencido quanto errado: o relógio local decide.
        if (Date.now() > st.expiraEm) return erroCodigo('O código está expirado. Clique abaixo para enviar um novo código.');
        if (r.error.status === 429) return erroCodigo('Muitas tentativas. Aguarde um minuto e tente de novo.');
        return erroCodigo('Código incorreto. Confira os números e tente de novo.');
      }
      erroCodigo('');
      if (st.modo === 'entrar') return seguirLogado(r.data.user);
      await salvarCliente(r.data.user, { ...st.dados, metodo: 'email' });
      concluir(st.dados.nome);
    } catch (e2) {
      erroCodigo(e2 && e2.salvar ? 'Seu código foi confirmado, mas não conseguimos salvar o cadastro. Tente de novo.' : 'Não foi possível conferir o código agora. Tente de novo.');
    } finally { busy(btn, false); }
  });

  /* reenviar com espera entre pedidos */
  function iniciarEspera() {
    st.esperaAte = Date.now() + COOLDOWN_S * 1000;
    clearInterval(st.timer);
    const link = $('reenviar'), aviso = $('reenviar-espera');
    const tick = () => {
      const s = Math.ceil((st.esperaAte - Date.now()) / 1000);
      if (s <= 0) { clearInterval(st.timer); link.hidden = false; aviso.hidden = true; return; }
      link.hidden = true; aviso.hidden = false;
      aviso.textContent = `Você pode pedir um novo código em ${s}s.`;
    };
    tick(); st.timer = setInterval(tick, 1000);
  }

  $('reenviar').addEventListener('click', async () => {
    const link = $('reenviar');
    busy(link, true, 'Enviando novo código…');
    try {
      await enviarCodigo();
      campo.value = '';
      erroCodigo('');
      $('codigo-texto').textContent = textoEnvio(true);
      campo.focus();
    } catch (e2) {
      erroCodigo(sendError(e2));
    } finally { busy(link, false); }
  });

  /* ---------- salvar cadastro na tabela clientes ---------- */
  async function salvarCliente(user, d) {
    const { error } = await sb.from('clientes').upsert({
      id: user.id, nome: d.nome, email: d.email, whatsapp: d.whatsapp, origem: d.origem, metodo: d.metodo
    });
    if (error) { console.error(error); throw { salvar: true }; }
  }

  function concluir(nome) {
    $('pronto-texto').textContent = `Tudo certo, ${nome.split(' ')[0]}. Bem-vindo à DigitalJew.`;
    show('pronto');
  }

  /* Já logado: quem tem cadastro vai para a área; quem não tem completa os dados. */
  async function seguirLogado(user) {
    const { data: cli } = await sb.from('clientes').select('nome').eq('id', user.id).maybeSingle();
    if (cli) return location.replace(AREA);
    const f = $('form-completar'), m = user.user_metadata || {};
    f.nome.value = m.full_name || m.name || m.nome || '';
    f.email.value = user.email || m.email || '';
    if (m.whatsapp) f.whatsapp.value = maskPhone(m.whatsapp);
    $('completar-texto').textContent = (user.app_metadata || {}).provider === 'google'
      ? 'Você entrou com o Google. Complete o cadastro com os dados abaixo.'
      : 'Complete o cadastro com os dados abaixo.';
    show('completar');
  }

  /* ---------- Google ---------- */
  document.querySelectorAll('.google-button').forEach(btn => btn.addEventListener('click', async () => {
    const err = btn.closest('.step').querySelector('.form-error');
    if (!sb) return notConfigured(err);
    busy(btn, true, 'Abrindo o Google…');
    const redirectTo = location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) { busy(btn, false); msg(err, 'Não foi possível abrir o login do Google agora. Tente de novo.'); }
  }));

  $('form-completar').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, errEl = $('erro-completar');
    const d = validar(f, errEl);
    if (!d) return;
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      const { data } = await sb.auth.getUser();
      await salvarCliente(data.user, { ...d, metodo: (data.user.app_metadata || {}).provider === 'google' ? 'google' : 'email' });
      concluir(d.nome);
    } catch { msg(errEl, 'Não conseguimos salvar seu cadastro. Tente de novo.'); }
    finally { busy(btn, false); }
  });

  /* ---------- ao abrir a página (inclui a volta do Google) ---------- */
  async function iniciar() {
    if (location.hash === '#entrar') { st.modo = 'entrar'; show('entrar'); }
    if (!sb) return;
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
    if (q.get('error_description')) msg($('erro-dados'), 'O login com Google foi cancelado ou falhou. Tente de novo.');
    const { data: { session } } = await sb.auth.getSession();
    if (q.has('code') || q.has('access_token')) history.replaceState(null, '', location.pathname);
    if (session) await seguirLogado(session.user);
  }
  iniciar();
})();
