import { CONFIG, showToast } from './app.js';
import { generateLabelAssets, uploadFile } from './b2Client.js';
import {
  buildLabelSvg,
  calculateExportMetrics,
  createPdfBlobFromPng,
  defaultLabelPayload,
  downloadBlob,
  LABEL_DIMENSIONS,
  normalizeDimensionPair,
  svgToPngBlob,
} from './labelTemplate.js';

const form = document.getElementById('label-form');
const preview = document.getElementById('label-preview');
const labelNumberInput = document.getElementById('labelNumber');
const uploadInput = document.getElementById('supporting-file');
const uploadBtn = document.getElementById('upload-file-btn');
const uploadStatus = document.getElementById('upload-status');
const uploadName = document.getElementById('selected-file-name');
const uploadProgressWrap = document.getElementById('upload-progress');
const uploadProgressBar = document.getElementById('label-progress-bar-inner');
const uploadProgressPct = document.getElementById('label-upload-pct');
const uploadProgressLabel = document.getElementById('label-upload-name');
const outputFormat = document.getElementById('output-format');
const exportWidthEl = document.getElementById('export-width');
const exportHeightEl = document.getElementById('export-height');
const exportUnitEl = document.getElementById('export-unit');
const previewScaleEl = document.getElementById('preview-scale');
const sizeSummaryEl = document.getElementById('size-summary');
const sizeWarningEl = document.getElementById('size-warning');
const generateBtn = document.getElementById('generate-label-btn');
const downloadPngBtn = document.getElementById('download-label-png');
const downloadSvgBtn = document.getElementById('download-label-svg');
const downloadPdfBtn = document.getElementById('download-label-pdf');
const clearFormBtn = document.getElementById('clear-form-btn');
const viewLabelsBtn = document.getElementById('view-labels-btn');
const resultPanel = document.getElementById('label-result');

let uploadedFileMeta = null;
let latestArtifacts = null;
let previewWindowRef = null;
let lastEditedDimension = 'width';
const DEFAULT_RESULT_MESSAGE = 'Generated asset URLs will appear here.';

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function syncDefaults() {
  const payload = defaultLabelPayload();
  Object.entries(payload).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field && typeof field.value === 'string') field.value = value;
  });
  ensureLabelNumber();
}

function clearEditableFields() {
  const elements = Array.from(form.elements);

  elements.forEach((field) => {
    if (!(field instanceof HTMLElement) || !('name' in field)) return;
    if (field === outputFormat) return;

    if (field instanceof HTMLInputElement) {
      if (field.type === 'text' || field.type === 'search' || field.type === 'number' || field.type === 'email' || field.type === 'tel') {
        field.value = '';
      } else if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = false;
      }
      return;
    }

    if (field instanceof HTMLTextAreaElement) {
      field.value = '';
      return;
    }

    if (field instanceof HTMLSelectElement) {
      field.selectedIndex = 0;
    }
  });
}

function getExportMetrics() {
  const width = Number(exportWidthEl.value);
  const height = Number(exportHeightEl.value);
  const unit = exportUnitEl.value;
  return calculateExportMetrics(width, height, unit);
}

function getPayload() {
  const data = new FormData(form);
  const metrics = getExportMetrics();
  const labelNumber = ensureLabelNumber();

  return {
    labelNumber,
    productName: String(data.get('productName') || '').trim(),
    formNumber: String(data.get('formNumber') || '').trim(),
    productCode: String(data.get('productCode') || '').trim(),
    batchNumber: String(data.get('batchNumber') || '').trim(),
    manufacturingMonth: String(data.get('manufacturingMonth') || '').trim(),
    retestMonth: String(data.get('retestMonth') || '').trim(),
    containerNumber: String(data.get('containerNumber') || '').trim(),
    grossWeight: String(data.get('grossWeight') || '').trim(),
    tareWeight: String(data.get('tareWeight') || '').trim(),
    netWeight: String(data.get('netWeight') || '').trim(),
    storageInstruction: String(data.get('storageInstruction') || '').trim(),
    drugLicenseNumber: String(data.get('drugLicenseNumber') || '').trim(),
    manufacturerName: String(data.get('manufacturerName') || '').trim(),
    manufacturerAddress: String(data.get('manufacturerAddress') || '').trim(),
    qrCaption: String(data.get('qrCaption') || '').trim() || 'QRCODE',
    fileUrl: uploadedFileMeta?.url || '',
    exportWidth: metrics.width,
    exportHeight: metrics.height,
    exportUnit: metrics.unit,
    exportDpi: metrics.dpi,
    exportPixelWidth: metrics.rasterWidth,
    exportPixelHeight: metrics.rasterHeight,
  };
}

