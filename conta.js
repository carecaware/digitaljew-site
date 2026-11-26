/* Base compartilhada da área do cliente (cadastro.html e area.html).
 *
 * Login que não expira: o Supabase guarda a sessão neste navegador e renova o
 * acesso sozinho antes de vencer (persistSession + autoRefreshToken). O cliente
 * só sai quando clica em "Sair". No painel do Supabase, mantenha desligados
 * "Time-box user sessions" e "Inactivity timeout" (Authentication → Sessions). */
window.DJ = (() => {
  const cfg = window.DIGITALJEW_CONFIG || {};
  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseKey
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
      })
    : null;

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
  function msg(el, text) { el.textContent = text || ''; el.hidden = !text; }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Aguarde…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  /* ---------- força da senha ----------
   * Segue as recomendações atuais (NIST SP 800-63B): o que mais pesa é o TAMANHO; não exige
   * símbolos obrigatórios; derruba senhas comuns, sequências, repetições e dados pessoais.
   * Níveis: 0 vazio · 1 fraca · 2 média · 3 forte · 4 muito forte. Mínimo aceito: 2 (média). */
  const COMUNS = new Set(['123456','1234567','12345678','123456789','1234567890','12345','111111','000000','123123','102030','senha','senha123','senha1234','password','password1','qwerty','qwerty123','abc123','abcd1234','iloveyou','admin','admin123','welcome','bemvindo','brasil','flamengo','corinthians','palmeiras','saopaulo','vasco','gremio','cruzeiro','santos','botafogo','fluminense','internacional','mudar123','teste123','minhasenha','amor','jesus','deus','familia','futebol','barfacil','digitaljew','pizzaria','restaurante','cerveja','boteco']);
  function forcaSenha(pw, pessoais = []) {
    pw = String(pw || '');
    if (!pw) return 0;
    const chars = [...pw];
    if (chars.length < 8) return 1;
    let base = pw.toLowerCase();
    const sem = base.replace(/[^a-zà-ú]/g, '');
    if (COMUNS.has(base) || (sem.length >= 4 && COMUNS.has(sem) && sem.length >= base.length - 4)) return 1;
    // tira pedaços pessoais (nome, e-mail) antes de medir
    for (const p of pessoais.map(x => String(x || '').toLowerCase()).flatMap(x => x.split(/[\s@._-]+/)).filter(x => x.length >= 3))
      base = base.split(p).join('');
    // repetições e sequências (aaaa, 1234, abcd) quase não somam
    let efetivo = 0, ant = null;
    for (const c of [...base]) {
      const k = c.codePointAt(0);
      if (ant === null || (k !== ant && Math.abs(k - ant) !== 1)) efetivo += 1;
      ant = k;
    }
    let pool = 0;
    if (/[a-zà-ú]/.test(pw)) pool += 26;
    if (/[A-ZÀ-Ú]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^a-zA-Zà-úÀ-Ú\d]/.test(pw)) pool += 33;
    const bits = efetivo * Math.log2(Math.max(pool, 10));
    return bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  }
  const NIVEIS = ['', 'Fraca', 'Média', 'Forte', 'Muito forte'];
  /* Liga um campo de senha a um medidor: <div class="pw-meter"> com 4 barras e um rótulo. */
  function ligarMedidor(input, meter, pessoais = () => []) {
    meter.innerHTML = '<div class="pw-bars"><i></i><i></i><i></i><i></i></div><span class="pw-label" aria-live="polite"></span>';
    const atualizar = () => {
      const n = forcaSenha(input.value, pessoais());
      meter.dataset.nivel = n;
      meter.querySelector('.pw-label').textContent = n ? `Força da senha: ${NIVEIS[n]}` : '';
      return n;
    };
    input.addEventListener('input', atualizar);
    atualizar();
    return atualizar;
  }

  /* menu do celular e ano do rodapé (iguais à página inicial) */
  document.querySelector('.menu-toggle')?.addEventListener('click', e => {
    const n = document.querySelector('.nav'), o = n.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(o));
  });
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();

  return { cfg, sb, digits, nationalDigits, maskPhone, phoneE164, validPhone, validEmail, hideEmail, msg, busy, forcaSenha, ligarMedidor, NIVEIS };
})();
