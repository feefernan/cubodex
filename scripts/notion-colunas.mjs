// Prepara o banco Produtos do Notion para o catálogo vir só de lá (Fase 2.3): cria as colunas que faltam e preenche
// as linhas atuais (miniaturas, peças, acessórios) com o que hoje está no código. Só escreve em célula vazia e só
// cria coluna que não existe: pode rodar de novo sem estragar nada. Sem --aplicar, só mostra o que faria.
//
//   NOTION_TOKEN=... NOTION_PRODUCTS_DB=... node scripts/notion-colunas.mjs [--aplicar]
//
// shortcut: as definições abaixo repetem o catálogo do código só para esta carga inicial; depois dela, o Notion manda
// e este arquivo pode ser apagado.

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_PRODUCTS_DB;
const APPLY = process.argv.includes('--aplicar');
if (!TOKEN || !DB) {
  console.error('Faltam NOTION_TOKEN e NOTION_PRODUCTS_DB.');
  process.exit(1);
}

const COLUMNS = {
  // "Categoria" diz o que o produto é (antes se chamava "Tipo"; a coluna "Tipo" agora é o tipo do selado/acessório).
  Categoria: {
    select: { options: ['carta', 'miniatura', 'peça', 'acessório', 'pacote', 'selado'].map((name) => ({ name })) },
  },
  Cor: { rich_text: {} },
  Raridade: { select: { options: ['comum', 'rara', 'especial'].map((name) => ({ name })) } },
  Número: { number: { format: 'number' } },
  Série: { select: { options: [{ name: 'fiozinho' }] } },
  Material: { rich_text: {} },
  Medidas: { rich_text: {} },
  Impressão: { rich_text: {} },
  Nota: { rich_text: {} },
  'Desconto do pacote': { number: { format: 'number' } },
  // Cartas à venda (Fase 3.3): a carta é o id do TCGdex; nome, set, número, raridade e imagem vêm de lá.
  'Carta TCGdex': { rich_text: {} },
  Idioma: { select: { options: ['EN', 'PT'].map((name) => ({ name })) } },
  Variante: { select: { options: ['normal', 'holo', 'reverse holo', '1ª edição'].map((name) => ({ name })) } },
  Gradação: { rich_text: {} },
};

const MINIS = [
  ['base', '#F42744', 'comum'],
  ['ciano', '#3ED9F0', 'comum'],
  ['preto fosco', '#3A434F', 'comum'],
  ['branco', '#EDEFF2', 'comum'],
  ['cinza', '#7A8595', 'comum'],
  ['vermelho sombra', '#C0223B', 'rara'],
  ['dourado', '#D9A441', 'rara'],
  ['prata', '#B8C0CC', 'rara'],
  ['translúcido', '#8FE3F2', 'rara'],
  ['brilha no escuro', '#A6F2A0', 'especial'],
  ['madeira', '#B8875A', 'especial'],
  ['mármore', '#C9CDD6', 'especial'],
].map(([, cor, raridade], i) => ({
  id: `m${i + 1}`,
  tipo: 'miniatura',
  cor,
  raridade,
  numero: i + 1,
  serie: 'fiozinho',
}));
const ACESSORIOS = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ id, tipo: 'acessório', nota: 'impresso em 3D' }));
const PECAS = [
  ['k1', 'PLA', '90 × 60 × 28 mm', '~4 h', '6 vãos'],
  ['k2', 'PETG', '80 × 80 × 160 mm', '~11 h', 'queda interna em rampa'],
  ['k3', 'PLA', '200 × 200 × 30 mm', '~9 h', 'tampa encaixa'],
  ['k4', 'PLA', '140 × 120 × 45 mm', '~5 h', 'rpg'],
  ['k5', 'PLA', '150 × 100 × 25 mm', '~6 h', '12 vãos'],
  ['k6', 'PLA', '120 × 120 × 60 mm', '~8 h', 'empilhável'],
].map(([id, material, medidas, impressao, nota]) => ({ id, tipo: 'peça', material, medidas, impressao, nota }));

