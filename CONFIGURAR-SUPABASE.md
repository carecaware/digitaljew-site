# Configuração: Supabase, GitHub e publicação

Lista do que precisa ser feito uma vez para o cadastro, a área do cliente, os downloads e a trava de
teste funcionarem de verdade. Vá marcando `[x]` conforme terminar.

Projeto Supabase: `sydjqruprgixevqcrhdv` · Site: branch `pagina-cadastro` · App: branch `teste-por-aparelho`

---

## 1. SQL Editor (nesta ordem)

Em cada arquivo: abra o link, clique no ícone de **copiar** (dois quadradinhos, no canto superior
direito do código), cole em **SQL Editor → New query** e clique em **Run**. Todos podem ser
rodados mais de uma vez; se você rodou uma versão antiga, rode a atual por cima.

- [x] **1.1** `clientes.sql` (site) — tabela de clientes
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/clientes.sql
- [x] **1.2** `licencas-cliente.sql` (site) — liga as licenças à conta e alimenta a aba Assinatura
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/licencas-cliente.sql
- [x] **1.3** `migration-008.sql` (app) — um teste por aparelho
  https://github.com/carecaware/barfacil-source-code/blob/teste-por-aparelho/supabase/migration-008.sql
- [x] **1.4** `downloads-e-chaves.sql` (site) — chave de teste automática e permissão de download
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/downloads-e-chaves.sql
- [x] **1.5** `estabelecimentos.sql` (site) — Meus estabelecimentos (rode depois do 1.4)
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/estabelecimentos.sql

**Limpeza (só se você rodou versões antigas):**
- [ ] Tabela `assinaturas`, se existir e estiver vazia: `drop table if exists assinaturas;`
- [ ] Pasta `instaladores` do Storage, da primeira versão dos downloads:
  `drop policy if exists "clientes baixam instaladores" on storage.objects;` e depois apague a
  pasta em **Storage**.

## 2. Edge Functions

- [x] **2.1** Segredo `GITHUB_TOKEN` em **Edge Functions → Secrets**: token *fine-grained* só do
  `carecaware/releases`, com **Contents: Read-only**.
- [x] **2.2** Função **`download-instalador`** (nova): **Deploy a new function → Via Editor**, nome
  exatamente `download-instalador`, cole o código e faça o deploy:
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/functions/download-instalador/index.ts
- [x] **2.3** Na `download-instalador`, **desligue "Enforce JWT verification"** (a própria função
  confere o login nos downloads; a seção Novidades é pública).
- [x] **2.4** Função **`validate-license`** (já existe): substitua o código por este e faça o deploy,
  mantendo o "Enforce JWT verification" **desligado** — rode antes o item 1.3:
  https://github.com/carecaware/barfacil-source-code/blob/teste-por-aparelho/supabase/functions/validate-license/index.ts

Pelo terminal, com o Supabase CLI, os itens 2.2 a 2.4 são:
`supabase functions deploy download-instalador --no-verify-jwt` (na pasta do site) e
`supabase functions deploy validate-license --no-verify-jwt` (na pasta do app).

## 3. Authentication

- [x] **3.0 Serviço de e-mail próprio (SMTP) — OBRIGATÓRIO.** O envio embutido do Supabase manda só
  2 e-mails por hora e só para membros da equipe do projeto: clientes não recebem o código. Crie uma
  conta num serviço como **Resend** ou **Brevo** (há planos gratuitos) e preencha em
  *Authentication → Emails → SMTP Settings* (host, porta, usuário, senha e remetente). O ideal é ter
  um domínio próprio para o remetente.
- [x] **3.1 Modelos de e-mail** (só depois do 3.0: no plano gratuito o Supabase não deixa editar os
  modelos sem SMTP próprio). Os textos prontos, em português, estão em `supabase/emails/`; o assunto
  está na primeira linha de cada arquivo:
  - `confirmar-cadastro.html` → *Confirm signup* (código para quem se cadastra)
  - `codigo-de-acesso.html` → *Magic Link* (código para conta que já existe)
  - `redefinir-senha.html` → *Reset password* (link do "Esqueci a senha", funciona em qualquer aparelho)
  Sem eles, o cliente recebe um link em inglês em vez do código. Com o token do Supabase nesta sessão,
  o Claude aplica os três de uma vez.
- [x] **3.2 Providers → Email:** validade do código = `600` (10 minutos), código com 6 dígitos e senha
  com no mínimo 8 caracteres.
