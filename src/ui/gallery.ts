/** Pontos da faixa de fotos: acende o da foto que está à vista enquanto a pessoa desliza. */
export const initGallery = () => {
  // O evento `scroll` não borbulha: escuta na captura, uma vez só, para valer também para os cards desenhados depois.
  document.addEventListener(
    'scroll',
    (e) => {
      const track = e.target;
      if (!(track instanceof HTMLElement) || !track.classList.contains('gallery-track')) return;
      const at = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const dots = track.parentElement?.querySelectorAll('.gallery-dots i') ?? [];
      for (const [i, d] of [...dots].entries()) d.classList.toggle('on', i === at);
    },
    true,
  );
};
