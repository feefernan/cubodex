#!/usr/bin/env bash
# Cadastra no GitHub os secrets de deploy da conta Cloudflare DO CUBODEX (não a do Hortelã).
# Rode no seu terminal: bash scripts/ligar-cloudflare.sh — os valores não aparecem na tela nem ficam em arquivo.
#
# Antes, no painel da conta Cloudflare do Cubodex:
#   1. Workers & Pages → anote o Account ID (lado direito).
#   2. Workers & Pages → registre um subdomínio workers.dev (só na primeira vez da conta).
#   3. My Profile → API Tokens → Create Token → modelo "Edit Cloudflare Workers" → escolha a conta do Cubodex.
set -euo pipefail
repo="feefernan/cubodex"

read -rp "Account ID da conta Cloudflare do Cubodex: " account_id
[[ "$account_id" =~ ^[0-9a-f]{32}$ ]] || { echo "Account ID tem 32 caracteres hexadecimais."; exit 1; }
if [ "$account_id" = "ed6e9771671dec30d3042eee81ea5f06" ]; then
  echo "Esse é o Account ID do Hortelã. Use a conta nova do Cubodex."; exit 1
fi
read -rsp "API Token (Edit Cloudflare Workers): " token; echo
[ -n "$token" ] || { echo "Token vazio."; exit 1; }

printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID -R "$repo"
printf '%s' "$token" | gh secret set CLOUDFLARE_API_TOKEN -R "$repo"
echo "Pronto. O próximo merge na main publica o site (ou rode: gh workflow run deploy.yml -R $repo)."
