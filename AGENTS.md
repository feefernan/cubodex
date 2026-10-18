# AGENTS.md — Cubodex

Instruções para **qualquer agente de IA (de qualquer modelo/ferramenta) e pessoa** que trabalhe neste repositório.
`CLAUDE.md` aponta para este arquivo. Se uma regra aqui conflitar com o seu padrão, **esta vence**.

## O projeto

Loja da **Cubodex** — uma loja, duas portas: **colecionar** (cartas de pokémon originais com enciclopédia de sets e
cofre virtual; miniaturas Cubodex impressas em 3D em séries numeradas, com a Dex) e **criar** (peças impressas em 3D,
prontas ou sob medida com orçamento no WhatsApp). Instagram/TikTok `@cubodex`.

Site (Vite + TypeScript, sem framework) e API da loja (`worker/`, em `/api/*`) num único Worker no **Cloudflare**.
Preço e estoque vêm do Notion, frete do Melhor Envio, pagamento do Checkout Pro do Mercado Pago. Cada integração
liga quando o segredo existe; sem ele a rota responde 503 e o site explica. O que falta para abrir a loja está nas
issues `precisa-de-você`.

**Contas próprias:** Cloudflare, Notion e Melhor Envio do Cubodex são contas **novas, separadas do Hortelã**. Só o
**Mercado Pago é o mesmo** do Hortelã. Nunca publique nem grave nada do Cubodex com credenciais do Hortelã (exceto MP).

## Fluxo de trabalho obrigatório: issue → branch → PR → deploy

1. **Toda tarefa tem uma issue no GitHub** antes de qualquer código — correção (`bug`), melhoria (`melhoria`) ou
   função nova (`feature`). Sem issue, crie uma (`gh issue create`) usando os templates em `.github/ISSUE_TEMPLATE`.
2. **Uma branch por issue**, a partir da `main` (ou da branch da qual depende), com o nome
   `<tipo>/<número-da-issue>-<slug>` — ex.: `fix/7-carrinho-preco`.
3. **Commits em Conventional Commits** (validado por commitlint): `feat: …`, `fix: …`, `chore: …`, `ci: …`,
   `docs: …`, `test: …`, `refactor: …`, `perf: …`. Mensagens em português.
4. **Toda mudança entra por Pull Request.** Nunca dê push direto na `main`.
5. **A descrição do PR menciona a(s) issue(s)** com palavra-chave de fechamento: `Closes #7` (ou `Refs #7`
   quando o PR não resolve tudo). Use o template `.github/pull_request_template.md`.
6. O PR só é mergeado com **CI verde** (tipos, Biome, arquitetura, Knip, unidade/integração com cobertura,
   mutação, e2e). Merge na `main` = **deploy automático** no Cloudflare (workflow `deploy.yml`).
7. PRs que dependem de outro PR usam a branch dele como base (PRs empilhados) e dizem isso na descrição.

## Comandos

| Objetivo | Comando |
|---|---|
| Rodar local | `npm run dev` |
| Build de produção | `npm run build` (saída em `.cloudflare/output`) |
| Tudo que o CI checa | `npm run check` |
| Lint/format (Biome) | `npm run lint` · `npm run lint:fix` |
| Contratos de arquitetura | `npm run arch` (dependency-cruiser) |
| Código morto | `npm run knip` |
| Unidade + integração | `npm test` · `npm run test:coverage` |
| End-to-end | `npm run test:e2e` (Playwright, desktop + mobile) |
| Testes de mutação | `npm run test:mutation` (Stryker, só `src/domain`) |
| API local (Worker junto do site) | `npm run dev` (o plugin do Cloudflare roda o Worker em `/api/*`) |
| Banco das contas local (D1) | `npm run db:local` (aplica `worker/migrations`; o link de login aparece no log do `npm run dev`) |
| Tipos do Worker | `npm run typecheck` (inclui `cf workers types` + `tsc -p worker`) |
| Deploy (só pelo CI) | `npx cf deploy` com `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` da conta do Cubodex |

## Arquitetura (contratos verificados no CI)

