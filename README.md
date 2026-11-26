# DigitalJew Software — Portal

> **Para colocar tudo no ar, siga a lista [CONFIGURAR-SUPABASE.md](CONFIGURAR-SUPABASE.md).**


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
Os downloads ficam na área do cliente (veja "Downloads e chave de teste" abaixo). A seção **Novidades** da página inicial mostra as notas das 12 versões mais recentes do `carecaware/releases`, entregues pela mesma função `download-instalador` (esta parte é pública e não exige login). As notas vêm do texto de cada release, que o `release.yml` do app preenche com a seção da versão no `CHANGELOG.md`.

O repositório usado é o `carecaware/releases`. Para trocar, crie no Supabase o segredo `RELEASES_REPO` com o novo `dono/repositorio`.

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
Abre só para quem está logado (quem não está vai para `cadastro.html#entrar`). Arquivos: `area.html`, `area.js` e `supabase/licencas-cliente.sql`.

- **Login que não expira:** a sessão fica guardada no navegador e é renovada sozinha; o cliente só sai clicando em **Sair**. No Supabase, em *Authentication → Sessions*, deixe **Time-box user sessions** e **Inactivity timeout** desligados (é o padrão).
- **Assinatura:** vem direto das **licenças do app** (tabelas `licenses`, `license_activations` e `premium_keys`). Rode `supabase/licencas-cliente.sql` (depois do `clientes.sql`). Ele cria a função `minhas_licencas()`, que devolve só um resumo das licenças do cliente logado: plano (Teste, Básica ou Premium, já considerando chave premium e volta para a Básica), versão do app, fim do teste ou próxima cobrança (mesmo dia do mês em que a cobrança começou, como no app) e os 4 últimos caracteres da chave. A tabela `licenses` continua fechada para o site.
  - **Como a licença chega à conta:** automaticamente quando o `customer_contact` da licença é o e-mail da conta, ou manualmente com `update licenses set cliente_id = (select id from clientes where email = '...') where license_key = '...';`
  - **Valor mensal:** preencha `precos` em `config.js` para aparecer nos cartões.
- **Dados de pagamento:** painel branco que desliza da direita, com número do cartão (detecta a bandeira), nome impresso, validade, CVV, CPF do titular e autorização de cobrança mensal. Os campos já são conferidos, mas **nada é salvo nem enviado** até a integração com a operadora. O ponto de ligação é a função `salvarCartao` em `area.js` (ative com `payments: { ready: true, salvarCartao }` em `config.js`). Nunca guarde número completo ou CVV no Supabase: use a tokenização da operadora.
- **Meus dados:** o cliente edita nome e WhatsApp.

## Downloads e chave de teste (área do cliente → Downloads)
Para baixar o app é preciso ter conta. Os botões "Baixar" do site levam para `area.html#downloads`; quem não está logado vai para o cadastro e volta direto para os Downloads.

- **Instaladores:** ficam nas **releases do repositório privado `carecaware/releases`** no GitHub (grátis, sem limite de tamanho ou de downloads que preocupe). Quem entrega o arquivo é a função `supabase/functions/download-instalador`: ela confere se a pessoa está logada e cadastrada, acha o `.exe`/`.apk` da release mais nova (ignora rascunhos e pré-lançamentos) e devolve um link temporário do próprio GitHub. Cada versão nova é publicada ali automaticamente pelo `release.yml` do app quando você cria a tag (`scripts/release.sh`); também dá para criar a release à mão no GitHub e anexar os arquivos.
- **Chave:** cada conta recebe **uma** chave de teste de 7 dias por plataforma (Windows e Android), criada automaticamente na primeira vez que a pessoa baixa ou clica em "Gerar minha chave". Se o cliente já tiver uma chave paga ligada ao e-mail, é ela que aparece. Uma conta que já teve teste numa plataforma não ganha outro.
- **Um teste por aparelho:** garantido na ativação pelo app (`migration-008.sql` e a função `validate-license` do repositório do app). Mesmo criando várias contas, o mesmo computador não ativa um segundo teste.
- **Configuração, nesta ordem:** `clientes.sql` → `licencas-cliente.sql` → `migration-008.sql` (repositório do app) → `downloads-e-chaves.sql`. Depois, implante de novo a função `validate-license` (repositório do app) e implante a `download-instalador` (deste repositório):
  1. Crie um token *fine-grained* no GitHub com acesso **só** ao `carecaware/releases` e permissão **Contents: Read-only**.
  2. No Supabase, em *Edge Functions → Secrets*, crie o segredo `GITHUB_TOKEN` com esse token.
  3. `supabase functions deploy download-instalador --no-verify-jwt` (a própria função confere o login nos downloads; as Novidades são públicas).
  4. No repositório do app, em *Settings → Secrets and variables → Actions*, crie o segredo `RELEASES_TOKEN` com outro token *fine-grained* só do `carecaware/releases`, com **Contents: Read and write** (é o que publica as versões).

## Cadastro, senha e boas-vindas
- **Google:** sem código nem link. No primeiro acesso, uma tela única pede nome (já preenchido com o nome do Google), WhatsApp e tipo de comércio. O nome que veio do Google fica gravado nas licenças do cliente, na coluna `licenses.client_temp_name`.
- **E-mail:** dados → código no e-mail → **criar senha** (medidor fraca/média/forte/muito forte; aceita a partir de média; mínimo de 8 caracteres) → pronto. Depois disso, o login é com e-mail e senha.
- **Esqueci a senha:** janela no "Entrar" que envia o link; a página `redefinir-senha.html` cria a senha nova. Em *Meus dados*, quem tem senha troca informando a atual, a nova e a repetição.
- **Boas-vindas:** a função `supabase/functions/boas-vindas` envia o e-mail pelo Brevo uma única vez por cliente (coluna `clientes.boas_vindas_em`). Precisa dos segredos `BREVO_API_KEY` e `EMAIL_REMETENTE` (e `SITE_URL`, opcional).