const CARTAS = [
  ['i1', 'base1-4', 'EN', '1ª edição', 'PSA 8'],
  ['i2', 'base1-2', 'EN', 'normal', ''],
  ['i3', 'base1-10', 'EN', 'normal', ''],
  ['i4', 'base1-58', 'EN', 'normal', ''],
  ['i5', 'base1-15', 'EN', 'normal', 'CGC 8'],
  ['i6', 'base3-5', 'EN', 'normal', ''],
  ['i7', 'base2-11', 'EN', 'normal', ''],
  ['i8', 'sv03.5-006', 'PT', 'normal', ''],
  ['i9', 'sv03.5-151', 'PT', 'holo', ''],
  ['i10', 'sv03.5-025', 'PT', 'reverse holo', ''],
  ['i11', 'sv03.5-094', 'EN', 'holo', ''],
  ['i12', 'sv03.5-006', 'EN', 'holo', ''],
].map(([id, tcgdex, idioma, variante, gradacao]) => ({ id, tipo: 'carta', tcgdex, idioma, variante, gradacao }));

const rich = (v) => ({ rich_text: [{ text: { content: v } }] });
const sel = (v) => ({ select: { name: v } });
const toProps = (d) => ({
  Categoria: sel(d.tipo),
  ...(d.cor && { Cor: rich(d.cor) }),
  ...(d.raridade && { Raridade: sel(d.raridade) }),
  ...(d.numero && { Número: { number: d.numero } }),
  ...(d.serie && { Série: sel(d.serie) }),
  ...(d.material && { Material: rich(d.material) }),
  ...(d.medidas && { Medidas: rich(d.medidas) }),
  ...(d.impressao && { Impressão: rich(d.impressao) }),
  ...(d.nota && { Nota: rich(d.nota) }),
  ...(d.tcgdex && { 'Carta TCGdex': rich(d.tcgdex) }),
  ...(d.idioma && { Idioma: sel(d.idioma) }),
  ...(d.variante && { Variante: sel(d.variante) }),
  ...(d.gradacao && { Gradação: rich(d.gradacao) }),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, method = 'GET', body) => {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Só status e código: o corpo pode ter dados do cliente em outros bancos.
  if (!res.ok) throw new Error(`Notion ${method} ${path.split('/')[1]}: ${res.status} ${data.code ?? ''}`);
  return data;
};
const plain = (p) =>
  (p?.rich_text ?? p?.title ?? [])
    .map((t) => t.plain_text)
    .join('')
    .trim();

const db = await api(`/databases/${DB}`);
const missing = Object.keys(COLUMNS).filter((k) => !(k in db.properties));
console.log(`Colunas que faltam: ${missing.length ? missing.join(', ') : 'nenhuma'}`);
if (missing.length && APPLY) {
  await api(`/databases/${DB}`, 'PATCH', { properties: Object.fromEntries(missing.map((k) => [k, COLUMNS[k]])) });
  console.log('Colunas criadas.');
}

const pages = [];
for (let cursor; ; ) {
  const r = await api(`/databases/${DB}/query`, 'POST', { page_size: 100, ...(cursor && { start_cursor: cursor }) });
  pages.push(...r.results);
  if (!r.has_more) break;
  cursor = r.next_cursor;
}
const byId = new Map(pages.map((p) => [plain(p.properties.ID), p]));

let filled = 0;
let skipped = 0;
for (const d of [...MINIS, ...ACESSORIOS, ...PECAS, ...CARTAS]) {
  const page = byId.get(d.id);
  if (!page) {
    console.log(`- ${d.id}: não está no Notion, ignorado`);
    continue;
  }
  if (page.properties.Categoria?.select || page.properties.Tipo?.select) {
    skipped++;
    continue;
  }
  console.log(`- ${d.id}: ${APPLY ? 'preenchendo' : 'preencheria'} (${d.tipo})`);
  if (APPLY) {
    await api(`/pages/${page.id}`, 'PATCH', { properties: toProps(d) });
    await sleep(400);
  }
  filled++;
}
console.log(`Linhas ${APPLY ? 'preenchidas' : 'a preencher'}: ${filled}; já preenchidas: ${skipped}`);

if (!byId.has('pack')) {
  console.log(`- pack: ${APPLY ? 'criando' : 'criaria'} a linha do pacote (desconto de 10%)`);
  if (APPLY)
    await api('/pages', 'POST', {
      parent: { database_id: DB },
      properties: {
        Nome: { title: [{ text: { content: 'pacote fiozinho' } }] },
        ID: rich('pack'),
        Categoria: sel('pacote'),
        'Desconto do pacote': { number: 10 },
        'Ativo no site': { checkbox: true },
      },
    });
} else console.log('- pack: a linha do pacote já existe');
if (!APPLY) console.log('\nSimulação: nada foi alterado. Rode com --aplicar para gravar.');
