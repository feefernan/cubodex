/**
 * Seções que podem ser desligadas sem apagar código. `colecionaveis` = miniaturas "fiozinho", pacote de miniaturas e
 * Dex: desligada, as telas, os links e o carrinho dessa parte somem do site e os endereços antigos levam ao TCG.
 * Para religar: troque para `true`, restaure os textos guardados em AGENTS.md ("Religar colecionáveis") e faça o deploy.
 * É um objeto (não só um booleano) para os testes poderem ligar e desligar.
 */
export const FEATURES = { colecionaveis: false };
