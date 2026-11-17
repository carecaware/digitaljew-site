# DigitalJew Software — Portal

Site institucional e central de downloads do BarFácil. Site estático, sem etapa de build.

## Estrutura
- `index.html` — conteúdo e estrutura das páginas
- `styles.css` — identidade visual e responsividade
- `app.js` — consulta de releases e downloads diretos
- `config.js` — configuração do repositório de releases
- `assets/brand/digitaljew-logo.jpg` — logo usada no cabeçalho, rodapé, favicon e compartilhamento

## Logo
A imagem oficial deve ficar em `assets/brand/digitaljew-logo.jpg`. Substitua esse arquivo para atualizar os pontos de uso; mantenha o mesmo caminho ou ajuste as referências no HTML.

## Downloads
O arquivo `config.js` define o repositório que publica as GitHub Releases. O portal consulta a API pública e aponta o botão diretamente para o asset `browser_download_url`, sem abrir a página do GitHub. O repositório de releases precisa ser público para visitantes sem autenticação. Publique os instaladores como assets das releases (.exe/.msi para Windows).

Atualmente está configurado `carecaware/releases`. Se as releases forem publicadas em outro repositório, altere `githubRepo` em `config.js`.

## Publicação
Pode ser hospedado no GitHub Pages, Vercel ou qualquer hospedagem estática. Nenhum Node.js é necessário.

## Paleta da marca
- Navy `#182838`
- Azul profundo `#202f40`
- Ciano `#58c0d0`
- Azul-ciano `#3898b8`
- Dourado `#f8c058`
- Branco `#f8f8f8`

O catálogo apresenta somente o BarFácil nesta primeira fase.