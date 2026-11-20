(() => {
  const config=window.DIGITALJEW_CONFIG||{}, repo=config.githubRepo;
  const api=`https://api.github.com/repos/${repo}/releases?per_page=12`;
  const $=id=>document.getElementById(id);
  const date=v=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(new Date(v));
  const size=n=>n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    try{
      const res=await fetch(api,{headers:{Accept:'application/vnd.github+json'}});
      if(!res.ok)throw new Error(res.status===404?'Repositório de releases não encontrado ou ainda privado. Para downloads públicos, o repositório de releases precisa estar público.':'Não foi possível consultar as versões (HTTP '+res.status+').');
      const releases=await res.json();
      if(!releases.length)throw new Error('Ainda não há releases publicadas. Assim que a primeira versão oficial estiver disponível, o download aparecerá aqui.');
      latest(releases[0]);list(releases);
    }catch(e){
      $('release-summary').textContent=e.message;$('download-button').textContent='Download indisponível';
      $('download-button').classList.add('disabled');$('download-button').setAttribute('aria-disabled','true');
      $('release-error').hidden=false;$('release-error').textContent=e.message;
      $('release-list').innerHTML='<div class="empty-state">'+esc(e.message)+'</div>';
    }
  }
  function latest(r){
    const asset=(r.assets||[]).find(a=>(config.windowsAssetPattern||/\.(exe|msi)$/i).test(a.name));
    $('release-version').textContent=r.tag_name||r.name||'—';
    $('release-date').textContent=date(r.published_at||r.created_at);
    $('release-size').textContent=asset?size(asset.size):'Aguardando instalador';
    $('release-summary').textContent=asset?`${asset.name} · ${size(asset.size)} · Download direto`:'Release publicada, mas sem instalador Windows (.exe ou .msi).';
    if(asset){const b=$('download-button');b.href=asset.browser_download_url;b.download=asset.name;b.textContent='Baixar para Windows';b.classList.remove('disabled');b.removeAttribute('aria-disabled');}
    else{$('download-button').textContent='Instalador não publicado';$('download-button').classList.add('disabled');}
  }
  function list(rs){$('release-list').innerHTML=rs.map(r=>`<article class="release-item"><div class="release-date">${esc(date(r.published_at||r.created_at))}</div><div class="release-body"><h3>${esc(r.name||r.tag_name)}</h3><p>${esc(r.body||'Notas desta versão ainda não foram adicionadas.')}</p><span class="release-link">${esc((r.assets||[]).map(a=>a.name).join(' · '))}</span></div><div class="release-tag">${esc(r.tag_name||'RELEASE')}</div></article>`).join('');}
  document.querySelector('.menu-toggle')?.addEventListener('click',e=>{const n=document.querySelector('.nav'),o=n.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(o));});
  document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.nav').classList.remove('open')));
  (()=>{const h=document.querySelector('.hero');if(!h)return;const go=()=>h.classList.add('in');if(!('IntersectionObserver' in window))return go();const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){go();io.disconnect();}},{threshold:.1});io.observe(h);})();
  document.querySelectorAll('.perk-toggle').forEach(b=>{const panel=document.getElementById(b.getAttribute('aria-controls'));const set=o=>{b.setAttribute('aria-expanded',String(o));panel.hidden=!o;};b.addEventListener('click',()=>set(b.getAttribute('aria-expanded')!=='true'));panel.addEventListener('click',()=>set(false));});
  $('year').textContent=new Date().getFullYear();load();
})();