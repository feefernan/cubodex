#!/usr/bin/env bash
# Cadastra no GitHub os secrets de deploy da conta Cloudflare DO CUBODEX (não a do Hortelã).
# Rode no seu terminal: bash scripts/ligar-cloudflare.sh — os valores não aparecem na tela nem ficam em arquivo.
#
# Antes, no painel da conta Cloudflare do Cubodex:
#   1. Workers & Pages → anote o Account ID (lado direito).
#   2. Workers & Pages → registre um subdomínio workers.dev (só na primeira vez da conta).
#   3. My Profile → API Tokens → Create Token → modelo "Edit Cloudflare Workers" → escolha a conta do Cubodex.
set -euo pipefail
# gh pode estar fora do PATH do terminal (ex.: instalado em ~/.local/bin).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
repo="feefernan/cubodex"
# Confere o GitHub ANTES de pedir as chaves: se falhar depois, o que foi colado cai no terminal.
command -v gh >/dev/null || { echo "Falta o gh (GitHub CLI): brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Entre no GitHub primeiro: gh auth login"; exit 1; }
gh repo view "$repo" >/dev/null 2>&1 || { echo "Sem acesso ao repositório $repo no GitHub."; exit 1; }

echo "1) Account ID: o código de 32 caracteres que aparece em dash.cloudflare.com/<ACCOUNT_ID>/..."
echo "   (NÃO é o token; o token começa com cfut_ e vem na próxima pergunta)"
# Lido sem eco: se um token for colado aqui por engano, ele não aparece na tela.
read -rsp "Account ID: " account_id; echo
account_id=$(printf '%s' "$account_id" | tr -d '[:space:]')
if [[ "$account_id" == cfut_* || "$account_id" == *_* ]]; then
  echo "Isso é um API Token, não o Account ID. Como ele foi colado no lugar errado, apague-o em"
  echo "dash.cloudflare.com/profile/api-tokens e crie outro. O Account ID está na barra de endereço do painel."
  exit 1
fi
[[ "$account_id" =~ ^[0-9a-f]{32}$ ]] || { echo "Account ID tem 32 caracteres (0-9 e a-f). Confira e rode de novo."; exit 1; }
echo "   Account ID ok: ${account_id:0:6}…"
echo "2) API Token (começa com cfut_; não aparece enquanto você cola)"
if [ "$account_id" = "ed6e9771671dec30d3042eee81ea5f06" ]; then
  echo "Esse é o Account ID do Hortelã. Use a conta nova do Cubodex."; exit 1
fi
read -rsp "API Token: " token; echo
token=$(printf '%s' "$token" | tr -d '[:space:]')
[ -n "$token" ] || { echo "Token vazio."; exit 1; }

printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID -R "$repo"
printf '%s' "$token" | gh secret set CLOUDFLARE_API_TOKEN -R "$repo"
echo "Pronto. O próximo merge na main publica o site (ou rode: gh workflow run deploy.yml -R $repo)."
