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
Página de cadastro com nome, e-mail, WhatsApp e "onde ouviu falar de nós". O cliente recebe um código de confirmação por e-mail (o WhatsApp é só um dado de contato) ou entra com o Google. Tudo passa pelo Supabase Auth do projeto do BarFácil (configurado em `config.js`). Arquivos: `cadastro.html`, `cadastro.js`, `conta.js` (base compartilhada), `vendor/supabase-js-2.117.3.min.js` e `supabase/clientes.sql`. A mesma página tem a opção **Entrar** (`cadastro.html#entrar`) para quem já tem conta.

Para funcionar de verdade, configure uma vez no painel do Supabase:

1. **Tabela:** rode `supabase/clientes.sql` no SQL Editor.
2. **Código por e-mail:** em *Authentication → Emails → Magic Link*, inclua `{{ .Token }}` no texto (o modelo padrão manda só um link, não o código). Em *Authentication → Providers → Email*, deixe *Email OTP Expiration* em `600` (10 minutos).
3. **Login com Google:** crie um "OAuth client ID" (tipo *Web application*) no Google Cloud Console, com o redirecionamento `https://sydjqruprgixevqcrhdv.supabase.co/auth/v1/callback`. Cole o Client ID e o Secret em *Authentication → Providers → Google*.
4. **Endereço do site:** em *Authentication → URL Configuration*, coloque o endereço público do site em *Site URL* e em *Redirect URLs* (ex.: `https://seusite.com/cadastro.html`). O login com Google não funciona com o arquivo aberto direto do disco.

A validade do código e a espera entre reenvios ficam em `config.js` (`codeTtlMinutes`, `resendCooldownSeconds`) e precisam bater com o Supabase.

## Área do cliente (`area.html`)
Abre só para quem está logado (quem não está vai para `cadastro.html#entrar`). Arquivos: `area.html`, `area.js` e `supabase/assinaturas.sql`.

- **Login que não expira:** a sessão fica guardada no navegador e é renovada sozinha; o cliente só sai clicando em **Sair**. No Supabase, em *Authentication → Sessions*, deixe **Time-box user sessions** e **Inactivity timeout** desligados (é o padrão).
- **Assinatura:** vem direto das **licenças do app** (tabelas `licenses`, `license_activations` e `premium_keys`). Rode `supabase/licencas-cliente.sql` (depois do `clientes.sql`). Ele cria a função `minhas_licencas()`, que devolve só um resumo das licenças do cliente logado: plano (Teste, Básica ou Premium, já considerando chave premium e volta para a Básica), versão do app, fim do teste ou próxima cobrança (mesmo dia do mês em que a cobrança começou, como no app) e os 4 últimos caracteres da chave. A tabela `licenses` continua fechada para o site.
  - **Como a licença chega à conta:** automaticamente quando o `customer_contact` da licença é o e-mail da conta, ou manualmente com `update licenses set cliente_id = (select id from clientes where email = '...') where license_key = '...';`
  - **Valor mensal:** preencha `precos` em `config.js` para aparecer nos cartões.
- **Dados de pagamento:** painel branco que desliza da direita, com número do cartão (detecta a bandeira), nome impresso, validade, CVV, CPF do titular e autorização de cobrança mensal. Os campos já são conferidos, mas **nada é salvo nem enviado** até a integração com a operadora. O ponto de ligação é a função `salvarCartao` em `area.js` (ative com `payments: { ready: true, salvarCartao }` em `config.js`). Nunca guarde número completo ou CVV no Supabase: use a tokenização da operadora.
- **Meus dados:** o cliente edita nome e WhatsApp.
