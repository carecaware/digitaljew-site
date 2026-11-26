/* Área interna do cliente: assinatura, estabelecimentos, downloads, dados de pagamento e meus dados.
 * Só abre para quem está logado; o login fica guardado até o cliente clicar em "Sair" (ver conta.js). */
(() => {
  const { cfg, sb, digits, maskPhone, phoneE164, validPhone, msg, busy, ligarMedidor } = window.DJ;
  const $ = id => document.getElementById(id);
  const ENTRAR = 'cadastro.html#entrar';
  let user = null, saindo = false;

  const PLANOS = { teste: 'Teste', basica: 'Básica', premium: 'Premium' };
  const PLATAFORMAS = { windows: 'Windows (computador)', mobile: 'Mobile (celular Android)', web: 'Web (navegador)' };
  const SITUACAO = {
    ativa: 'Ativa', teste: 'Em teste', aguardando_ativacao: 'Aguardando ativação',
    teste_encerrado: 'Teste encerrado', expirada: 'Expirada', cancelada: 'Cancelada'
  };
  let licencas = [], estabs = [];
  const nomeEstab = id => (estabs.find(e => e.id === id) || {}).titulo;
  const PRECOS = cfg.precos || {};
  const dataLonga = d => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(d));
  const reais = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- telas (menu) ---------- */
  let telaAtual = 'assinatura';
  function mostrarView(nome) {
    if (!document.querySelector(`.area-view[data-view="${nome}"]`)) nome = 'assinatura';
    telaAtual = nome;
    document.querySelectorAll('.area-view').forEach(v => { v.hidden = v.dataset.view !== nome; });
    document.querySelectorAll('.area-nav [data-view]').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === nome));
  }
  function rota() {
    const h = location.hash.slice(1);
    if (h === 'pagamento') { mostrarView('assinatura'); abrirPagamento(); }
    else { fecharPagamento(true); mostrarView(h || 'assinatura'); }
  }
  window.addEventListener('hashchange', rota);
  // clique no menu: troca a tela na hora, mesmo que o endereço já aponte para ela
  document.querySelectorAll('.area-nav [data-view], a[href^="#"][data-view]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    fecharPagamento(true);
    history.replaceState(null, '', '#' + a.dataset.view);
    mostrarView(a.dataset.view);
  }));

  /* ---------- assinatura: vem das licenças do app (função minhas_licencas no Supabase) ---------- */
  function cardLicenca(l) {
    const teste = l.plano === 'teste';
    const encerrada = l.situacao === 'expirada' || l.situacao === 'teste_encerrado';
    let dataRotulo, dataValor;
    if (teste) {
      dataRotulo = 'Fim do teste';
      dataValor = l.teste_termina_em ? dataLonga(l.teste_termina_em)
        : `${l.dias_teste} dias a partir da 1ª ativação`;
    } else if (l.situacao === 'cancelada') {
      dataRotulo = 'Pode usar até';
      dataValor = dataLonga(l.cancelada_ate);
    } else {
      dataRotulo = 'Próxima cobrança';
      dataValor = encerrada ? '—' : l.proxima_cobranca ? dataLonga(l.proxima_cobranca) : 'Começa quando o app for ativado';
    }
    const preco = encerrada || l.situacao === 'cancelada' ? null : teste ? 'Grátis durante o teste' : PRECOS[l.plano] != null ? reais(PRECOS[l.plano]) : null;
    const aviso = l.situacao === 'cancelada'
      ? `<p class="plan-note">Assinatura cancelada. Você ainda pode usar o BarFácil até <strong>${esc(dataLonga(l.cancelada_ate))}</strong>; depois disso o app para de funcionar. Mudou de ideia? Dá para reverter até essa data.</p>`
      : l.volta_para_basica_em
      ? `<p class="plan-note">Você pediu para voltar à versão Básica. O Premium vale até ${esc(dataLonga(l.volta_para_basica_em))}; depois disso o app passa para a Básica.</p>`
      : l.situacao === 'teste_encerrado' ? '<p class="plan-note">Seu período de teste terminou. Fale com a gente para continuar usando o BarFácil.</p>'
      : l.situacao === 'expirada' ? '<p class="plan-note">Esta licença expirou. Fale com a gente para renovar.</p>' : '';
    return `<article class="plan-card plan-${esc(l.plano)}${encerrada ? ' plan-off' : ''}${l.situacao === 'cancelada' ? ' plan-cancelada' : ''}">
      <div class="plan-top"><span class="plan-label">LICENÇA •••• ${esc(l.final_chave)}</span><span class="plan-status status-${esc(l.situacao)}">${esc(SITUACAO[l.situacao] || l.situacao)}</span></div>
      <h2>BarFácil <span>${esc(PLANOS[l.plano] || l.plano)}</span></h2>
      <dl class="plan-meta${preco ? '' : ' two'}">
        <div><dt>Versão do app</dt><dd>${esc(PLATAFORMAS[l.plataforma] || l.plataforma || '—')}</dd></div>
        <div><dt>${dataRotulo}</dt><dd>${esc(dataValor)}</dd></div>
        ${preco ? `<div><dt>Valor mensal</dt><dd>${esc(preco)}</dd></div>` : ''}
      </dl>${aviso}${l.estabelecimento_id && nomeEstab(l.estabelecimento_id) ? `<p class="plan-estab">Estabelecimento: <a href="#estabelecimentos" data-view="estabelecimentos">${esc(nomeEstab(l.estabelecimento_id))}</a></p>` : ''}${acoesLicenca(l)}
    </article>`;
  }

  function acoesLicenca(l) {
    if (l.situacao === 'cancelada') return `<div class="plan-acoes"><button type="button" class="link-button" data-reverter="${esc(l.id)}">Reverter cancelamento</button></div>`;
    if (l.pode_cancelar) return `<div class="plan-acoes"><button type="button" class="link-button perigo" data-cancelar="${esc(l.id)}">Cancelar assinatura</button></div>`;
    return '';
  }

  async function carregarAssinaturas() {
    const [r1, r2] = await Promise.all([sb.rpc('minhas_licencas'), sb.from('estabelecimentos').select('id, titulo, endereco, tipo, created_at').order('created_at')]);
    if (r1.error) { console.error(r1.error); return msg($('erro-assinatura'), 'Não foi possível carregar sua assinatura agora. Recarregue a página em instantes.'); }
    if (r2.error) console.error(r2.error);
    licencas = r1.data || []; estabs = r2.data || [];
    $('assinaturas').innerHTML = licencas.map(cardLicenca).join('');
    $('sem-assinatura').hidden = licencas.length > 0;
    renderEstabs();
  }

  /* ---------- janela de confirmação ---------- */
  function confirmar({ titulo, texto, sim, nao = 'Voltar' }) {
    return new Promise(resolve => {
      const m = $('confirmar'), f = $('confirmar-fundo'), bSim = $('confirmar-sim'), bNao = $('confirmar-nao');
      const antes = document.activeElement;
      $('confirmar-titulo').textContent = titulo; $('confirmar-texto').innerHTML = texto;
      bSim.textContent = sim; bNao.textContent = nao;
      m.hidden = false; f.hidden = false; document.body.classList.add('no-scroll'); bNao.focus();
      const fim = v => { m.hidden = true; f.hidden = true; document.body.classList.remove('no-scroll'); bSim.onclick = bNao.onclick = f.onclick = null; document.removeEventListener('keydown', esc_); if (antes) antes.focus({ preventScroll: true }); resolve(v); };
      const esc_ = e => { if (e.key === 'Escape') fim(false); };
      bSim.onclick = () => fim(true); bNao.onclick = () => fim(false); f.onclick = () => fim(false);
      document.addEventListener('keydown', esc_);
    });
  }
  const avisar = (texto, onde = 'ok-assinatura') => { msg($(onde), texto); setTimeout(() => msg($(onde), ''), 8000); };

  /* ---------- cancelar e reverter (em Assinatura e em Meus estabelecimentos) ---------- */
  document.addEventListener('click', async e => {
    const bc = e.target.closest('[data-cancelar]'), br = e.target.closest('[data-reverter]');
    if (!bc && !br) return;
    const id = (bc || br).dataset[bc ? 'cancelar' : 'reverter'];
    const l = licencas.find(x => x.id === id); if (!l) return;
    const onde = e.target.closest('[data-view="estabelecimentos"]') ? 'ok-estab' : 'ok-assinatura';
    const nome = `BarFácil ${PLANOS[l.plano] || l.plano} (licença •••• ${l.final_chave})`;
    if (bc) {
      const ate = l.ativada && l.proxima_cobranca;
      const ok = await confirmar({
        titulo: 'Cancelar assinatura?',
        texto: ate
          ? `O ${esc(nome)} continua funcionando até <strong>${esc(dataLonga(l.proxima_cobranca))}</strong>, o fim do período já pago. Não haverá nova cobrança. Até essa data, você pode reverter o cancelamento.`
          : `Esta licença ainda não foi ativada em nenhum aparelho, então o cancelamento vale <strong>na hora</strong> e não poderá ser revertido.`,
        sim: 'Cancelar assinatura', nao: 'Manter assinatura'
      });
      if (!ok) return;
      busy(bc, true, 'Cancelando…');
      const { data, error } = await sb.rpc('cancelar_assinatura', { p_licenca: id });
      busy(bc, false);
      if (error) { console.error(error); return avisar('Não foi possível cancelar agora. Tente de novo em instantes.', onde); }
      await carregarAssinaturas();
      avisar(new Date(data) > new Date() ? `Assinatura cancelada. Você pode usar o BarFácil até ${dataLonga(data)}.` : 'Assinatura cancelada.', onde);
    } else {
      busy(br, true, 'Revertendo…');
      const { error } = await sb.rpc('reverter_cancelamento', { p_licenca: id });
      busy(br, false);
      if (error) { console.error(error); return avisar('Não foi possível reverter agora. Tente de novo em instantes.', onde); }
      await carregarAssinaturas();
      avisar(`Cancelamento revertido. O ${nome} continua ativo normalmente.`, onde);
    }
  });

  /* ---------- Meus estabelecimentos ---------- */
  const tipoLabel = t => String(t || '').toUpperCase();
  function linhaLicenca(l) {
    const estado = l.situacao === 'cancelada' ? `Cancelada · pode usar até ${dataLonga(l.cancelada_ate)}`
      : l.plano === 'teste' ? (l.teste_termina_em ? `Teste até ${dataLonga(l.teste_termina_em)}` : 'Teste · aguardando ativação')
      : l.situacao === 'expirada' ? 'Expirada'
      : l.proxima_cobranca ? `Próxima cobrança em ${dataLonga(l.proxima_cobranca)}` : 'Começa quando o app for ativado';
    return `<li class="estab-lic status-${esc(l.situacao)}">
      <div><b>BarFácil ${esc(PLANOS[l.plano] || l.plano)}</b> · ${esc((PLATAFORMAS[l.plataforma] || l.plataforma).split(' (')[0])} · •••• ${esc(l.final_chave)}<span>${esc(estado)}</span></div>
      <div class="estab-lic-acoes">${l.situacao === 'cancelada' ? `<button type="button" class="link-button" data-reverter="${esc(l.id)}">Reverter</button>` : l.pode_cancelar ? `<button type="button" class="link-button perigo" data-cancelar="${esc(l.id)}">Cancelar</button>` : ''}<button type="button" class="link-button muted" data-desvincular="${esc(l.id)}">Desvincular</button></div>
    </li>`;
  }
  function renderEstabs() {
    const livres = licencas.filter(l => !l.estabelecimento_id && !['expirada', 'teste_encerrado'].includes(l.situacao));
    $('estabs').innerHTML = estabs.map(e => {
      const minhas = licencas.filter(l => l.estabelecimento_id === e.id);
      return `<article class="estab-card" data-id="${esc(e.id)}">
        <div class="estab-top">
          <div><span class="estab-tipo">${esc(tipoLabel(e.tipo))}</span><h2>${esc(e.titulo)}</h2>${e.endereco ? `<p class="estab-end">${esc(e.endereco)}</p>` : ''}</div>
          <button type="button" class="link-button muted" data-remover-estab="${esc(e.id)}">Remover</button>
        </div>
        ${minhas.length ? `<ul class="estab-lics">${minhas.map(linhaLicenca).join('')}</ul>` : '<p class="estab-vazio">Nenhuma assinatura neste estabelecimento ainda.</p>'}
        ${livres.length ? `<label class="field estab-vincular"><span>Ligar uma licença que você já tem</span><select data-vincular="${esc(e.id)}"><option value="">Escolha a licença</option>${livres.map(l => `<option value="${esc(l.id)}">BarFácil ${esc(PLANOS[l.plano] || l.plano)} · ${esc((PLATAFORMAS[l.plataforma] || l.plataforma).split(' (')[0])} · •••• ${esc(l.final_chave)}</option>`).join('')}</select></label>` : ''}
        <button type="button" class="button primary wide" data-adquirir="${esc(e.id)}">Adquirir BarFácil para este estabelecimento</button>
      </article>`;
    }).join('');
    $('sem-estab').hidden = estabs.length > 0;
  }

  const fe = $('form-estab');
  fe.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('erro-estab'), titulo = fe.titulo.value.trim(), endereco = fe.endereco.value.trim();
    if (!titulo) return msg(err, 'Dê um nome ao estabelecimento.'), fe.titulo.focus();
    if (!fe.tipo.value) return msg(err, 'Escolha o tipo do estabelecimento.'), fe.tipo.focus();
    msg(err, '');
    const btn = fe.querySelector('button[type="submit"]');
    busy(btn, true, 'Adicionando…');
    const { error } = await sb.from('estabelecimentos').insert({ titulo, endereco: endereco || null, tipo: fe.tipo.value });
    busy(btn, false);
    if (error) { console.error(error); return msg(err, 'Não foi possível adicionar agora. Tente de novo.'); }
    fe.reset();
    await carregarAssinaturas();
    avisar(`"${titulo}" adicionado.`, 'ok-estab');
  });

  $('estabs').addEventListener('change', async e => {
    const sel = e.target.closest('[data-vincular]'); if (!sel || !sel.value) return;
    sel.disabled = true;
    const { error } = await sb.rpc('vincular_estabelecimento', { p_licenca: sel.value, p_estabelecimento: sel.dataset.vincular });
    if (error) { console.error(error); sel.disabled = false; return avisar('Não foi possível ligar a licença agora. Tente de novo.', 'ok-estab'); }
    await carregarAssinaturas();
  });

  $('estabs').addEventListener('click', async e => {
    const des = e.target.closest('[data-desvincular]'), rem = e.target.closest('[data-remover-estab]'), adq = e.target.closest('[data-adquirir]');
    if (des) {
      busy(des, true, '…');
      const { error } = await sb.rpc('vincular_estabelecimento', { p_licenca: des.dataset.desvincular, p_estabelecimento: null });
      if (error) { busy(des, false); console.error(error); return avisar('Não foi possível desvincular agora.', 'ok-estab'); }
      return carregarAssinaturas();
    }
    if (rem) {
      const est = estabs.find(x => x.id === rem.dataset.removerEstab); if (!est) return;
      const n = licencas.filter(l => l.estabelecimento_id === est.id).length;
      const ok = await confirmar({ titulo: `Remover "${est.titulo}"?`, texto: n === 1 ? 'A assinatura ligada a ele <strong>continua valendo</strong>; só fica sem estabelecimento.' : n ? `As ${n} assinaturas ligadas a ele <strong>continuam valendo</strong>; só ficam sem estabelecimento.` : 'O estabelecimento sai da sua lista.', sim: 'Remover', nao: 'Voltar' });
      if (!ok) return;
      const { error } = await sb.from('estabelecimentos').delete().eq('id', est.id);
      if (error) { console.error(error); return avisar('Não foi possível remover agora.', 'ok-estab'); }
      await carregarAssinaturas();
      return avisar(`"${est.titulo}" removido.`, 'ok-estab');
    }
    if (adq) abrirAdquirir(adq.dataset.adquirir);
  });

  /* ---------- adquirir BarFácil (pagamento por Pix pela Asaas: integração depois) ---------- */
  const ja = $('adquirir'), jaFundo = $('adquirir-fundo'), fa = $('form-adquirir');
  let compra = null, focoAntesCompra = null;
  document.querySelectorAll('[data-preco]').forEach(el => { const v = PRECOS[el.dataset.preco]; el.textContent = v != null ? `${reais(v)} por mês` : 'Valor mensal a definir'; });
  if (PRECOS.aparelho_extra != null) $('preco-extra').textContent = `Cada aparelho a mais no mesmo estabelecimento: + ${reais(PRECOS.aparelho_extra)} por mês.`;
  function abrirAdquirir(estabId) {
    const est = estabs.find(x => x.id === estabId); if (!est) return;
    compra = { estabelecimento_id: est.id }; focoAntesCompra = document.activeElement;
    fa.reset(); msg($('aviso-adquirir'), '');
    $('adquirir-para').textContent = `Para ${est.titulo}. Escolha o plano e onde o app vai ser usado.`;
    ja.hidden = false; jaFundo.hidden = false; document.body.classList.add('no-scroll');
    fa.querySelector('input[name=plano]:checked').focus();
  }
  function fecharAdquirir() {
    if (ja.hidden) return;
    ja.hidden = true; jaFundo.hidden = true; document.body.classList.remove('no-scroll');
    if (focoAntesCompra) focoAntesCompra.focus({ preventScroll: true });
  }
  ja.querySelector('[data-fechar-adquirir]').addEventListener('click', fecharAdquirir);
  jaFundo.addEventListener('click', fecharAdquirir);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharAdquirir(); });
  /* Ponto de integração: troque por uma chamada à função que cria a cobrança Pix na Asaas
     (cfg.pagamentos.pix) e mostre o QR Code; quando o pagamento for confirmado, a licença é criada
     já ligada a este estabelecimento. */
  fa.addEventListener('submit', async e => {
    e.preventDefault();
    const pedido = { ...compra, plano: fa.plano.value, plataforma: fa.plataforma.value };
    const integ = (cfg.pagamentos || {}).pix;
    if (typeof integ === 'function') return integ(pedido);
    msg($('aviso-adquirir'), 'O pagamento por Pix está em integração. Em breve você conclui a compra por aqui, e a nova licença aparece neste estabelecimento automaticamente.');
  });

  /* ---------- downloads: instaladores (releases privadas do GitHub) e chave de cada plataforma ---------- */
  // A função download-instalador do Supabase confere o login e devolve o arquivo mais novo
  // e, na hora de baixar, um link temporário do GitHub.
  const PASTAS = { windows: { nome: 'Windows' }, mobile: { nome: 'Android' } };
  const tamanho = n => n ? (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`) : '';
  const instalador = {};

  async function instaladorApi(plataforma, acao) {
    const { data, error } = await sb.functions.invoke('download-instalador', { body: { plataforma, acao } });
    if (error) {
      let motivo = 'falha';
      try { motivo = (await error.context.json()).motivo || motivo; } catch {}
      throw { motivo };
    }
    return data;
  }

  function mostrarChave(card, r) {
    const box = card.querySelector('[data-chave-box]'), nome = PASTAS[card.dataset.plataforma].nome;
    if (r.erro === 'teste_ja_usado') {
      box.innerHTML = `<p class="dl-key-label">Chave para ${nome}</p><p class="dl-key-info">Você já usou o período de teste gratuito no ${nome}. Para continuar, fale com a gente e assine o BarFácil.</p>`;
      return;
    }
    if (r.erro) { box.innerHTML = `<p class="dl-key-info err">Não foi possível carregar sua chave agora. Recarregue a página em instantes.</p>`; return; }
    if (!r.chave) {
      box.innerHTML = `<p class="dl-key-label">Chave para ${nome}</p><p class="dl-key-info">Você ainda não tem uma chave para ${nome}.</p><button type="button" class="link-button" data-gerar>Gerar minha chave de teste grátis (7 dias)</button>`;
      box.querySelector('[data-gerar]').addEventListener('click', e => pegarChave(card, true, e.currentTarget));
      return;
    }
    const tipo = r.teste ? 'Chave de teste · 7 dias a partir da 1ª ativação' : `Plano ${{ basica: 'Básico', premium: 'Premium' }[r.plano] || r.plano}`;
    box.innerHTML = `<p class="dl-key-label">Sua chave para ${nome}</p>
      <div class="dl-key-row"><code>${esc(r.chave)}</code><button type="button" class="dl-copy" data-copiar>Copiar</button></div>
      <p class="dl-key-info">${esc(tipo)}</p>`;
    box.querySelector('[data-copiar]').addEventListener('click', async e => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(r.chave); b.textContent = 'Copiada!'; }
      catch { const t = document.createElement('textarea'); t.value = r.chave; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); b.textContent = 'Copiada!'; }
      setTimeout(() => { b.textContent = 'Copiar'; }, 2000);
    });
  }

  async function pegarChave(card, criar, btn) {
    if (btn) busy(btn, true, 'Gerando…');
    const { data, error } = await sb.rpc('minha_chave', { p_plataforma: card.dataset.plataforma, p_criar: criar });
    if (btn) busy(btn, false);
    const r = error ? { erro: /teste_ja_usado/.test(error.message || '') ? 'teste_ja_usado' : 'falha' } : ((data && data[0]) || {});
    if (error && r.erro === 'falha') console.error(error);
    mostrarChave(card, r);
    if (criar && r.chave && r.criada_agora) carregarAssinaturas();
    return r;
  }

  async function carregarDownloads() {
    document.querySelectorAll('.dl-card').forEach(async card => {
      const plat = card.dataset.plataforma, arq = card.querySelector('[data-arquivo]'), btn = card.querySelector('[data-baixar]');
      pegarChave(card, false);
      try {
        const f = (await instaladorApi(plat, 'info')).arquivo;
        instalador[plat] = f;
        if (!f) { arq.textContent = 'Versão ainda não disponível. Volte em breve.'; return; }
        const data = f.data ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(f.data)) : '';
        arq.textContent = [f.versao ? 'Versão ' + f.versao.replace(/^v/, '') : '', tamanho(f.tamanho), data].filter(Boolean).join(' · ');
        btn.disabled = false;
      } catch (e) { console.error(e); arq.textContent = 'Não foi possível consultar os arquivos agora.'; }
    });
  }

  document.querySelectorAll('.dl-card [data-baixar]').forEach(btn => btn.addEventListener('click', async () => {
    const card = btn.closest('.dl-card'), plat = card.dataset.plataforma, f = instalador[plat];
    if (!f) return;
    busy(btn, true, 'Preparando o download…');
    try {
      // garante a chave de teste para quem ainda não tem (uma por conta e por plataforma)
      await pegarChave(card, true);
      const { url } = await instaladorApi(plat, 'baixar');
      location.href = url;
    } catch (e) {
      console.error(e);
      card.querySelector('[data-arquivo]').textContent = 'Não foi possível iniciar o download. Tente de novo.';
    } finally { setTimeout(() => busy(btn, false), 1500); }
  }));

  /* ---------- meus dados ---------- */
  async function carregarPerfil() {
    const { data } = await sb.from('clientes').select('nome, email, whatsapp, tipo_comercio, metodo').eq('id', user.id).maybeSingle();
    const m = user.user_metadata || {};
    const nome = (data && data.nome) || m.full_name || m.nome || '';
    $('usuario-nome').textContent = nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!';
    $('usuario-email').textContent = user.email || (data && data.email) || '';
    const f = $('form-perfil');
    f.nome.value = nome;
    f.email.value = user.email || (data && data.email) || '';
    f.whatsapp.value = maskPhone((data && data.whatsapp) || m.whatsapp || '');
    f.tipo.value = (data && data.tipo_comercio) || '';
    // senha: só para quem se cadastrou por e-mail
    const google = data && data.metodo === 'google';
    $('senha-google').hidden = !google;
    $('form-trocar-senha').hidden = google;
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
    const mud = { nome, whatsapp: phoneE164(f.whatsapp.value) };
    if (f.tipo.value) mud.tipo_comercio = f.tipo.value;
    const { error } = await sb.from('clientes').update(mud).eq('id', user.id);
    busy(btn, false);
    if (error) return msg(err, 'Não foi possível salvar agora. Tente de novo.');
    $('usuario-nome').textContent = `Olá, ${nome.split(' ')[0]}!`;
    msg(ok, 'Dados atualizados.');
  });

  /* ---------- trocar senha: senha atual + nova + repetir ---------- */
  const ft = $('form-trocar-senha');
  const nivelTroca = ligarMedidor(ft.nova, $('medidor-trocar'), () => [user && user.email, $('form-perfil').nome.value]);
  const botaoTroca = ft.querySelector('button[type="submit"]');
  const atualizarTroca = () => { botaoTroca.disabled = !ft.atual.value || nivelTroca() < 2 || !ft.repetir.value; msg($('erro-senha'), ''); msg($('ok-senha'), ''); };
  ['atual', 'nova', 'repetir'].forEach(n => ft[n].addEventListener('input', atualizarTroca));
  ft.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('erro-senha');
    if (nivelTroca() < 2) return msg(err, 'Escolha uma senha nova pelo menos média. Siga a dica abaixo dos campos.');
    if (ft.nova.value !== ft.repetir.value) return msg(err, 'As duas senhas novas não são iguais.'), ft.repetir.focus();
    if (ft.nova.value === ft.atual.value) return msg(err, 'A senha nova precisa ser diferente da atual.');
    busy(botaoTroca, true, 'Trocando…');
    try {
      // confere a senha atual antes de trocar
      const conf = await sb.auth.signInWithPassword({ email: user.email, password: ft.atual.value });
      if (conf.error) return msg(err, conf.error.status === 429 ? 'Muitas tentativas. Aguarde um minuto e tente de novo.' : 'A senha atual está incorreta.'), ft.atual.focus();
      const { error } = await sb.auth.updateUser({ password: ft.nova.value });
      if (error) return msg(err, /weak|short|characters/i.test(error.message || '') ? 'Essa senha não foi aceita. Use pelo menos 8 caracteres e siga a dica.' : 'Não foi possível trocar a senha agora. Tente de novo.');
      ft.reset(); nivelTroca();
      msg($('ok-senha'), 'Senha trocada. Use a nova na próxima vez que entrar.');
    } finally { busy(botaoTroca, false); botaoTroca.disabled = true; }
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
    // ao fechar, o endereço volta para a tela que está aberta por trás do painel
    if (!semHistorico && location.hash === '#pagamento') history.replaceState(null, '', location.pathname + '#' + telaAtual);
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
  /* Ícones simplificados das bandeiras (troque pelos oficiais da operadora na integração). */
  const svg = body => `<svg viewBox="0 0 40 26" aria-hidden="true" focusable="false">${body}</svg>`;
  const txt = (t, cor, tam = 11, peso = 800, extra = '') => `<text x="20" y="17.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${tam}" font-weight="${peso}" fill="${cor}"${extra}>${t}</text>`;
  const ICONES = {
    'Visa': svg('<rect width="40" height="26" rx="4" fill="#fff"/>' + txt('VISA', '#1a1f71', 11.5, 900, ' font-style="italic" letter-spacing=".5"')),
    'Mastercard': svg('<rect width="40" height="26" rx="4" fill="#fff"/><circle cx="16" cy="13" r="7.5" fill="#eb001b"/><circle cx="24" cy="13" r="7.5" fill="#f79e1b"/><path d="M20 6.6a7.5 7.5 0 0 1 0 12.8 7.5 7.5 0 0 1 0-12.8z" fill="#ff5f00"/>'),
    'Elo': svg('<rect width="40" height="26" rx="4" fill="#111"/><circle cx="8" cy="8.2" r="2.3" fill="#ffcb05"/><circle cx="8" cy="13" r="2.3" fill="#00a4e0"/><circle cx="8" cy="17.8" r="2.3" fill="#ef4123"/>' + '<text x="25.5" y="17.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="800" fill="#fff">elo</text>'),
    'American Express': svg('<rect width="40" height="26" rx="4" fill="#2e77bc"/>' + txt('AMEX', '#fff', 10, 900, ' letter-spacing=".3"')),
    'Hipercard': svg('<rect width="40" height="26" rx="4" fill="#b3131b"/>' + txt('Hiper', '#fff', 10.5, 800)),
    'Diners': svg('<rect width="40" height="26" rx="4" fill="#fff"/><circle cx="20" cy="13" r="8.5" fill="#0079be"/><circle cx="20" cy="13" r="5.6" fill="#fff"/><rect x="19.2" y="7.4" width="1.6" height="11.2" fill="#0079be"/>')
  };
  function mostrarBandeira(b) {
    const el = $('bandeira');
    el.innerHTML = b ? `${ICONES[b] || ''}<span>${b}</span>` : '';
    el.classList.toggle('on', !!b);
  }
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
    mostrarBandeira(b);
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
      fc.numero.value = ''; fc.cvv.value = ''; mostrarBandeira('');
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
    if (!session) {
      // quem veio para baixar o app e ainda não tem conta vai para o cadastro (e volta para os Downloads)
      if (location.hash === '#downloads') return location.replace('cadastro.html?voltar=downloads');
      return location.replace(ENTRAR);
    }
    user = session.user;
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && !saindo) location.replace(ENTRAR); });
    const temCadastro = await carregarPerfil();
    if (!temCadastro) return location.replace('cadastro.html' + (location.hash === '#downloads' ? '?voltar=downloads' : '')); // logou mas não completou o cadastro
    $('area-carregando').hidden = true;
    $('area-conteudo').hidden = false;
    rota();
    carregarAssinaturas();
    carregarDownloads();
  }
  iniciar();
})();
