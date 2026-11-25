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

  /* menu do celular e ano do rodapé (iguais à página inicial) */
  document.querySelector('.menu-toggle')?.addEventListener('click', e => {
    const n = document.querySelector('.nav'), o = n.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(o));
  });
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();

  return { cfg, sb, digits, nationalDigits, maskPhone, phoneE164, validPhone, validEmail, hideEmail, msg, busy };
})();
