# Configuração: Supabase, GitHub e publicação

Lista do que precisa ser feito uma vez para o cadastro, a área do cliente, os downloads e a trava de
teste funcionarem de verdade. Vá marcando `[x]` conforme terminar.

Projeto Supabase: `sydjqruprgixevqcrhdv` · Site: branch `pagina-cadastro` · App: branch `teste-por-aparelho`

---

## 1. SQL Editor (nesta ordem)

Em cada arquivo: abra o link, clique no ícone de **copiar** (dois quadradinhos, no canto superior
direito do código), cole em **SQL Editor → New query** e clique em **Run**. Todos podem ser
rodados mais de uma vez; se você rodou uma versão antiga, rode a atual por cima.

- [ ] **1.1** `clientes.sql` (site) — tabela de clientes
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/clientes.sql
- [ ] **1.2** `licencas-cliente.sql` (site) — liga as licenças à conta e alimenta a aba Assinatura
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/licencas-cliente.sql
- [ ] **1.3** `migration-008.sql` (app) — um teste por aparelho
  https://github.com/carecaware/barfacil-source-code/blob/teste-por-aparelho/supabase/migration-008.sql
- [ ] **1.4** `downloads-e-chaves.sql` (site) — chave de teste automática e permissão de download
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/downloads-e-chaves.sql

**Limpeza (só se você rodou versões antigas):**
- [ ] Tabela `assinaturas`, se existir e estiver vazia: `drop table if exists assinaturas;`
- [ ] Pasta `instaladores` do Storage, da primeira versão dos downloads:
  `drop policy if exists "clientes baixam instaladores" on storage.objects;` e depois apague a
  pasta em **Storage**.

## 2. Edge Functions

- [ ] **2.1** Segredo `GITHUB_TOKEN` em **Edge Functions → Secrets**: token *fine-grained* só do
  `carecaware/releases`, com **Contents: Read-only**.
- [ ] **2.2** Função **`download-instalador`** (nova): **Deploy a new function → Via Editor**, nome
  exatamente `download-instalador`, cole o código e faça o deploy:
  https://github.com/carecaware/digitaljew-site/blob/pagina-cadastro/supabase/functions/download-instalador/index.ts
- [ ] **2.3** Na `download-instalador`, **desligue "Enforce JWT verification"** (a própria função
  confere o login nos downloads; a seção Novidades é pública).
- [ ] **2.4** Função **`validate-license`** (já existe): substitua o código por este e faça o deploy,
  mantendo o "Enforce JWT verification" **desligado** — rode antes o item 1.3:
  https://github.com/carecaware/barfacil-source-code/blob/teste-por-aparelho/supabase/functions/validate-license/index.ts

Pelo terminal, com o Supabase CLI, os itens 2.2 a 2.4 são:
`supabase functions deploy download-instalador --no-verify-jwt` (na pasta do site) e
`supabase functions deploy validate-license --no-verify-jwt` (na pasta do app).

## 3. Authentication

- [ ] **3.1 Emails → Magic Link:** inclua `{{ .Token }}` no texto, por exemplo:
  `Seu código de acesso à DigitalJew é: {{ .Token }}. Ele vale por 10 minutos.`
  Sem isso, o cliente recebe um link em vez do código de 6 dígitos.
- [ ] **3.2 Providers → Email:** *Email OTP Expiration* = `600` (10 minutos, o mesmo do site).
- [ ] **3.3 Providers → Google:** ative e cole o *Client ID* e o *Client Secret*. No Google Cloud
  Console, a credencial (tipo *Web application*) precisa ter o redirecionamento
  `https://sydjqruprgixevqcrhdv.supabase.co/auth/v1/callback`. Publique o app de consentimento
  ("Publish app") para sair do modo de teste.
- [ ] **3.4 URL Configuration:**
  - *Site URL*: o endereço público do site.
  - *Redirect URLs*: `https://SEU-SITE/**` e, para testar no PC, `http://localhost:8000/**`.
- [ ] **3.5 Sessions:** *Time-box user sessions* e *Inactivity timeout* **desligados** (padrão) —
  é o que mantém o cliente logado até clicar em "Sair".

## 4. Dados

- [ ] **4.1** Ligar as licenças que já existem aos clientes. Automático quando o `customer_contact`
  da licença é o e-mail da conta. Para ligar à mão:
  ```sql
  update licenses set cliente_id = (select id from clientes where email = 'cliente@exemplo.com')
  where license_key = 'XXXX-XXXX-XXXX-XXXX';
  ```
- [ ] **4.2** (Opcional) Preços na aba Assinatura: preencha `precos` no `config.js` do site.

## 5. GitHub

- [ ] **5.1** Token de escrita novo (*fine-grained*, só `carecaware/releases`, **Contents: Read and
  write**, validade mais longa permitida) e colado em `barfacil-source-code` → *Settings → Secrets
  and variables → Actions* → **`RELEASES_TOKEN`**.
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

- [ ] A seção **Novidades** da página inicial mostra as versões publicadas (prova que o
  `GITHUB_TOKEN` e a `download-instalador` estão certos).
- [ ] Cadastro com um e-mail seu: chega o **código de 6 dígitos** e o cadastro termina.
- [ ] Aba **Downloads**: aparece a versão, o botão baixa o instalador e aparece a chave de teste.
- [ ] A chave ativa o app num computador; uma **segunda** chave de teste no mesmo computador é recusada.
- [ ] **Entrar com Google** funciona no endereço público do site.
- [ ] Apague as contas de teste em *Authentication → Users* se quiser.
