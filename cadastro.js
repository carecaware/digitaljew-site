/* Página de cadastro do cliente.
 * Código de confirmação por e-mail e login com Google, feitos pelo Supabase Auth.
 * Configuração (URL, chave pública, validade do código) em config.js. */
(() => {
  const cfg = window.DIGITALJEW_CONFIG || {};
  const TTL_MS = (cfg.codeTtlMinutes || 10) * 60 * 1000;
  const COOLDOWN_S = cfg.resendCooldownSeconds || 60;
  const $ = id => document.getElementById(id);

  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
    : null;

  // Estado do cadastro em andamento
  const st = { dados: null, expiraEm: 0, esperaAte: 0, timer: null };

  /* ---------- utilidades ---------- */
  const digits = v => String(v || '').replace(/\D/g, '');
  function nationalDigits(v) { let d = digits(v); if (d.length > 11 && d.startsWith('55')) d = d.slice(2); return d; }
  function maskPhone(v) {
    const d = nationalDigits(v).slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  const phoneE164 = v => '+55' + nationalDigits(v);
  const validPhone = v => /^[1-9]{2}9?\d{8}$/.test(nationalDigits(v));
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
  function hideEmail(e) { const [u, d] = e.split('@'); return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '•••') + '@' + d; }

  function show(step) {
    document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== step; });
    const first = document.querySelector(`.step[data-step="${step}"] input:not([readonly]), .step[data-step="${step}"] button`);
    if (first && step !== 'dados') first.focus({ preventScroll: true });
  }
  function msg(el, text) { el.textContent = text || ''; el.hidden = !text; }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Aguarde…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function origemDe(form) {
    const o = form.origem.value;
    return o === 'Outro' && form.origem_outro.value.trim() ? 'Outro: ' + form.origem_outro.value.trim() : o;
  }
  function sendError(err) {
    const code = err && (err.code || ''), status = err && err.status;
    if (status === 429 || /rate_limit/.test(code)) return 'Muitos pedidos de código seguidos. Aguarde um minuto e tente de novo.';
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

  document.querySelectorAll('[data-voltar]').forEach(b => b.addEventListener('click', () => show(b.dataset.voltar)));

  /* ---------- enviar o código por e-mail ---------- */
  async function enviarCodigo() {
    if (!sb) throw { code: 'not_configured' };
    const meta = { nome: st.dados.nome, email: st.dados.email, whatsapp: st.dados.whatsapp, origem: st.dados.origem };
    const r = await sb.auth.signInWithOtp({ email: st.dados.email, options: { shouldCreateUser: true, data: meta } });
    if (r.error) throw r.error;
    st.expiraEm = Date.now() + TTL_MS;
    iniciarEspera();
  }
  const textoEnvio = novo => `Enviamos um${novo ? ' novo' : ''} código para o e-mail ${hideEmail(st.dados.email)}. Ele vale por ${cfg.codeTtlMinutes || 10} minutos.`;

  $('form-dados').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('erro-dados');
    const dados = validar(e.target, err);
    if (!dados) return;
    if (!sb) return notConfigured(err);
    st.dados = dados;
    const btn = e.target.querySelector('button[type="submit"]');
    busy(btn, true, 'Enviando código…');
    try {
      await enviarCodigo();
      $('codigo-texto').textContent = textoEnvio(false);
      $('form-codigo').reset();
      erroCodigo('');
      show('codigo');
    } catch (e2) {
      msg(err, e2 && e2.code === 'not_configured' ? '' : sendError(e2));
    } finally { busy(btn, false); }
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

  /* ---------- Google ---------- */
  $('google-button').addEventListener('click', async () => {
    const err = $('erro-dados');
    if (!sb) return notConfigured(err);
    const btn = $('google-button');
    busy(btn, true, 'Abrindo o Google…');
    const redirectTo = location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) { busy(btn, false); msg(err, 'Não foi possível abrir o login do Google agora. Tente de novo.'); }
  });

  $('form-completar').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, errEl = $('erro-completar');
    const d = validar(f, errEl);
    if (!d) return;
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      const { data } = await sb.auth.getUser();
      await salvarCliente(data.user, { ...d, metodo: 'google' });
      concluir(d.nome);
    } catch { msg(errEl, 'Não conseguimos salvar seu cadastro. Tente de novo.'); }
    finally { busy(btn, false); }
  });

  $('sair').addEventListener('click', async () => {
    if (sb) await sb.auth.signOut();
    $('form-dados').reset();
    show('dados');
  });

  /* ---------- ao abrir a página (inclui a volta do Google) ---------- */
  async function iniciar() {
    if (!sb) return;
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
    if (q.get('error_description')) msg($('erro-dados'), 'O login com Google foi cancelado ou falhou. Tente de novo.');
    const { data: { session } } = await sb.auth.getSession();
    if (q.has('code') || q.has('access_token')) history.replaceState(null, '', location.pathname);
    if (!session) return;
    const user = session.user;
    const { data: cli } = await sb.from('clientes').select('nome').eq('id', user.id).maybeSingle();
    if (cli) return concluir(cli.nome || '');
    const f = $('form-completar'), m = user.user_metadata || {};
    f.nome.value = m.full_name || m.name || m.nome || '';
    f.email.value = user.email || m.email || '';
    if (m.whatsapp) f.whatsapp.value = maskPhone(m.whatsapp);
    show('completar');
  }

  /* menu do celular e ano do rodapé (iguais à página inicial) */
  document.querySelector('.menu-toggle')?.addEventListener('click', e => { const n = document.querySelector('.nav'), o = n.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); });
  $('year').textContent = new Date().getFullYear();
  iniciar();
})();
