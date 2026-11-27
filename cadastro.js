/* Página de cadastro e de entrada do cliente (Supabase Auth).
 * - Cadastro por e-mail: dados -> código de confirmação no e-mail -> criar senha -> pronto.
 * - Entrar: e-mail + senha (com "Esqueci a senha"), ou Google.
 * - Google: sem código nem link; no primeiro acesso, uma tela única com nome (vem do Google),
 *   WhatsApp e tipo de comércio -> pronto.
 * Ao concluir o cadastro, a função "boas-vindas" envia o e-mail de boas-vindas (uma vez só).
 * Configuração em config.js; base compartilhada em conta.js. */
(() => {
  const { cfg, sb, digits, maskPhone, phoneE164, validPhone, validEmail, hideEmail, msg, busy, ligarMedidor } = window.DJ;
  const TTL_MS = (cfg.codeTtlMinutes || 10) * 60 * 1000;
  const TAM_CODIGO = cfg.codeLength || 6;
  const COOLDOWN_S = cfg.resendCooldownSeconds || 60;
  const $ = id => document.getElementById(id);

  // Para onde ir depois de entrar: Downloads, quando a pessoa veio para baixar o app.
  try { if (new URLSearchParams(location.search).get('voltar') === 'downloads') sessionStorage.setItem('dj_voltar', 'downloads'); } catch {}
  const destino = () => { let v = null; try { v = sessionStorage.getItem('dj_voltar'); sessionStorage.removeItem('dj_voltar'); } catch {} return 'area.html' + (v === 'downloads' ? '#downloads' : ''); };

  // dados: o que foi digitado no cadastro por e-mail (ou recuperado do metadata da conta)
  const st = { dados: null, expiraEm: 0, esperaAte: 0, timer: null };

  function show(step) {
    document.documentElement.removeAttribute('data-passo');   // a partir daqui o JavaScript decide a tela
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
    if (status === 429 || /rate_limit/.test(code)) return 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.';
    if (/email_address_invalid/.test(code)) return 'Não conseguimos enviar para este e-mail. Confira o endereço e tente de novo.';
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
    history.replaceState(null, '', a.dataset.ir === 'entrar' ? '#entrar' : location.pathname);
    show(a.dataset.ir);
  }));
  $('voltar-codigo').addEventListener('click', () => show('dados'));

  /* ---------- 1) cadastro por e-mail: dados ---------- */
  function validarComuns(form, errEl, { email = true, origem = true } = {}) {
    const nome = form.nome.value.trim(), mail = form.email.value.trim(), whats = form.whatsapp.value;
    if (nome.length < 3) return msg(errEl, 'Digite seu nome completo.'), form.nome.focus(), null;
    if (email && !validEmail(mail)) return msg(errEl, 'Digite um e-mail válido.'), form.email.focus(), null;
    if (!validPhone(whats)) return msg(errEl, 'Digite um WhatsApp válido, com DDD.'), form.whatsapp.focus(), null;
    if (!form.tipo.value) return msg(errEl, 'Escolha o tipo do seu comércio.'), form.tipo.focus(), null;
    msg(errEl, '');
    return { nome, email: mail.toLowerCase(), whatsapp: phoneE164(whats), tipo_comercio: form.tipo.value, origem: origem ? origemDe(form) : null };
  }

  async function enviarCodigo() {
    if (!sb) throw { code: 'not_configured' };
    const d = st.dados;
    const r = await sb.auth.signInWithOtp({ email: d.email, options: { shouldCreateUser: true, data: { nome: d.nome, whatsapp: d.whatsapp, tipo_comercio: d.tipo_comercio, origem: d.origem } } });
    if (r.error) throw r.error;
    st.expiraEm = Date.now() + TTL_MS;
    iniciarEspera();
  }
  const textoEnvio = novo => `Enviamos um${novo ? ' novo' : ''} código para o e-mail ${hideEmail(st.dados.email)}. Ele vale por ${cfg.codeTtlMinutes || 10} minutos.`;

  $('form-dados').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('erro-dados');
    const dados = validarComuns(e.target, err);
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
    } catch (e2) { msg(err, e2 && e2.code === 'not_configured' ? '' : sendError(e2)); }
    finally { busy(btn, false); }
  });

  /* ---------- 2) código de confirmação ---------- */
  const campo = $('campo-codigo');
  campo.maxLength = TAM_CODIGO;
  // aceita só os dígitos do código; colar de novo (ou colar texto com o código no meio) substitui em vez de duplicar
  campo.addEventListener('paste', e => {
    const colado = digits((e.clipboardData || window.clipboardData).getData('text'));
    if (!colado) return;
    e.preventDefault();
    campo.value = colado.slice(0, TAM_CODIGO);
    campo.dispatchEvent(new Event('input'));
  });
  campo.addEventListener('input', () => { campo.value = digits(campo.value).slice(0, TAM_CODIGO); campo.classList.remove('invalid'); });
  function erroCodigo(text) { msg($('erro-codigo'), text); campo.classList.toggle('invalid', !!text); }

  $('form-codigo').addEventListener('submit', async e => {
    e.preventDefault();
    const token = digits(campo.value);
    if (token.length < TAM_CODIGO) return erroCodigo(`Digite os ${TAM_CODIGO} dígitos do código que você recebeu.`);
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
      // conta que já tinha cadastro completo (e senha): vai direto para a área
      const { data: cli } = await sb.from('clientes').select('id').eq('id', r.data.user.id).maybeSingle();
      if (cli) return location.replace(destino());
      mostrarSenha();
    } catch { erroCodigo('Não foi possível conferir o código agora. Tente de novo.'); }
    finally { busy(btn, false); }
  });

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
    try { await enviarCodigo(); campo.value = ''; erroCodigo(''); $('codigo-texto').textContent = textoEnvio(true); campo.focus(); }
    catch (e2) { erroCodigo(sendError(e2)); }
    finally { busy(link, false); }
  });

  /* ---------- 3) criar a senha (cadastro por e-mail) ---------- */
  const fs = $('form-senha');
  const nivelSenha = ligarMedidor(fs.senha, $('medidor-senha'), () => [st.dados && st.dados.nome, st.dados && st.dados.email]);
  fs.senha.addEventListener('input', () => { fs.querySelector('button[type="submit"]').disabled = nivelSenha() < 2; msg($('erro-senha'), ''); });
  function mostrarSenha() { fs.reset(); nivelSenha(); fs.querySelector('button[type="submit"]').disabled = true; show('senha'); }

  fs.addEventListener('submit', async e => {
    e.preventDefault();
    if (nivelSenha() < 2) return msg($('erro-senha'), 'Escolha uma senha pelo menos média. Siga a dica abaixo do campo.');
    const btn = fs.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      const { error } = await sb.auth.updateUser({ password: fs.senha.value });
      if (error) {
        if (/weak|short|characters/i.test(error.message || '') || error.code === 'weak_password') return msg($('erro-senha'), 'Essa senha não foi aceita. Use pelo menos 8 caracteres e siga a dica abaixo.');
        if (/same/i.test(error.message || '')) return msg($('erro-senha'), 'Escolha uma senha diferente da anterior.');
        throw error;
      }
      const { data } = await sb.auth.getUser();
      await salvarCliente(data.user, { ...st.dados, metodo: 'email' });
      concluir(st.dados.nome);
    } catch (e2) {
      console.error(e2);
      msg($('erro-senha'), e2 && e2.salvar ? 'Sua senha foi criada, mas não conseguimos salvar o cadastro. Tente de novo.' : 'Não foi possível salvar a senha agora. Tente de novo.');
    } finally { busy(btn, false); fs.querySelector('button[type="submit"]').disabled = nivelSenha() < 2; }
  });

  /* ---------- salvar cadastro e boas-vindas ---------- */
  async function salvarCliente(user, d) {
    const linha = { id: user.id, nome: d.nome, email: d.email, whatsapp: d.whatsapp, tipo_comercio: d.tipo_comercio, metodo: d.metodo };
    if (d.origem) linha.origem = d.origem;
    const { error } = await sb.from('clientes').upsert(linha);
    if (error) { console.error(error); throw { salvar: true }; }
    // e-mail de boas-vindas (a função só envia uma vez; se falhar, não atrapalha o cadastro)
    sb.functions.invoke('boas-vindas', { body: {} }).catch(() => {});
  }
  function concluir(nome) {
    $('pronto-texto').textContent = `Tudo certo, ${nome.split(' ')[0]}. Bem-vindo à DigitalJew.`;
    show('pronto');
  }

  /* ---------- entrar: e-mail + senha ---------- */
  $('form-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = $('erro-entrar'), email = f.email.value.trim().toLowerCase();
    if (!validEmail(email)) return msg(err, 'Digite um e-mail válido.'), f.email.focus();
    if (!f.senha.value) return msg(err, 'Digite a sua senha.'), f.senha.focus();
    if (!sb) return notConfigured(err);
    msg(err, '');
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Entrando…');
    const { data, error } = await sb.auth.signInWithPassword({ email, password: f.senha.value });
    busy(btn, false);
    if (error) {
      if (error.status === 429) return msg(err, 'Muitas tentativas. Aguarde um minuto e tente de novo.');
      if (/email_not_confirmed/.test(error.code || '')) return msg(err, 'Esse e-mail ainda não foi confirmado. Faça o cadastro de novo para receber um código.');
      return msg(err, 'E-mail ou senha incorretos. Se você se cadastrou com o Google, use o botão "Continuar com Google".');
    }
    seguirLogado(data.user);
  });

  /* ---------- esqueci a senha (janela) ---------- */
  const modal = $('esqueci'), fundo = $('esqueci-fundo');
  let voltarFoco = null;
  function abrirEsqueci() {
    voltarFoco = document.activeElement;
    const fe = $('form-esqueci');
    fe.reset(); msg($('erro-esqueci'), ''); msg($('ok-esqueci'), '');
    fe.email.value = $('form-entrar').email.value.trim();
    modal.hidden = false; fundo.hidden = false;
    document.body.classList.add('no-scroll');
    fe.email.focus();
  }
  function fecharEsqueci() {
    if (modal.hidden) return;
    modal.hidden = true; fundo.hidden = true;
    document.body.classList.remove('no-scroll');
    if (voltarFoco) voltarFoco.focus({ preventScroll: true });
  }
  $('abrir-esqueci').addEventListener('click', abrirEsqueci);
  modal.querySelector('[data-fechar]').addEventListener('click', fecharEsqueci);
  fundo.addEventListener('click', fecharEsqueci);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharEsqueci(); });

  $('form-esqueci').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = $('erro-esqueci'), ok = $('ok-esqueci'), email = f.email.value.trim().toLowerCase();
    msg(ok, '');
    if (!validEmail(email)) return msg(err, 'Digite um e-mail válido.'), f.email.focus();
    if (!sb) return notConfigured(err);
    msg(err, '');
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Enviando…');
    const redirectTo = new URL('redefinir-senha.html', location.href.split('#')[0].split('?')[0]).href;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    busy(btn, false);
    if (error && error.status === 429) return msg(err, 'Muitos pedidos seguidos. Aguarde um minuto e tente de novo.');
    if (error) { console.error(error); return msg(err, 'Não foi possível enviar o link agora. Tente de novo em instantes.'); }
    // mesma resposta exista ou não a conta (não revela quais e-mails estão cadastrados)
    msg(ok, `Se houver uma conta com ${email}, você vai receber em instantes um e-mail com o link para criar uma senha nova. Confira também o spam.`);
  });

  /* ---------- Google ---------- */
  document.querySelectorAll('.google-button').forEach(btn => btn.addEventListener('click', async () => {
    const err = btn.closest('.step').querySelector('.form-error');
    if (!sb) return notConfigured(err);
    busy(btn, true, 'Abrindo o Google…');
    const redirectTo = location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) { busy(btn, false); msg(err, 'Não foi possível abrir o login do Google agora. Tente de novo.'); }
  }));

  /* ---------- logado sem cadastro completo ---------- */
  const doGoogle = user => (user.app_metadata || {}).provider === 'google' || ((user.app_metadata || {}).providers || []).includes('google');

  async function seguirLogado(user) {
    const { data: cli } = await sb.from('clientes').select('nome').eq('id', user.id).maybeSingle();
    if (cli) return location.replace(destino());
    const m = user.user_metadata || {};
    if (!doGoogle(user) && m.nome && m.whatsapp && m.tipo_comercio) {
      // cadastro por e-mail interrompido depois do código: falta só a senha
      st.dados = { nome: m.nome, email: (user.email || '').toLowerCase(), whatsapp: m.whatsapp, tipo_comercio: m.tipo_comercio, origem: m.origem || null };
      return mostrarSenha();
    }
    const f = $('form-completar');
    // nome que veio do Google: preenchido provisoriamente, o cliente pode corrigir
    f.nome.value = m.full_name || m.name || m.nome || '';
    f.email.value = user.email || m.email || '';
    if (m.whatsapp) f.whatsapp.value = maskPhone(m.whatsapp);
    if (m.tipo_comercio) f.tipo.value = m.tipo_comercio;
    $('completar-texto').textContent = doGoogle(user)
      ? 'Você entrou com o Google. Confira o seu nome e complete o cadastro. É só desta vez.'
      : 'Complete o seu cadastro. É só desta vez.';
    st.completarGoogle = doGoogle(user);
    show('completar');
  }

  $('form-completar').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, errEl = $('erro-completar');
    const d = validarComuns(f, errEl, { email: false, origem: false });
    if (!d) return;
    const btn = f.querySelector('button[type="submit"]');
    busy(btn, true, 'Salvando…');
    try {
      const { data } = await sb.auth.getUser();
      d.email = (data.user.email || f.email.value).toLowerCase();
      if (st.completarGoogle) {
        await salvarCliente(data.user, { ...d, metodo: 'google' });
        concluir(d.nome);
      } else {
        st.dados = d;  // conta por e-mail sem senha: cria a senha antes de concluir
        mostrarSenha();
      }
    } catch { msg(errEl, 'Não conseguimos salvar seu cadastro. Tente de novo.'); }
    finally { busy(btn, false); }
  });

  /* ---------- animação do texto (só na primeira visita) ---------- */
  if (document.documentElement.classList.contains('anim-cadastro')) {
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('anim-in')));
    try { localStorage.setItem('dj_cadastro_visto', '1'); } catch {}
  }

  /* ---------- ao abrir a página (inclui a volta do Google) ---------- */
  async function iniciar() {
    if (location.hash === '#entrar') show('entrar');
    if (!sb) return;
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
    if (q.get('error_description')) msg($('erro-dados'), 'O login com Google foi cancelado ou falhou. Tente de novo.');
    if (q.get('esqueci') === '1') { show('entrar'); abrirEsqueci(); }
    const { data: { session } } = await sb.auth.getSession();
    if (q.has('code') || q.has('access_token')) history.replaceState(null, '', location.pathname);
    if (session) await seguirLogado(session.user);
  }
  iniciar();
})();
