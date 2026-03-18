import { BRAND, resolveBrandAsset } from './brand.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LABEL_WIDTH = 1040;
const LABEL_HEIGHT = 660;
const LABEL_ASPECT_RATIO = LABEL_WIDTH / LABEL_HEIGHT;
const QR_SIZE = 120;
const QR_BOX_X = 62;
const QR_BOX_Y = 460;
const PX_PER_INCH = 96;
const PX_PER_CM = 37.795;
const PDF_POINTS_PER_INCH = 72;
const DEFAULT_EXPORT_DPI = 300;
let brandLogoDataUrlPromise;

export const LABEL_DIMENSIONS = {
  width: LABEL_WIDTH,
  height: LABEL_HEIGHT,
  aspectRatio: LABEL_ASPECT_RATIO,
};

export function defaultLabelPayload() {
  return {
    productName: 'RIFAXIMIN (EP)',
    formNumber: 'Form No. FQA02009-00',
    labelNumber: '0020',
    productCode: 'RFX',
    batchNumber: 'RFX26001',
    manufacturingMonth: 'JANUARY 2026',
    retestMonth: 'DECEMBER 2028',
    containerNumber: '09/09',
    grossWeight: '05.065',
    tareWeight: '04.215',
    netWeight: '0.850',
    storageInstruction: 'STORE IN AIR TIGHT CONTAINER PROTECTED FROM LIGHT',
    drugLicenseNumber: 'G/28/1981',
    manufacturerName: 'GUJARAT THEMIS BIOSYN LTD,',
    manufacturerAddress: 'WORKS: 69/C, GIDC, INDUSTRIAL ESTATE, VAPI - 396195, DIST. VALSAD, GUJARAT (INDIA).',
    qrCaption: 'QRCODE',
    fileUrl: '',
    exportWidth: 4,
    exportHeight: 2.54,
    exportUnit: 'in',
    exportDpi: DEFAULT_EXPORT_DPI,
  };
}

export async function buildLabelSvg(payload, options = {}) {
  const merged = {
    ...defaultLabelPayload(),
    ...payload,
  };
  const qrDataUrl = await createQrDataUrl(merged.fileUrl || 'https://example.com/file', QR_SIZE);
  const companyLogoUrl = await getEmbeddedBrandLogo();
  const displayWidth = Math.round(options.displayWidthPx || LABEL_WIDTH);
  const displayHeight = Math.round(options.displayHeightPx || LABEL_HEIGHT);

  return [
    `<svg xmlns="${SVG_NS}" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${LABEL_WIDTH} ${LABEL_HEIGHT}" role="img" aria-label="${escapeXml(merged.productName)} label">`,
    `<rect width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" fill="#ffffff"/>`,
    `<rect x="24" y="22" width="992" height="604" rx="60" ry="60" fill="#ffffff" stroke="#2f2f2f" stroke-width="4"/>`,
    `<line x1="84" y1="145" x2="956" y2="145" stroke="#353535" stroke-width="3"/>`,
    metadataBlock(merged),
    weightsTable(merged),
    storageBox(merged),
    qrSection(merged, qrDataUrl),
    footerSection(merged, companyLogoUrl),
    `</svg>`,
  ].join('');
}

export function normalizeDimensionPair(width, height) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);

  if (!Number.isFinite(safeWidth) || safeWidth <= 0) {
    return { width: 4, height: roundDimension(4 / LABEL_ASPECT_RATIO) };
  }

  if (!Number.isFinite(safeHeight) || safeHeight <= 0) {
    return { width: safeWidth, height: roundDimension(safeWidth / LABEL_ASPECT_RATIO) };
  }

  return {
    width: roundDimension(safeWidth),
    height: roundDimension(safeHeight),
  };
}