```
src/
  domain/   regras puras: catálogo, estoque, filtros do TCG, carrinho, pedido, frete, Dex e cofre, validação, rotas
  infra/    integrações do navegador: localStorage, cliente da API (/api/*) e ViaCEP
  ui/       DOM e interação, um módulo por área: tcg, cart, order, vault, collectibles, account, pages, theme, router
  styles/   CSS
  main.ts   composição/bootstrap — ninguém importa main.ts
worker/src/ API da loja (mesmo Worker do site, só /api/*)
  app.ts            rotas, limite por IP, CSRF (só JSON); catálogo, frete, pedido, webhook, status, avisos
  notion.ts         bancos Produtos, Pedidos e Avisos do Notion do Cubodex
  mercado-pago.ts   Checkout Pro: preferência, consulta de pagamento, assinatura do webhook
  melhor-envio.ts   cotação de frete
  accounts.ts       contas no D1: link mágico, sessões (só hash), Dex, cofre, espelho dos pedidos, LGPD
  account-routes.ts /api/auth/*, /api/me, /api/dex; email.ts manda o link (Cloudflare Email Service)
worker/migrations/  esquema do D1 (o CI cria o banco e aplica antes do deploy)
  entry.ts          ponto de entrada; confere o Env local contra os tipos gerados
legacy/     o protótipo original em um único HTML, só para consulta (não é publicado)
cloudflare.config.ts   Worker + assets + bindings (CLI `cf`)
```

**Fluxo do pedido:**
1. O site aplica preço e estoque de `GET /api/catalog` (Notion) sobre o catálogo do código.
2. No carrinho, o CEP vira opções de frete por `POST /api/shipping/quote` (Melhor Envio). O endereço vem do ViaCEP.
3. "Finalizar compra" envia só ids, quantidades, destino (enviar/cofre), cliente, endereço e o serviço de frete para
   `POST /api/orders`. O Worker recalcula preço e estoque com `src/domain`, **recota o frete**, gera o serial, cria a
   cobrança no Mercado Pago (aplicação própria do Cubodex) e grava em **Pedidos** no Notion → `{ serial, checkoutUrl }`.
4. O Mercado Pago devolve para `#/pedido/<serial>`, que mostra o status (`GET /api/orders/:serial/status`) e, pago,
   esvazia o carrinho. O aviso `POST /api/mp/webhook` (URL cadastrada no **painel** da aplicação, nunca como
   `notification_url`) confere a assinatura, muda o status e dá baixa no estoque das cartas.
Dinheiro, frete e serial **nunca** são decididos no navegador.

