(() => {
  const config=window.DIGITALJEW_CONFIG||{}, repo=config.githubRepo;
  const api=`https://api.github.com/repos/${repo}/releases?per_page=12`;
  const $=id=>document.getElementById(id);
  const date=v=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(new Date(v));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Novidades: notas das versões publicadas no GitHub. O download fica na área do cliente.
  async function load(){
    const vazio='<div class="empty-state">As novidades de cada versão aparecem aqui assim que forem publicadas.</div>';
    try{
      const res=await fetch(api,{headers:{Accept:'application/vnd.github+json'}});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const releases=await res.json();
      if(!releases.length){$('release-list').innerHTML=vazio;return;}
      list(releases);
    }catch(e){ $('release-list').innerHTML=vazio; }
  }
  function list(rs){$('release-list').innerHTML=rs.map(r=>`<article class="release-item"><div class="release-date">${esc(date(r.published_at||r.created_at))}</div><div class="release-body"><h3>${esc(r.name||r.tag_name)}</h3><p>${esc(r.body||'Notas desta versão ainda não foram adicionadas.')}</p><span class="release-link">${esc((r.assets||[]).map(a=>a.name).join(' · '))}</span></div><div class="release-tag">${esc(r.tag_name||'RELEASE')}</div></article>`).join('');}
  document.querySelector('.menu-toggle')?.addEventListener('click',e=>{const n=document.querySelector('.nav'),o=n.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(o));});
  document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.nav').classList.remove('open')));
  (()=>{const h=document.querySelector('.hero');if(!h)return;const go=()=>h.classList.add('in');if(!('IntersectionObserver' in window))return go();const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){go();io.disconnect();}},{threshold:.1});io.observe(h);})();
  document.querySelectorAll('.perk-toggle').forEach(b=>{const panel=document.getElementById(b.getAttribute('aria-controls'));const set=o=>{b.setAttribute('aria-expanded',String(o));panel.hidden=!o;};b.addEventListener('click',()=>set(b.getAttribute('aria-expanded')!=='true'));panel.addEventListener('click',()=>set(false));});
  $('year').textContent=new Date().getFullYear();load();
})();