export function calculateExportMetrics(width, height, unit, dpi = DEFAULT_EXPORT_DPI) {
  const normalized = normalizeDimensionPair(width, height);
  const safeUnit = ['in', 'cm', 'px'].includes(unit) ? unit : 'in';
  const cssPixelWidth = convertToCssPixels(normalized.width, safeUnit);
  const cssPixelHeight = convertToCssPixels(normalized.height, safeUnit);

  let rasterWidth;
  let rasterHeight;
  let widthInches;
  let heightInches;

  if (safeUnit === 'px') {
    rasterWidth = Math.max(1, Math.round(cssPixelWidth));
    rasterHeight = Math.max(1, Math.round(cssPixelHeight));
    widthInches = cssPixelWidth / PX_PER_INCH;
    heightInches = cssPixelHeight / PX_PER_INCH;
  } else if (safeUnit === 'cm') {
    widthInches = normalized.width / 2.54;
    heightInches = normalized.height / 2.54;
    rasterWidth = Math.max(1, Math.round(widthInches * dpi));
    rasterHeight = Math.max(1, Math.round(heightInches * dpi));
  } else {
    widthInches = normalized.width;
    heightInches = normalized.height;
    rasterWidth = Math.max(1, Math.round(widthInches * dpi));
    rasterHeight = Math.max(1, Math.round(heightInches * dpi));
  }

  return {
    width: normalized.width,
    height: normalized.height,
    unit: safeUnit,
    cssPixelWidth,
    cssPixelHeight,
    rasterWidth,
    rasterHeight,
    widthInches,
    heightInches,
    dpi,
  };
}