function syncSizeFields() {
  const width = Number(exportWidthEl.value);
  const height = Number(exportHeightEl.value);
  const normalized = normalizeDimensionPair(width, height);

  if (lastEditedDimension === 'width') {
    exportHeightEl.value = (normalized.width / LABEL_DIMENSIONS.aspectRatio).toFixed(2);
  } else {
    exportWidthEl.value = (normalized.height * LABEL_DIMENSIONS.aspectRatio).toFixed(2);
  }

  updateSizeFeedback();
}

function updateSizeFeedback() {
  const metrics = getExportMetrics();
  preview.style.maxWidth = `${Math.round(metrics.cssPixelWidth * Number(previewScaleEl.value || 1))}px`;

  sizeSummaryEl.textContent = `Output size: ${metrics.width} ${metrics.unit} x ${metrics.height} ${metrics.unit} | Raster: ${metrics.rasterWidth} x ${metrics.rasterHeight} px @ ${metrics.dpi} DPI`;

  const qrPixels = Math.round((120 / LABEL_DIMENSIONS.width) * metrics.rasterWidth);
  const tooSmall = qrPixels < 96;
  sizeWarningEl.hidden = !tooSmall;
  sizeWarningEl.textContent = tooSmall ? 'Selected size may reduce QR readability. Increase width for safer scanning.' : '';
}

function buildAutoLabelNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '');
  return stamp.slice(-6);
}

function ensureLabelNumber() {
  const existing = String(labelNumberInput?.value || '').trim();
  if (existing) return existing;

  const generated = buildAutoLabelNumber();
  if (labelNumberInput) labelNumberInput.value = generated;
  return generated;
}

function updateGenerateButtonState() {
  const hasRequiredFields = form.checkValidity();
  const hasSourceFile = Boolean(uploadedFileMeta?.url);
  generateBtn.disabled = !hasRequiredFields || !hasSourceFile;
}

async function renderPreview() {
  const payload = getPayload();
  if (!payload.fileUrl) {
    preview.innerHTML = '<p class="muted">Upload the supporting file first. The QR code is generated from its worker-proxied URL.</p>';
    toggleDownloadButtons(false);
    updateGenerateButtonState();
    return;
  }

  try {
    const metrics = getExportMetrics();
    const svg = await buildLabelSvg(payload, {
      displayWidthPx: metrics.cssPixelWidth,
      displayHeightPx: metrics.cssPixelHeight,
    });
    preview.innerHTML = svg;
    latestArtifacts = { payload, svg, metrics };
    toggleDownloadButtons(true);
    updateGenerateButtonState();
  } catch (error) {
    preview.innerHTML = '<p class="muted">Preview could not be rendered.</p>';
    toggleDownloadButtons(false);
    updateGenerateButtonState();
    showToast(error.message || 'Preview failed', true);
  }
}

async function handleUpload() {
  const file = uploadInput.files?.[0];
  if (!file) {
    showToast('Select a file to upload first', true);
    return;
  }

  uploadProgressWrap.hidden = false;
  uploadProgressLabel.textContent = file.name;
  setProgress(0);
  uploadStatus.textContent = 'Uploading to secure storage...';

  try {
    uploadedFileMeta = await uploadFile(file, setProgress);
    uploadName.textContent = `${uploadedFileMeta.name} uploaded`;
    uploadStatus.textContent = uploadedFileMeta.url;
    await renderPreview();
    updateGenerateButtonState();
    showToast('Supporting file uploaded');
  } catch (error) {
    uploadedFileMeta = null;
    uploadStatus.textContent = error.message || 'Upload failed';
    updateGenerateButtonState();
    showToast(error.message || 'Upload failed', true);
  } finally {
    setTimeout(() => {
      uploadProgressWrap.hidden = true;
      setProgress(0);
    }, 900);
  }
}

async function exportArtifacts() {
  if (!latestArtifacts) {
    await renderPreview();
  }
  if (!latestArtifacts) return null;

  const metrics = latestArtifacts.metrics || getExportMetrics();
  const exportSvg = await buildLabelSvg(latestArtifacts.payload, {
    displayWidthPx: metrics.rasterWidth,
    displayHeightPx: metrics.rasterHeight,
  });
  const svgBlob = new Blob([exportSvg], { type: 'image/svg+xml;charset=utf-8' });
  const pngBlob = await svgToPngBlob(exportSvg, {
    width: metrics.rasterWidth,
    height: metrics.rasterHeight,
  });
  const pdfBlob = await createPdfBlobFromPng(pngBlob, metrics);
  return { svgBlob, pngBlob, pdfBlob, exportSvg, metrics };
}

