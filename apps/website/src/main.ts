import { applyLocale, resolveLocale, setLocale, type Locale } from './i18n';

applyLocale(resolveLocale());

const year = document.getElementById('year');
if (year) {
  year.textContent = String(new Date().getFullYear());
}

document.querySelector('.lang-switch')?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>('button[data-locale]');
  const next = button?.dataset.locale;
  if (next !== 'zh' && next !== 'en') return;
  setLocale(next as Locale);
});
