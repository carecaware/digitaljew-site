/* Página de redefinição de senha (link enviado pelo "Esqueci a senha").
 * Aceita os dois formatos de link do Supabase:
 *  - ?token_hash=...&type=recovery  (modelo de e-mail do projeto; funciona em qualquer aparelho)
 *  - ?code=...                      (modelo padrão; funciona no mesmo navegador que pediu o link) */
(() => {
  const { sb, msg, busy, ligarMedidor } = window.DJ;
  const $ = id => document.getElementById(id);
  const show = step => document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== step; });
  let email = '';

  const f = $('form-nova');
  const nivel = ligarMedidor(f.senha, $('medidor-nova'), () => [email]);
  const botao = f.querySelector('button[type="submit"]');
  const atualizar = () => { botao.disabled = nivel() < 2 || !f.repetir.value; msg($('erro-nova'), ''); };
  f.senha.addEventListener('input', atualizar);
  f.repetir.addEventListener('input', atualizar);

  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (nivel() < 2) return msg($('erro-nova'), 'Escolha uma senha pelo menos média. Siga a dica abaixo dos campos.');
    if (f.senha.value !== f.repetir.value) return msg($('erro-nova'), 'As duas senhas não são iguais.'), f.repetir.focus();
    busy(botao, true, 'Salvando…');
    const { error } = await sb.auth.updateUser({ password: f.senha.value });
    busy(botao, false); atualizar();
    if (!error) return show('pronto');
    if (/same/i.test(error.message || '')) return msg($('erro-nova'), 'Escolha uma senha diferente da anterior.');
    if (/weak|short|characters/i.test(error.message || '') || error.code === 'weak_password') return msg($('erro-nova'), 'Essa senha não foi aceita. Use pelo menos 8 caracteres e siga a dica.');
    if (error.status === 401 || /session/i.test(error.message || '')) return show('invalido');
    msg($('erro-nova'), 'Não foi possível salvar agora. Tente de novo.');
  });

  function pronto(session) {
    email = (session && session.user && session.user.email) || '';
    if (email) $('nova-texto').textContent = `Escolha uma senha forte para ${email}.`;
    show('nova');
    f.senha.focus();
  }

  async function iniciar() {
    if (!sb) { $('nova-texto').textContent = 'A área do cliente ainda não está configurada neste site.'; return show('nova'); }
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1));
    const limpar = () => history.replaceState(null, '', location.pathname);
    if (q.get('error') || q.get('error_code')) { limpar(); return show('invalido'); }

    const tokenHash = q.get('token_hash');
    if (tokenHash) {
      const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      limpar();
      return error ? show('invalido') : pronto(data.session);
    }
    // ?code=... : o próprio cliente do Supabase troca o código por uma sessão ao carregar
    const { data: { session } } = await sb.auth.getSession();
    if (q.has('code')) limpar();
    if (session) return pronto(session);
    show('invalido');
  }
  iniciar();
})();