async function handleGenerate() {
  if (!uploadedFileMeta?.url) {
    showToast('Upload the source file before generating the label', true);
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';
  previewWindowRef = window.open('', '_blank');

  try {
    await renderPreview();
    const artifacts = await exportArtifacts();
    if (!artifacts) throw new Error('Label artifacts could not be created.');

    openPreviewTab({
      svg: artifacts.exportSvg,
      title: `${latestArtifacts.payload.productName} Preview`,
      status: 'Storing generated assets...',
      links: [],
    });

    const response = await generateLabelAssets({
      payload: {
        ...latestArtifacts.payload,
        outputFormat: outputFormat.value,
        sourceFile: uploadedFileMeta,
        width: artifacts.metrics.width,
        height: artifacts.metrics.height,
        unit: artifacts.metrics.unit,
        rasterWidth: artifacts.metrics.rasterWidth,
        rasterHeight: artifacts.metrics.rasterHeight,
      },
      svgBlob: artifacts.svgBlob,
      pngBlob: artifacts.pngBlob,
      pdfBlob: artifacts.pdfBlob,
    });

    renderResult(response);
    openPreviewTab({
      svg: artifacts.exportSvg,
      title: `${latestArtifacts.payload.productName} Preview`,
      status: 'Label generated successfully.',
      links: [
        { label: 'Open PNG', href: response.labelUrl },
        { label: 'Open SVG', href: response.labelSvgUrl },
        ...(response.labelPdfUrl ? [{ label: 'Open PDF', href: response.labelPdfUrl }] : []),
        // { label: 'Open Source File', href: response.fileUrl },
        // { label: 'Open Manifest', href: response.manifestUrl },
      ],
    });
    showToast('Label generated and stored');
  } catch (error) {
    openPreviewTab({
      svg: latestArtifacts?.svg || '',
      title: 'Label Preview',
      status: error.message || 'Label generation failed.',
      links: [],
      isError: true,
    });
    showToast(error.message || 'Label generation failed', true);
  } finally {
    generateBtn.textContent = 'Generate Label';
    updateGenerateButtonState();
  }
}

async function downloadPng() {
  const artifacts = await exportArtifacts();
  if (!artifacts?.pngBlob) return;
  downloadBlob(artifacts.pngBlob, fileBaseName('png'));
}

async function downloadSvg() {
  const artifacts = await exportArtifacts();
  if (!artifacts?.svgBlob) return;
  downloadBlob(artifacts.svgBlob, fileBaseName('svg'));
}

async function downloadPdf() {
  const artifacts = await exportArtifacts();
  if (!artifacts?.pdfBlob) {
    showToast('PDF library not available. The page still supports PNG/SVG export.', true);
    return;
  }
  downloadBlob(artifacts.pdfBlob, fileBaseName('pdf'));
}

function renderResult(response) {
  resultPanel.innerHTML = `
    <div class="result-grid">
      <strong>Label ${escapeHtml(response.labelNumber || '')}</strong>
      <span class="muted">${escapeHtml(response.record?.createdAt || '')}</span>
      <div class="button-row">
        <a href="${response.labelUrl}" target="_blank" rel="noopener" class="btn btn-primary">View Image</a>
        <a href="label-history.html" class="btn">View All Labels</a>
      </div>
    </div>
  `;
}

function fileBaseName(extension) {
  const base = (getPayload().productCode || 'pharma-label').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-');
  return `${base || 'pharma-label'}-${exportWidthEl.value}${exportUnitEl.value}.${extension}`;
}

function setProgress(pct) {
  uploadProgressBar.style.width = `${pct}%`;
  uploadProgressPct.textContent = `${pct}%`;
}

function toggleDownloadButtons(enabled) {
  downloadPngBtn.disabled = !enabled;
  downloadSvgBtn.disabled = !enabled;
  downloadPdfBtn.disabled = !enabled;
}

function resetResultPanel() {
  resultPanel.textContent = DEFAULT_RESULT_MESSAGE;
}

function resetForm() {
  form.reset();
  clearEditableFields();
  outputFormat.value = 'png';
  exportWidthEl.value = '4';
  exportHeightEl.value = '2.54';
  exportUnitEl.value = 'in';
  previewScaleEl.value = '1.3';
  uploadInput.value = '';
  uploadName.textContent = 'No file selected';
  uploadStatus.textContent = '';
  uploadProgressWrap.hidden = true;
  setProgress(0);
  uploadedFileMeta = null;
  latestArtifacts = null;
  if (previewWindowRef && !previewWindowRef.closed) {
    previewWindowRef.close();
  }
  previewWindowRef = null;
  preview.innerHTML = '<p class="muted">Upload the supporting file first. The QR code is generated from its worker-proxied URL.</p>';
  toggleDownloadButtons(false);
  resetResultPanel();
  updateSizeFeedback();
  updateGenerateButtonState();
}

function bindEvents() {
  const schedulePreview = debounce(renderPreview, 150);

  uploadBtn.addEventListener('click', handleUpload);
  generateBtn.addEventListener('click', handleGenerate);
  downloadPngBtn.addEventListener('click', downloadPng);
  downloadSvgBtn.addEventListener('click', downloadSvg);
  downloadPdfBtn.addEventListener('click', downloadPdf);
  clearFormBtn.addEventListener('click', resetForm);
  viewLabelsBtn.addEventListener('click', () => {
    window.location.href = 'label-history.html';
  });

  uploadInput.addEventListener('change', () => {
    uploadName.textContent = uploadInput.files?.[0]?.name || 'No file selected';
    if (!uploadInput.files?.[0]) {
      uploadedFileMeta = null;
      uploadStatus.textContent = '';
      latestArtifacts = null;
      preview.innerHTML = '<p class="muted">Upload the supporting file first. The QR code is generated from its worker-proxied URL.</p>';
      toggleDownloadButtons(false);
    }
    updateGenerateButtonState();
  });

  exportWidthEl.addEventListener('input', () => {
    lastEditedDimension = 'width';
    syncSizeFields();
    schedulePreview();
  });

  exportHeightEl.addEventListener('input', () => {
    lastEditedDimension = 'height';
    syncSizeFields();
    schedulePreview();
  });

  exportUnitEl.addEventListener('change', () => {
    updateSizeFeedback();
    schedulePreview();
  });

  previewScaleEl.addEventListener('change', () => {
    updateSizeFeedback();
  });

  form.addEventListener('input', () => {
    updateGenerateButtonState();
    if (uploadedFileMeta?.url) {
      schedulePreview();
    }
  });

  form.addEventListener('change', () => {
    updateGenerateButtonState();
  });
}

function init() {
  if (!CONFIG.WORKER_URL) {
    uploadStatus.textContent = 'Worker URL is not configured.';
  }

  syncDefaults();
  resetResultPanel();
  updateSizeFeedback();
  bindEvents();
  updateGenerateButtonState();
  renderPreview();
}

function openPreviewTab({ svg, title, status, links, isError = false }) {
  if (!previewWindowRef || previewWindowRef.closed) {
    previewWindowRef = window.open('', '_blank');
  }

  if (!previewWindowRef) return;

  const safeTitle = escapeHtml(title || 'Label Preview');
  const safeStatus = escapeHtml(status || '');
  const linksMarkup = links.length
    ? links.map((item) => `<a href="${item.href}" target="_blank" rel="noopener">${escapeHtml(item.label)}</a>`).join('')
    : '<span class="muted">No stored assets yet.</span>';

  previewWindowRef.document.open();
  previewWindowRef.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${safeTitle}</title>
      <style>
        body { margin: 0; font-family: Arial, sans-serif; background: #eef3ea; color: #162017; }
        .page { max-width: 1180px; margin: 0 auto; padding: 24px; }
        .card { background: #fff; border: 1px solid #d3dccd; border-radius: 18px; padding: 18px; box-shadow: 0 16px 40px rgba(0,0,0,.07); }
        .status { margin: 0 0 14px; color: ${isError ? '#9d2323' : '#2f5f3b'}; font-weight: 700; }
        .preview { overflow: auto; }
        .preview svg { width: 100%; height: auto; display: block; background: #fff; }
        .links { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px; }
        .links a { text-decoration: none; color: #fff; background: #146c43; padding: 10px 14px; border-radius: 10px; }
        .muted { color: #5c6c59; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="card">
          <h1>${safeTitle}</h1>
          <p class="status">${safeStatus}</p>
          <div class="preview">${svg || '<p class="muted">Preview unavailable.</p>'}</div>
          <div class="links">${linksMarkup}</div>
        </div>
      </div>
    </body>
    </html>
  `);
  previewWindowRef.document.close();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

init();