export async function svgToPngBlob(svgString, options = {}) {
  const width = Math.max(1, Math.round(options.width || LABEL_WIDTH));
  const height = Math.max(1, Math.round(options.height || LABEL_HEIGHT));
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function createPdfBlobFromPng(pngBlob, metrics) {
  const jsPdfApi = window.jspdf?.jsPDF;
  if (!jsPdfApi) return null;

  const dataUrl = await blobToDataUrl(pngBlob);
  const widthPt = metrics.widthInches * PDF_POINTS_PER_INCH;
  const heightPt = metrics.heightInches * PDF_POINTS_PER_INCH;
  const pdf = new jsPdfApi({
    orientation: widthPt > heightPt ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [widthPt, heightPt],
    compress: true,
  });

  pdf.addImage(dataUrl, 'PNG', 0, 0, widthPt, heightPt, undefined, 'FAST');
  return pdf.output('blob');
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function metadataBlock(data) {
  return [
    text(520, 82, data.productName, { size: 44, weight: 700, anchor: 'middle', family: 'Arial, sans-serif', spacing: 1 }),
    text(786, 88, data.formNumber, { size: 14, weight: 400, family: 'Arial, sans-serif' }),
    text(80, 185, 'PRODUCT CODE  :', { size: 18, weight: 700 }),
    text(238, 185, data.productCode, { size: 18, weight: 700 }),
    text(602, 185, 'BATCH NO      :', { size: 18, weight: 700 }),
    text(768, 185, data.batchNumber, { size: 18, weight: 700 }),
    text(80, 215, 'MFG MONTH     :', { size: 18, weight: 700 }),
    text(238, 215, data.manufacturingMonth, { size: 18, weight: 700 }),
    text(602, 215, 'RETESTMONTH: ', { size: 18, weight: 700 }),
    text(783, 215, data.retestMonth, { size: 18, weight: 700 }),
  ].join('');
}

function weightsTable(data) {
  return [
    `<rect x="78" y="245" width="882" height="116" fill="#ffffff" stroke="#585858" stroke-width="2"/>`,
    `<line x1="78" y1="276" x2="960" y2="276" stroke="#585858" stroke-width="2"/>`,
    `<line x1="294" y1="245" x2="294" y2="361" stroke="#585858" stroke-width="2"/>`,
    `<line x1="530" y1="245" x2="530" y2="361" stroke="#585858" stroke-width="2"/>`,
    `<line x1="768" y1="245" x2="768" y2="361" stroke="#585858" stroke-width="2"/>`,
    text(186, 266, 'CONTAINER NO', { size: 15, weight: 400, anchor: 'middle' }),
    text(412, 266, 'GROSS WT (KG)', { size: 15, weight: 400, anchor: 'middle' }),
    text(649, 266, 'TARE WT (KG)', { size: 15, weight: 400, anchor: 'middle' }),
    text(864, 266, 'NET WT (KG)', { size: 15, weight: 400, anchor: 'middle' }),
    text(186, 333, data.containerNumber, { size: 20, weight: 400, anchor: 'middle' }),
    text(412, 333, data.grossWeight, { size: 20, weight: 400, anchor: 'middle' }),
    text(649, 333, data.tareWeight, { size: 20, weight: 400, anchor: 'middle' }),
    text(864, 333, data.netWeight, { size: 20, weight: 400, anchor: 'middle' }),
  ].join('');
}

function storageBox(data) {
  return [
    `<rect x="64" y="388" width="900" height="58" fill="#ffffff" stroke="#585858" stroke-width="2"/>`,
    text(514, 425, data.storageInstruction, { size: 17, weight: 400, anchor: 'middle' }),
  ].join('');
}

function qrSection(data, qrDataUrl) {
  return [
    `<rect x="${QR_BOX_X}" y="${QR_BOX_Y}" width="${QR_SIZE}" height="${QR_SIZE}" fill="#ffffff" stroke="#121212" stroke-width="6"/>`,
    `<image href="${qrDataUrl}" x="${QR_BOX_X + 6}" y="${QR_BOX_Y + 6}" width="${QR_SIZE - 12}" height="${QR_SIZE - 12}" preserveAspectRatio="xMidYMid meet"/>`,
    text(QR_BOX_X + QR_SIZE / 2, QR_BOX_Y + QR_SIZE - 34, data.qrCaption, { size: 14, weight: 400, anchor: 'middle' }),
    text(390, 514, 'Drug License Number:', { size: 16, weight: 400, anchor: 'middle' }),
    text(560, 514, data.drugLicenseNumber, { size: 16, weight: 400 }),
    text(522, 545, 'MANUFACTURED BY:', { size: 18, weight: 700, anchor: 'middle' }),
    `<rect x="810" y="448" width="153" height="54" fill="#ffffff" stroke="#585858" stroke-width="2"/>`,
    text(826, 472, 'LABEL', { size: 12, weight: 400 }),
    text(826, 489, `NUMBER ${data.labelNumber}`, { size: 12, weight: 400 }),
  ].join('');
}

function footerSection(data, logoUrl) {
  return [
    `<image href="${logoUrl}" x="170" y="552" width="84" height="46" preserveAspectRatio="xMidYMid meet"/>`,
    text(270, 592, data.manufacturerName || BRAND.companyName, { size: 27, weight: 700 }),
    text(520, 615, data.manufacturerAddress, { size: 14, weight: 400, anchor: 'middle' }),
  ].join('');
}

async function getEmbeddedBrandLogo() {
  if (!brandLogoDataUrlPromise) {
    brandLogoDataUrlPromise = assetToDataUrl(resolveBrandAsset(BRAND.logo));
  }
  return brandLogoDataUrlPromise;
}

async function assetToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load brand asset: ${url}`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function text(x, y, value, options = {}) {
  const safe = escapeXml(value);
  const size = options.size || 16;
  const weight = options.weight || 400;
  const anchor = options.anchor || 'start';
  const family = options.family || 'Arial, sans-serif';
  const spacing = options.spacing || 0;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}" fill="#232323">${safe}</text>`;
}

function convertToCssPixels(value, unit) {
  if (unit === 'cm') return value * PX_PER_CM;
  if (unit === 'in') return value * PX_PER_INCH;
  return value;
}

function roundDimension(value) {
  return Math.round(value * 100) / 100;
}

function createQrDataUrl(content, width) {
  return new Promise((resolve, reject) => {
    QRCode.toString(
      content,
      {
        type: 'svg',
        width,
        margin: 0,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      },
      (error, svg) => {
        if (error || !svg) {
          reject(error || new Error('QR generation failed.'));
          return;
        }
        resolve(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      }
    );
  });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed.'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export failed.'));
    }, type);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(blob);
  });
}
