import { BRAND, resolveBrandAsset } from './brand.js';

const brandLinks = document.querySelectorAll('[data-brand-home]');

brandLinks.forEach((link) => {
  link.classList.add('brand-logo');
  link.setAttribute('aria-label', 'GTBL Home');
  link.innerHTML = `<img src="${resolveBrandAsset(BRAND.headerLogo)}" alt="GTBL">`;
});
