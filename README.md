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
## Cadastro de clientes (`cadastro.html`)
Página de cadastro com nome, e-mail, WhatsApp e "onde ouviu falar de nós". O cliente recebe um código de confirmação por e-mail (o WhatsApp é só um dado de contato) ou entra com o Google. Tudo passa pelo Supabase Auth do projeto do BarFácil (configurado em `config.js`). Arquivos: `cadastro.html`, `cadastro.js`, `vendor/supabase-js-2.117.3.min.js` e `supabase/clientes.sql`.

Para funcionar de verdade, configure uma vez no painel do Supabase:

1. **Tabela:** rode `supabase/clientes.sql` no SQL Editor.
2. **Código por e-mail:** em *Authentication → Emails → Magic Link*, inclua `{{ .Token }}` no texto (o modelo padrão manda só um link, não o código). Em *Authentication → Providers → Email*, deixe *Email OTP Expiration* em `600` (10 minutos).
3. **Login com Google:** crie um "OAuth client ID" (tipo *Web application*) no Google Cloud Console, com o redirecionamento `https://sydjqruprgixevqcrhdv.supabase.co/auth/v1/callback`. Cole o Client ID e o Secret em *Authentication → Providers → Google*.
4. **Endereço do site:** em *Authentication → URL Configuration*, coloque o endereço público do site em *Site URL* e em *Redirect URLs* (ex.: `https://seusite.com/cadastro.html`). O login com Google não funciona com o arquivo aberto direto do disco.

A validade do código e a espera entre reenvios ficam em `config.js` (`codeTtlMinutes`, `resendCooldownSeconds`) e precisam bater com o Supabase.
