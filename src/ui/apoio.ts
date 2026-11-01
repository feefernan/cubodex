/** Textos da ajuda: sobre, como comprar, frete, trocas, termos, privacidade, contato e perguntas. */
import { LEGAL_UPDATED, STORE, WITHDRAWAL_DAYS } from '../domain/legal';

const mail = `<a href="mailto:${STORE.email}">${STORE.email}</a>`;
const who = `${STORE.tradeName} (${STORE.legalName}, CNPJ ${STORE.cnpj})`;
const updated = `<p class="muted" style="font-size:14px">Atualizado em ${LEGAL_UPDATED}.</p>`;

export const APOIO: Record<string, string> = {
  sobre:
    '<h2>sobre a cubodex</h2><p>A Cubodex junta duas coisas: cartas de pokémon originais e peças impressas em 3D. Colecionar e criar na mesma loja.</p>' +
    `<p>Quem vende: ${who}, microempreendedor individual, ${STORE.address}.</p>`,

  comprar:
    '<h2>como comprar</h2><p>Escolha os itens, calcule o frete pelo CEP no carrinho e pague pelo checkout do Mercado Pago (Pix, cartão ou boleto). Para peças sob medida, peça um orçamento em Criar antes.</p>' +
    '<p>No checkout pedimos seu CPF e telefone: eles saem na nota fiscal e na etiqueta de envio. Emitimos nota fiscal em todas as compras e mandamos para o e-mail do pedido.</p>' +
    '<p>O preço e o estoque são os do momento do pagamento. Se uma carta esgotar enquanto você paga, devolvemos o valor.</p>',

  frete:
    '<h2>frete e prazos</h2><p>O frete é calculado por CEP no carrinho, pelas transportadoras (em geral, os Correios), e é pago junto com a compra. O prazo que aparece é a estimativa da transportadora, em dias úteis, contado a partir da postagem.</p>' +
    '<p>Postamos depois da confirmação do pagamento (Pix confirma em segundos; boleto, em até 3 dias úteis). Peças impressas sob encomenda têm prazo combinado no orçamento.</p>' +
    '<p>Itens que você guarda no cofre não entram no frete da compra: o envio deles é cobrado à parte, quando você pedir.</p>',

  trocas: `<h2>trocas e devoluções</h2>
<h3>Desistir da compra (arrependimento)</h3>
<p>Em compra pela internet, você pode desistir em até <b style="color:var(--fg)">${WITHDRAWAL_DAYS} dias corridos</b> a partir do recebimento, sem dar motivo (Código de Defesa do Consumidor, art. 49). Devolvemos o valor pago, <b style="color:var(--fg)">inclusive o frete de ida</b>, pelo mesmo meio de pagamento.</p>
<p>Para desistir, escreva para ${mail} com o número do pedido. Enviamos as instruções de devolução. O item volta como foi recebido, sem uso, na embalagem.</p>
<h3>Produto com defeito ou diferente do anúncio</h3>
<p>Fale com a gente pelo mesmo e-mail. O prazo legal para reclamar de defeito é de 90 dias do recebimento, para produtos duráveis (CDC, art. 26). Corrigimos, trocamos ou devolvemos o valor.</p>
<p>Cartas de coleção são descritas no anúncio com variante, idioma e, quando houver, gradação. A condição que mostramos é a que você recebe.</p>
<h3>Peças feitas sob medida</h3>
<p>Peça impressa sob medida, feita para o seu pedido e a partir do seu orçamento, não entra no arrependimento de ${WITHDRAWAL_DAYS} dias, porque não pode ser revendida. Se chegar com defeito ou diferente do combinado, a garantia legal vale do mesmo jeito.</p>
<h3>Cofre virtual</h3>
<p>As cartas guardadas no cofre continuam sendo suas. Quer desistir de uma carta que ainda está no cofre? Escreva para ${mail} dentro do prazo. Se o pagamento de uma compra for estornado, o item também sai do cofre.</p>
${updated}`,

  contato: `<h2>contato</h2><p>E-mail: ${mail}. Instagram e TikTok: <b style="color:var(--fg)">${STORE.instagram}</b>. Peças sob medida: peça o orçamento em <a href="#/criar" data-action="go" data-view="criar">criar</a>.</p><p>${who}<br>${STORE.address}</p>`,

  termos: `<h2>termos de uso</h2>
<p>Estes termos valem para quem usa o site da Cubodex e compra dela. Quem vende é ${who}.</p>
<h3>Conta</h3>
<p>Você entra com a sua conta Google. A conta da Cubodex é criada com o seu nome e e-mail e guarda seu cofre e seus pedidos. Você é responsável pelo que acontece na sua conta e pode apagá-la quando quiser.</p>
<h3>Compras</h3>
<p>Os preços estão em reais. O pagamento acontece no Mercado Pago. O pedido só vale depois da confirmação do pagamento, e o estoque é reservado nesse momento. Se um item não estiver mais disponível, devolvemos o valor. Descrições, fotos e valores podem ser corrigidos quando houver erro evidente, e avisamos antes de qualquer cobrança.</p>
<h3>Cofre virtual</h3>
<p>O cofre guarda as cartas que você comprou na Cubodex e escolheu guardar. Elas são suas, ficam separadas para você e saem do cofre quando você pede o envio, que é cobrado à parte (frete). O cofre guarda só itens comprados na Cubodex. A Cubodex não é depositária de cartas de terceiros.</p>
<h3>Pacotes</h3>
<h3>Marcas e imagens</h3>
<p>A Cubodex não é afiliada à The Pokémon Company. Pokémon e os nomes e imagens das cartas pertencem a seus titulares. As imagens das cartas vêm do TCGdex (tcgdex.net). O desenho e as peças da Cubodex são nossos; peça autorização antes de copiá-los.</p>
<h3>Uso do site</h3>
<p>Não use o site para fraudar pagamentos, automatizar compras em massa ou tentar acessar dados de outras pessoas.</p>
<h3>Lei e foro</h3>
<p>Valem as leis do Brasil. Para questões de consumo, o foro é o do seu domicílio. Dúvidas: ${mail}.</p>
${updated}`,

  privacidade: `<h2>política de privacidade</h2>
<p>Quem decide sobre os seus dados é ${who}. Falar sobre eles: ${mail}.</p>
<h3>O que guardamos e para quê</h3>
<ul>
<li><b style="color:var(--fg)">Nome e e-mail</b> (do Google, quando você entra): para criar e manter a sua conta e falar sobre o pedido.</li>
<li><b style="color:var(--fg)">CPF, telefone e endereço</b>: só em compra. Servem para a nota fiscal, a etiqueta de envio e a entrega.</li>
<li><b style="color:var(--fg)">Pedidos e cofre</b>: para entregar o que você comprou e guardar sua coleção.</li>
<li><b style="color:var(--fg)">E-mail na lista de avisos</b>: só se você pedir, para avisar de lançamentos. Todo e-mail traz o link para sair.</li>
</ul>
<h3>Com quem dividimos</h3>
<p>Só o necessário: Mercado Pago (pagamento; a Cubodex não vê nem guarda dados de cartão), Correios e Melhor Envio (frete e etiqueta), Cloudflare (hospedagem e banco de dados), Notion (registro dos pedidos) e Google (login). Para mostrar o site, o seu navegador também busca as imagens das cartas no TCGdex e as fontes no Google Fonts, que recebem o seu endereço IP. Não vendemos dados.</p>
<h3>Por quanto tempo</h3>
<p>Dados da conta ficam até você apagá-la. Pedidos pagos, com nota fiscal, ficam por 5 anos, por obrigação fiscal, mesmo que você apague a conta.</p>
<h3>Cookies</h3>
<p>Usamos só o cookie da sessão (para manter você logado) e o armazenamento do navegador para o carrinho e o modo claro ou escuro. Não usamos cookies de publicidade nem de análise.</p>
<h3>Seus direitos (LGPD)</h3>
<p>Você pode pedir acesso, correção e exclusão dos seus dados, e saber com quem os dividimos. Na sua conta, você baixa uma cópia dos seus dados e apaga a conta sozinho. Para o resto, escreva para ${mail}. Respondemos em até 15 dias.</p>
${updated}`,

  faq: `<h2>faq</h2><div class="faq"><details open><summary>O que é o cofre virtual?</summary><p>É onde ficam as cartas que você comprou na Cubodex e escolheu guardar. Você junta vários itens e pede um envio só.</p></details><details><summary>Como escolho entre enviar agora e guardar?</summary><p>No carrinho, cada carta tem as opções enviar agora ou guardar no cofre.</p></details><details><summary>Posso guardar cartas que já tenho?</summary><p>Na primeira versão não. O cofre guarda só itens comprados na Cubodex.</p></details><details><summary>Por quanto tempo posso guardar uma carta?</summary><p>O prazo máximo ainda não foi definido.</p></details><details><summary>Posso desistir da compra?</summary><p>Sim, em até ${WITHDRAWAL_DAYS} dias corridos do recebimento, com devolução do valor e do frete. Veja <a href="#/apoio/trocas" data-action="go" data-view="apoio" data-tab="trocas">trocas e devoluções</a>.</p></details><details><summary>Vocês emitem nota fiscal?</summary><p>Sim, em todas as compras, enviada para o e-mail do pedido.</p></details><details><summary>A Cubodex é afiliada à The Pokémon Company?</summary><p>Não.</p></details><details><summary>Posso pedir uma peça sob medida?</summary><p>Sim, em Criar. O orçamento vem pelo WhatsApp.</p></details></div>`,
};
