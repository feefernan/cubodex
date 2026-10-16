import { $ } from './dom';

let timer: ReturnType<typeof setTimeout> | undefined;

export const toast = (msg: string) => {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), 2200);
};
