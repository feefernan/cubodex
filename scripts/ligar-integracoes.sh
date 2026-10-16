#!/usr/bin/env bash
# Liga a loja de verdade: catálogo, pedidos e lista de avisos no Notion DO CUBODEX, frete no Melhor Envio DO CUBODEX
# e pagamento na aplicação do Mercado Pago criada para o Cubodex. Rode no seu terminal, na raiz do repositório:
#   bash scripts/ligar-integracoes.sh
# As chaves são digitadas aqui (não aparecem na tela nem ficam em arquivo) e vão direto para os GitHub Secrets.
# Nada é publicado daqui: o deploy acontece pelo CI, na conta Cloudflare do Cubodex, no próximo merge na main.
#
# Antes:
#   Notion  — no workspace do Cubodex: Configurações → Conexões → Criar integração interna; copie o token (ntn_…).
#             Crie uma página "Loja Cubodex" e, nos "…" dela, Conexões → adicione a integração.
#   Mercado Pago — na conta (a mesma do Hortelã), Suas integrações → Criar aplicação "Cubodex" (Checkout Pro).
#             Credenciais de produção (ou de teste, TEST-…) → Access Token. Webhooks → URL
#             https://<endereço do site>/api/mp/webhook, evento "Pagamentos" → copie a assinatura secreta.
#   Melhor Envio — conta do Cubodex: Integrações → Permissões de acesso → gerar token (cálculo de fretes).
# Qualquer chave pode ficar em branco agora e ser cadastrada depois rodando o script de novo.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=feefernan/cubodex
CONFIG=cloudflare.config.ts
NOTION="https://api.notion.com/v1"

ask() { # pergunta sem eco; vazio = pular
  local value
  read -r -s -p "$1 (Enter para pular): " value
  echo >&2
  printf '%s' "$value"
}

notion() { # método caminho corpo
  curl -sf -X "$1" "$NOTION$2" -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" -d "$3"
}

set_secret() {
  [ -n "${!1}" ] || return 0
  printf '%s' "${!1}" | gh secret set "$1" --repo "$REPO" && echo "    $1 ok"
}

set_text() { # nome valor — troca bindings.text('…') da variável no cloudflare.config.ts
  node -e '
    const fs = require("fs"); const [file, name, value] = process.argv.slice(1);
    const src = fs.readFileSync(file, "utf8");
    const re = new RegExp(`(${name}: bindings\\.text\\()\x27[^\x27]*\x27`);
    if (!re.test(src)) { console.error(`${name} não encontrado em ${file}`); process.exit(1); }
    fs.writeFileSync(file, src.replace(re, `$1\x27${value}\x27`));
  ' "$CONFIG" "$1" "$2"
}

NOTION_TOKEN=$(ask "Token do Notion do Cubodex (ntn_…)")
if [ -n "$NOTION_TOKEN" ]; then
  read -r -p "Link ou ID da página \"Loja Cubodex\" no Notion (Enter se os bancos já existem): " PAGE
  PAGE_ID=$(printf '%s' "$PAGE" | grep -oE '[0-9a-f]{32}' | tail -1 || true)
  if [ -n "$PAGE_ID" ]; then
    echo "1/4 Criando os bancos no Notion…"
    db() { # título schema → id
      notion POST /databases "{\"parent\":{\"page_id\":\"$PAGE_ID\"},\"title\":[{\"text\":{\"content\":\"$1\"}}],\"properties\":$2}" |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id.replace(/-/g,"")))'
    }
    PRODUCTS=$(db "Produtos" '{"Nome":{"title":{}},"ID":{"rich_text":{}},"Preço":{"number":{"format":"real"}},"Disponíveis":{"number":{}},"Ativo no site":{"checkbox":{}},"Pré-venda":{"checkbox":{}}}')
    ORDERS=$(db "Pedidos" '{"Serial":{"title":{}},"Status":{"select":{"options":[{"name":"Novo"},{"name":"Aguardando pagamento"},{"name":"Pago"},{"name":"Cancelado"},{"name":"Enviado"}]}},"Cliente":{"rich_text":{}},"E-mail":{"email":{}},"Itens":{"rich_text":{}},"Frete":{"rich_text":{}},"Endereço":{"rich_text":{}},"Total":{"number":{"format":"real"}},"Pagamento MP":{"rich_text":{}},"Data":{"date":{}}}')
    SUBSCRIBERS=$(db "Avisos" '{"E-mail":{"title":{}},"Inscrito em":{"date":{}},"Consentimento":{"rich_text":{}},"Token":{"rich_text":{}},"Saiu":{"checkbox":{}}}')
    set_text NOTION_PRODUCTS_DB "$PRODUCTS"
    set_text NOTION_ORDERS_DB "$ORDERS"
    set_text NOTION_SUBSCRIBERS_DB "$SUBSCRIBERS"
    echo "    bancos criados e IDs gravados em $CONFIG"

    echo "2/4 Produtos do catálogo atual no banco Produtos…"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    npx rolldown src/domain/catalog.ts --format esm --file "$tmp/catalog.mjs" >/dev/null
    node --input-type=module -e "
      const { productById } = await import('$tmp/catalog.mjs');
      for (const p of Object.values(productById))
        console.log(JSON.stringify({ id: p.id, name: p.name, price: p.price, qty: p.kind === 'item' ? p.qty : null,
          active: p.kind !== 'item' || p.status !== 'esgotado', presale: p.kind === 'item' && p.status === 'prevenda' }));
    " | while IFS= read -r row; do
      body=$(node -e '
        const p = JSON.parse(process.argv[1]); const db = process.argv[2];
        const props = { Nome: { title: [{ text: { content: p.name } }] }, ID: { rich_text: [{ text: { content: p.id } }] },
          Preço: { number: p.price }, "Ativo no site": { checkbox: p.active }, "Pré-venda": { checkbox: p.presale } };
        if (p.qty !== null) props.Disponíveis = { number: p.qty };
        console.log(JSON.stringify({ parent: { database_id: db }, properties: props }));
      ' "$row" "$PRODUCTS")
      notion POST /pages "$body" >/dev/null
      sleep 0.35 # limite do Notion: ~3 pedidos por segundo
    done
    echo "    ok — edite preço e estoque direto no Notion"
  fi
fi

MP_ACCESS_TOKEN=$(ask "Access Token da aplicação Cubodex no Mercado Pago (APP_USR-… ou TEST-…)")
MP_WEBHOOK_SECRET=$(ask "Assinatura secreta do webhook dessa aplicação")
MELHOR_ENVIO_TOKEN=$(ask "Token do Melhor Envio do Cubodex")
read -r -p "CEP de onde as peças saem (só números, Enter para pular): " ORIGIN
ORIGIN=$(printf '%s' "$ORIGIN" | tr -cd '0-9')
if [ ${#ORIGIN} -eq 8 ]; then set_text ORIGIN_CEP "$ORIGIN" && echo "    CEP de saída gravado em $CONFIG"; fi

echo "3/4 Secrets do GitHub…"
for name in NOTION_TOKEN MP_ACCESS_TOKEN MP_WEBHOOK_SECRET MELHOR_ENVIO_TOKEN; do set_secret "$name"; done

echo "4/4 Próximo passo"
if git diff --quiet -- "$CONFIG"; then
  echo "    Nada mudou em $CONFIG. O próximo deploy já usa os secrets novos."
else
  echo "    $CONFIG mudou (IDs dos bancos/CEP — não são segredos). Abra um PR com essa mudança, ou peça ao agente;"
  echo "    o merge na main publica a loja com tudo ligado."
fi
