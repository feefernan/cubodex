/** E-mail do link de login pelo Cloudflare Email Service (binding send_email). */
export interface Mailer {
  send(message: { to: string; from: string; subject: string; text: string; html: string }): Promise<unknown>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const sendLoginEmail = (mailer: Mailer, from: string, to: string, link: string) =>
  mailer.send({
    to,
    from,
    subject: 'Seu link para entrar na Cubodex',
    text: `Olá!\n\nPara entrar na sua conta da Cubodex, abra o link abaixo (vale por 15 minutos e só uma vez):\n\n${link}\n\nSe não foi você, pode ignorar este e-mail.\n\nCubodex`,
    html: `<p>Olá!</p><p>Para entrar na sua conta da Cubodex, use o botão abaixo. Ele vale por 15 minutos e só uma vez.</p><p><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#D21F3C;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">entrar na cubodex</a></p><p style="color:#5B6576;font-size:13px">Se não foi você, pode ignorar este e-mail.</p>`,
  });