- [x] **3.3 Providers → Google:** ative e cole o *Client ID* e o *Client Secret*. No Google Cloud
  Console, a credencial (tipo *Web application*) precisa ter o redirecionamento
  `https://sydjqruprgixevqcrhdv.supabase.co/auth/v1/callback`. Publique o app de consentimento
  ("Publish app") para sair do modo de teste.
- [ ] **3.4 URL Configuration:** (já feito para testar no PC: `http://localhost:8000`; falta o
  endereço público quando o site estiver no ar)
  - *Site URL*: o endereço público do site.
  - *Redirect URLs*: `https://SEU-SITE/**` e, para testar no PC, `http://localhost:8000/**`.
- [x] **3.5 Sessions:** *Time-box user sessions* e *Inactivity timeout* **desligados** (padrão) —
  é o que mantém o cliente logado até clicar em "Sair".

## 3b. E-mail de boas-vindas (função `boas-vindas`, já implantada)

- [x] **3b.1** No Brevo, crie uma chave em *SMTP & API → API Keys* (é diferente da chave SMTP).
- [x] **3b.2** Em *Supabase → Edge Functions → Secrets*, crie:
  - `BREVO_API_KEY` = a chave do passo anterior
  - `EMAIL_REMETENTE` = o e-mail remetente verificado no Brevo
  - `SITE_URL` = o endereço público do site (opcional; sem ele, o e-mail vai sem o botão "Baixar")
  Sem esses segredos, o cadastro funciona normalmente, só não envia o e-mail de boas-vindas.
  Pré-visualização do e-mail: `supabase/emails/boas-vindas.html`.

## 4. Dados

- [ ] **4.1** Ligar as licenças que já existem aos clientes. Automático quando o `customer_contact`
  da licença é o e-mail da conta. Para ligar à mão:
  ```sql
  update licenses set cliente_id = (select id from clientes where email = 'cliente@exemplo.com')
  where license_key = 'XXXX-XXXX-XXXX-XXXX';
  ```
- [ ] **4.2** (Opcional) Preços na aba Assinatura: preencha `precos` no `config.js` do site.

## 5. GitHub

- [ ] **5.0** Revisar as releases que já estão no `carecaware/releases`: a mais nova (v1.0.13) é uma
  versão interna com botões de bypass, e a nota dela aparece na seção Novidades. Apague-as ou marque
  como *pre-release* antes de o site ir ao ar (o site ignora pré-lançamentos).
- [ ] **5.1** Token de escrita novo (*fine-grained*, só `carecaware/releases`, **Contents: Read and
  write**, validade mais longa permitida) e colado em `barfacil-source-code` → *Settings → Secrets
  and variables → Actions* → **`RELEASES_TOKEN`** (no GitHub, **não** no Supabase).
- [ ] **5.2** Apagar o token antigo na lista de tokens do GitHub.
- [ ] **5.3** Se a organização exigir, aprovar os tokens em *carecaware → Settings → Personal
  access tokens*.
- [ ] **5.4** Ter pelo menos uma release no `carecaware/releases` com o `.exe` e o `.apk` (pela tag
  de versão com `scripts/release.sh`, ou criando a release à mão e anexando os arquivos).

## 6. Colocar no ar

- [ ] **6.1** App: juntar a branch `teste-por-aparelho` e gerar uma versão nova (é ela que mostra a
  mensagem "Este aparelho já usou o período de teste gratuito").
- [ ] **6.2** Site: preencher os campos amarelos da `politica-privacidade.html` (nome ou razão
  social, CPF/CNPJ, cidade e e-mail de privacidade).
- [ ] **6.3** Site: publicar a versão da branch `pagina-cadastro`.

## 7. Conferir que funcionou

- [x] A seção **Novidades** da página inicial mostra as versões publicadas (prova que o
  `GITHUB_TOKEN` e a `download-instalador` estão certos) — conferido ao vivo.
- [ ] Cadastro com um e-mail seu: chega o **código de 6 dígitos** e o cadastro termina.
- [ ] Aba **Downloads**: aparece a versão, o botão baixa o instalador e aparece a chave de teste.
- [ ] A chave ativa o app num computador; uma **segunda** chave de teste no mesmo computador é recusada.
- [ ] **Entrar com Google** funciona no endereço público do site.
- [ ] Apague as contas de teste em *Authentication → Users* se quiser.