**Contas:** Entrar com Google (#43), sem senha e sem e-mail para enviar. `GET /api/auth/google` manda para o Google
com state e PKCE num cookie de 10 min; `GET /api/auth/google/callback` confere o state, troca o código, exige
`email_verified` e cria a sessão em cookie `HttpOnly; Secure; SameSite=Lax`. A conta é o e-mail. Dex e cofre ficam no
D1. Item comprado com "guardar no cofre" só entra no cofre com o pagamento confirmado; o envio do cofre é cobrado no
Mercado Pago (`POST /api/vault/ship`). A conta não pode ser apagada com itens no cofre (são bens do cliente). Sem
`GOOGLE_CLIENT_ID` (config) e `GOOGLE_CLIENT_SECRET` (segredo), o login responde 503.

- `domain/` **não importa** `infra/` nem `ui/` e não toca no DOM. Toda regra de negócio nova nasce aqui, com teste.
- `infra/` **não importa** `ui/`.
- `worker/src` **só importa** `src/domain/` (nada de DOM, `ui/` ou `infra/` do site).
- Sem dependências circulares. O `router` não importa telas: cada tela se registra com `registerView`.
- Eventos: o HTML declara `data-action="nome"` (clique), `data-input="nome"` (digitação) ou um `id` de formulário,
  e o módulo registra `onAction` / `onInput` / `onSubmit` (`src/ui/dom.ts`).
  **Não use** `onclick="..."` inline nem funções globais em `window`.
- Todo texto vindo de dados entra no HTML por `escapeHtml` (`src/domain/format.ts`).

## Qualidade

- **Biome** é o único linter/formatter (sem ESLint/Prettier). Rode `npm run lint:fix` antes de commitar
  (o hook de pre-commit já roda via husky + lint-staged).
- **Knip**: não deixe exports, arquivos ou dependências sem uso.
- **Testes**: todo bug corrigido ganha um teste que falharia antes da correção.
  - `tests/unit` — domínio e infra (ambiente node).
  - `tests/integration` — monta o `index.html` real no jsdom e exercita a UI (API e ViaCEP simulados).
  - `tests/worker` — rotas do Worker com Notion, Mercado Pago e Melhor Envio simulados.
  - `e2e/` — Playwright contra o build de produção, em desktop e mobile.
- **Cobertura** é catraca: os limites em `vitest.config.ts` só sobem. Relatório vai para o Codecov.
- **Mutação**: score mínimo 60% (`stryker.config.json`). Vitest fica fixado na v4 até o runner do Stryker
  suportar a v5.

## Revisão de código (skill ponytail)

Skill vendorizada em `.claude/skills/ponytail*` (de github.com/DietrichGebert/ponytail, MIT).

- **Ao escrever código:** siga a `ponytail` no nível `full` — a menor mudança que resolve a tarefa
  inteira, reaproveitando o que já existe (domínio, helpers, tokens), sem abstração ou opção que
  ninguém pediu. Nunca corte validação na borda, tratamento de erro que evita perda de dados,
  segurança, acessibilidade, testes ou o que este AGENTS.md exige (motion, `prefers-reduced-motion`).
- **Antes de pedir merge:** rode a `ponytail-review` sobre o diff do PR e cole o resultado
  (`Verdict: …`) na descrição. Achados de "Must fix" são corrigidos no próprio PR.
- **Atalho consciente:** quando aceitar um limite conhecido, deixe o comentário
  `shortcut: <o limite>, <quando melhorar>` — a `ponytail-debt` lista todos.
- **Auditoria periódica:** `ponytail-audit` no repositório inteiro; cada achado vira issue.
- Em conflito entre a skill e este arquivo, **este arquivo vence**.

## Motion e estados de carregamento

Use a skill **design-motion-principles** (`.claude/skills/design-motion-principles`, de
github.com/kylezantos/design-motion-principles). Contexto: **e-commerce** → peso primário **Jakub Krehel**
(polimento sutil), secundário **Emil Kowalski** (contenção nas interações frequentes). Plano em #13.

Regras:
- Todo conteúdo assíncrono tem **skeleton** enquanto carrega; imagens usam **lazy loading** e entram com fade.
- Entrada = opacity + translateY pequeno + blur; **saída mais sutil que a entrada**; nunca `ease`/`ease-in-out`
  puros — use tokens de easing/duração.
- Ações com espera (pagamento, cálculo de frete real) mostram **progresso**.
- Anime só `transform`, `opacity`, `filter`, `clip-path`. Nunca `width/height/top/left`.
- Interações de alta frequência (filtros, quantidade, marcar na Dex) **não animam**.
- **`prefers-reduced-motion` é obrigatório** em toda animação nova.

## Segredos e dados

- Nada de senhas, chaves ou e-mails pessoais no código. Use `.env.local` (não versionado) e GitHub Secrets.
- Deploy: secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` **da conta Cloudflare do Cubodex**. Para
  cadastrar, a pessoa roda `bash scripts/ligar-cloudflare.sh` no próprio terminal — chaves nunca passam pelo chat
  nem por arquivos versionados.
- API: `NOTION_TOKEN`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `MELHOR_ENVIO_TOKEN` são secrets (`bindings.secret()`),
  enviados no deploy via `cf deploy --secrets-file` a partir dos GitHub Secrets de mesmo nome. Para cadastrar, a
  pessoa roda `bash scripts/ligar-integracoes.sh` (cria os bancos no Notion e grava os IDs, que não são segredo, em
  `cloudflare.config.ts`). Nunca rode `cf deploy` local: o login `cf` desta máquina é de outra conta.
- O protótipo original está em `legacy/index.html` (commit de baseline), se precisar consultar.

## Idioma

Código (identificadores) em inglês; textos de interface, commits, issues, PRs e comentários em **português**.
