export const BRAND = {
  logo: 'css/gtbl-logo-2.jpg',
  headerLogo: 'css/gtbl-logo.png',
  companyName: 'GUJARAT THEMIS BIOSYN LTD,',
};

export function resolveBrandAsset(path) {
  return new URL(path, window.location.href).href;
}
