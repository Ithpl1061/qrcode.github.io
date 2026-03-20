/**
 * labelHistoryPage.js – Label History with multi-select and bulk actions.
 *
 * Bulk dependencies loaded as classic CDN scripts before this module:
 *   window.JSZip   – JSZip 3.10.x  (bulk PNG ZIP download)
 *   window.jspdf   – jsPDF 2.5.x   (bulk PDF download)
 */

import { fetchLabels } from './b2Client.js';
import { showToast } from './app.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_SELECTION = 50;

// A4 page dimensions in mm  (used by jsPDF)
const A4_W      = 210;
const A4_H      = 297;
const A4_MARGIN = 12;   // page margin (mm)
const A4_FOOTER = 14;   // mm reserved at bottom for footer text

// ─── State ───────────────────────────────────────────────────────────────────
/** @type {Set<string>} IDs of currently selected labels */
const selectedLabels = new Set();

/** @type {Array<object>} All labels currently visible in the grid */
let allLabels = [];

/** Guards concurrent bulk operations */
let isBulkProcessing = false;

// ─── DOM References ──────────────────────────────────────────────────────────
const searchInput     = document.getElementById('history-search');
const refreshBtn      = document.getElementById('history-refresh');
const statusEl        = document.getElementById('history-status');
const gridEl          = document.getElementById('history-grid');
const selectionCtrl   = document.getElementById('selection-controls');
const selectAllBtn    = document.getElementById('btn-select-all');
const deselectAllBtn  = document.getElementById('btn-deselect-all');
const selectedCountEl = document.getElementById('selected-count');
const bulkBar         = document.getElementById('bulk-action-bar');
const bulkCountEl     = document.getElementById('bulk-count');
const bulkPngBtn      = document.getElementById('btn-bulk-png');
const bulkPdfBtn      = document.getElementById('btn-bulk-pdf');
const bulkPrintBtn    = document.getElementById('btn-bulk-print');
const bulkClearBtn    = document.getElementById('btn-bulk-deselect');
const progressWrap    = document.getElementById('bulk-progress-wrap');
const progressFill    = document.getElementById('bulk-progress-fill');
const progressText    = document.getElementById('bulk-progress-text');

// ─── General Utilities ───────────────────────────────────────────────────────
function debounce(fn, wait) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? (value || '–') : d.toLocaleString();
}

/** Safe string for use in file/folder names */
function sanitize(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 60) || 'label';
}

/** YYYYMMDD stamp for generated filenames */
function fileDateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Progress UI ─────────────────────────────────────────────────────────────
function showProgress(visible, text = '') {
  progressWrap.hidden = !visible;
  if (visible) { progressFill.style.width = '0%'; progressText.textContent = text; }
  [bulkPngBtn, bulkPdfBtn, bulkPrintBtn].forEach(b => { b.disabled = visible; });
}

function updateProgress(pct, text) {
  progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (text) progressText.textContent = text;
}

// ─── Selection Management ────────────────────────────────────────────────────
function toggleSelect(labelId) {
  if (selectedLabels.has(labelId)) {
    selectedLabels.delete(labelId);
    _applyCardState(labelId, false);
  } else {
    if (selectedLabels.size >= MAX_SELECTION) {
      showToast(`Maximum ${MAX_SELECTION} labels can be selected at once`, true);
      const cb = gridEl.querySelector(`.card-select[data-id="${CSS.escape(labelId)}"]`);
      if (cb) cb.checked = false;          // undo browser's optimistic check
      return;
    }
    selectedLabels.add(labelId);
    _applyCardState(labelId, true);
  }
  _syncSelectionUI();
}

function _applyCardState(labelId, selected) {
  const card = gridEl.querySelector(`.history-card[data-id="${CSS.escape(labelId)}"]`);
  if (!card) return;
  card.classList.toggle('selected', selected);
  const cb = card.querySelector('.card-select');
  if (cb) cb.checked = selected;
}

function selectAll() {
  if (!allLabels.length) return;
  const capped   = allLabels.length > MAX_SELECTION;
  const toSelect = capped ? allLabels.slice(0, MAX_SELECTION) : allLabels;
  if (capped) showToast(`Limited to first ${MAX_SELECTION} of ${allLabels.length} labels`);

  selectedLabels.clear();
  toSelect.forEach(l => selectedLabels.add(l.id));

  gridEl.querySelectorAll('.history-card').forEach(card => {
    const sel = selectedLabels.has(card.dataset.id);
    card.classList.toggle('selected', sel);
    const cb = card.querySelector('.card-select');
    if (cb) cb.checked = sel;
  });
  _syncSelectionUI();
}

function deselectAll() {
  selectedLabels.clear();
  gridEl.querySelectorAll('.history-card.selected').forEach(card => {
    card.classList.remove('selected');
    const cb = card.querySelector('.card-select');
    if (cb) cb.checked = false;
  });
  _syncSelectionUI();
}

function _syncSelectionUI() {
  const count = selectedLabels.size;

  // --- Selection controls strip (above grid) ---
  selectionCtrl.hidden = allLabels.length === 0;
  selectedCountEl.textContent = count > 0 ? `${count} selected` : '';

  // --- Bulk action bar (fixed at bottom) ---
  const barVisible = count > 0;
  bulkBar.hidden = !barVisible;
  document.body.classList.toggle('has-bulk-bar', barVisible);
  if (barVisible) {
    bulkCountEl.textContent = `${count} label${count === 1 ? '' : 's'} selected`;
  }
}

// ─── Data Loading ────────────────────────────────────────────────────────────
async function loadHistory() {
  const search = String(searchInput.value || '').trim();
  statusEl.textContent = 'Loading labels…';
  selectionCtrl.hidden = true;

  try {
    const labels = await fetchLabels(search);
    allLabels = labels;
    renderHistory(labels);
    statusEl.textContent = labels.length
      ? `${labels.length} label${labels.length === 1 ? '' : 's'} found`
      : 'No labels found for the current search.';
    _syncSelectionUI();
  } catch (err) {
    allLabels = [];
    gridEl.innerHTML = '';
    statusEl.textContent = err.message || 'Could not load label history.';
    showToast(err.message || 'Could not load label history', true);
    _syncSelectionUI();
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function renderHistory(labels) {
  if (!labels.length) { gridEl.innerHTML = ''; return; }

  gridEl.innerHTML = labels.map(label => {
    const sel      = selectedLabels.has(label.id);
    const id       = escapeHtml(label.id);
    const num      = escapeHtml(label.labelNumber);
    const imgUrl   = escapeHtml(label.labelImageUrl);
    const pdfLink  = label.labelPdfUrl
      ? `<a class="btn btn-small" href="${escapeHtml(label.labelPdfUrl)}"
            target="_blank" rel="noopener noreferrer">PDF</a>`
      : '';
    return `
<article class="history-card${sel ? ' selected' : ''}" data-id="${id}">
  <label class="card-select-wrap" title="Select for bulk action">
    <input type="checkbox" class="card-select" data-id="${id}"
           ${sel ? 'checked' : ''} aria-label="Select label ${num}">
    <span class="card-select-indicator" aria-hidden="true"></span>
  </label>
  <a class="history-thumb-link" href="${imgUrl}"
     target="_blank" rel="noopener noreferrer" tabindex="-1">
    <img class="history-thumb" src="${imgUrl}"
         alt="Label ${num} preview" loading="lazy">
  </a>
  <div class="history-meta">
    <h3 class="history-label-num">Label ${num}</h3>
    <span class="history-product">${escapeHtml(label.productName)}</span>
    <span class="muted">Batch: ${escapeHtml(label.batchNumber)}</span>
    <span class="muted">${formatDate(label.createdAt)}</span>
  </div>
  <div class="history-actions">
    <a class="btn btn-primary btn-small" href="${imgUrl}"
       target="_blank" rel="noopener noreferrer">View</a>
    <a class="btn btn-small" href="${imgUrl}"
       download="label_${num}.png">PNG</a>
    ${pdfLink}
  </div>
</article>`;
  }).join('');
}

// ─── Bulk Download – PNG (ZIP) ───────────────────────────────────────────────
async function bulkDownloadPng() {
  if (isBulkProcessing) return;
  const ids = [...selectedLabels];
  if (!ids.length) return;

  if (typeof window.JSZip === 'undefined') {
    showToast('ZIP library unavailable. Please refresh the page.', true);
    return;
  }

  isBulkProcessing = true;
  showProgress(true, 'Initialising ZIP archive…');

  const labels = allLabels.filter(l => ids.includes(l.id));
  const zip    = new window.JSZip();
  let ok = 0;
  const failed = [];

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const seq   = String(i + 1).padStart(3, '0');
    updateProgress((i / labels.length) * 88, `Downloading ${i + 1} / ${labels.length}…`);
    try {
      const res = await fetchWithRetry(label.labelImageUrl, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob     = await res.blob();
      const filename = `label_${seq}_${sanitize(label.labelNumber)}.png`;
      zip.file(filename, blob);
      ok++;
    } catch (err) {
      console.warn(`[bulkPng] Skip "${label.labelNumber}":`, err.message);
      failed.push(label.labelNumber);
    }
  }

  if (ok === 0) {
    showToast('No labels could be downloaded. Check your connection.', true);
    showProgress(false);
    isBulkProcessing = false;
    return;
  }

  updateProgress(91, 'Building ZIP file…');
  try {
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      meta => updateProgress(91 + (meta.percent / 100) * 9, 'Compressing…'),
    );
    triggerDownload(blob, `labels_${fileDateStamp()}.zip`);
    updateProgress(100, 'Complete!');
    showSummaryToast(ok, labels.length, failed);
  } catch (err) {
    console.error('[bulkPng] ZIP error:', err);
    showToast(`ZIP generation failed: ${err.message}`, true);
  } finally {
    setTimeout(() => { showProgress(false); isBulkProcessing = false; }, 1400);
  }
}

// ─── Bulk Download – PDF (one label per A4 page) ─────────────────────────────
async function bulkDownloadPdf() {
  if (isBulkProcessing) return;
  const ids = [...selectedLabels];
  if (!ids.length) return;

  if (!window.jspdf?.jsPDF) {
    showToast('PDF library unavailable. Please refresh the page.', true);
    return;
  }

  isBulkProcessing = true;
  showProgress(true, 'Initialising PDF…');

  const { jsPDF } = window.jspdf;
  const labels    = allLabels.filter(l => ids.includes(l.id));
  const maxImgW   = A4_W - A4_MARGIN * 2;
  const maxImgH   = A4_H - A4_MARGIN * 2 - A4_FOOTER;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let ok = 0;
  const failed = [];

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    updateProgress((i / labels.length) * 90, `Rendering ${i + 1} / ${labels.length}…`);
    try {
      const dataUrl  = await loadImageAsDataUrl(label.labelImageUrl, 2);
      const imgType  = detectImageType(dataUrl);
      const { w, h } = await computeFittedDimensions(dataUrl, maxImgW, maxImgH);

      if (i > 0) doc.addPage();

      // Centre the label image on the page
      const x = (A4_W - w) / 2;
      const y = A4_MARGIN;
      doc.addImage(dataUrl, imgType, x, y, w, h, undefined, 'FAST');

      // ── Page footer ──
      const lineY = A4_H - A4_MARGIN + 1;
      doc.setDrawColor(195, 210, 195);
      doc.setLineWidth(0.25);
      doc.line(A4_MARGIN, lineY, A4_W - A4_MARGIN, lineY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(118, 128, 118);
      const footerText = [
        `Label: ${label.labelNumber}`,
        label.productName,
        `Batch: ${label.batchNumber}`,
        formatDate(label.createdAt),
      ].join('  |  ');
      doc.text(footerText, A4_W / 2, lineY + 4, { align: 'center', maxWidth: maxImgW });

      ok++;
    } catch (err) {
      console.warn(`[bulkPdf] Skip "${label.labelNumber}":`, err.message);
      failed.push(label.labelNumber);
    }
  }

  if (ok === 0) {
    showToast('No labels could be rendered for PDF.', true);
    showProgress(false);
    isBulkProcessing = false;
    return;
  }

  updateProgress(97, 'Saving PDF…');
  try {
    doc.save(`labels_${fileDateStamp()}.pdf`);
    updateProgress(100, 'Complete!');
    showSummaryToast(ok, labels.length, failed);
  } catch (err) {
    console.error('[bulkPdf] Save error:', err);
    showToast(`PDF save failed: ${err.message}`, true);
  } finally {
    setTimeout(() => { showProgress(false); isBulkProcessing = false; }, 1400);
  }
}

// ─── Bulk Print ───────────────────────────────────────────────────────────────
function bulkPrint() {
  if (isBulkProcessing) return;
  const ids = [...selectedLabels];
  if (!ids.length) return;

  const labels = allLabels.filter(l => ids.includes(l.id));
  const win    = window.open('', '_blank', 'width=920,height=760');

  if (!win) {
    showToast('Pop-up blocked. Allow pop-ups for this site, then try again.', true);
    return;
  }

  // Build HTML for each label page
  const pagesHtml = labels.map(l => `
  <div class="page">
    <img src="${escapeHtml(l.labelImageUrl)}"
         alt="Label ${escapeHtml(l.labelNumber)}"
         class="label-img"
         crossorigin="anonymous">
  </div>`).join('\n');

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Print ${labels.length} Label${labels.length === 1 ? '' : 's'}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f4f4f4; color: #111;
  }
  h1.print-header {
    text-align: center; padding: 8mm 0 4mm;
    font-size: 11pt; color: #444; font-weight: 500;
  }
  /* ── Screen preview ── */
  .page {
    width: 210mm; min-height: 282mm; margin: 0 auto 10mm;
    padding: 12mm 14mm 8mm; display: flex; flex-direction: column;
    align-items: center; border: 1px solid #ccc; background: #fff;
    page-break-after: always;
  }
  .page:last-child { margin-bottom: 0; border-color: transparent; }
  .label-img {
    display: block; max-width: 100%; max-height: 248mm;
    width: auto; height: auto; object-fit: contain;
  }
  /* ── Print styles ── */
  @media print {
    html, body { margin: 0; padding: 0; background: #fff; }
    @page { size: A4 portrait; margin: 0; }
    h1.print-header { display: none; }
    .page {
      width: 210mm; height: 297mm; min-height: 0; margin: 0;
      padding: 12mm 14mm 8mm; border: none;
      page-break-inside: avoid; page-break-after: always;
    }
    .page:last-child { page-break-after: avoid; }
  }
</style>
</head>
<body>
<h1 class="print-header">Pharmaceutical Labels – ${labels.length} label${labels.length === 1 ? '' : 's'}</h1>
${pagesHtml}
<script>
(function () {
  var imgs  = document.querySelectorAll('.label-img');
  var total = imgs.length;
  var done  = 0;
  function tryPrint() { if (++done >= total) { window.focus(); window.print(); } }
  if (!total) { window.print(); return; }
  imgs.forEach(function (img) {
    if (img.complete && img.naturalHeight) { tryPrint(); }
    else {
      img.addEventListener('load',  tryPrint);
      img.addEventListener('error', tryPrint);
    }
  });
}());
<\/script>
</body>
</html>`);
  win.document.close();
}

// ─── Network / Image Helpers ─────────────────────────────────────────────────
async function fetchWithRetry(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try   { return await fetch(url); }
    catch (err) {
      lastErr = err;
      if (i < retries) await sleep(380 * (i + 1));
    }
  }
  throw lastErr;
}

async function loadImageAsDataUrl(url, retries = 2) {
  const res = await fetchWithRetry(url, retries);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Detect image type from Data URL prefix for jsPDF */
function detectImageType(dataUrl) {
  if (/^data:image\/jpe?g/i.test(dataUrl)) return 'JPEG';
  if (/^data:image\/webp/i.test(dataUrl))  return 'WEBP';
  return 'PNG';
}

/**
 * Fits image to maxW × maxH (mm) preserving the native aspect ratio.
 * Requires the DataURL so it can decode real pixel dimensions.
 * @returns {Promise<{w: number, h: number}>}
 */
function computeFittedDimensions(dataUrl, maxW, maxH) {
  return new Promise(resolve => {
    const img    = new Image();
    img.onload   = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) { resolve({ w: maxW, h: Math.min(maxW * 0.65, maxH) }); return; }
      const ratio = nw / nh;
      let w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      resolve({ w, h });
    };
    img.onerror = () => resolve({ w: maxW, h: Math.min(maxW * 0.65, maxH) });
    img.src = dataUrl;
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 12_000);
}

function showSummaryToast(ok, total, failed) {
  if (!failed.length) {
    showToast(`✓  ${ok} label${ok === 1 ? '' : 's'} processed successfully`);
  } else {
    const preview = failed.slice(0, 3).join(', ');
    const more    = failed.length > 3 ? ` +${failed.length - 3} more` : '';
    showToast(`${ok}/${total} labels processed. Skipped: ${preview}${more}`, true);
  }
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
const scheduleLoad = debounce(loadHistory, 220);

searchInput.addEventListener('input', scheduleLoad);
refreshBtn .addEventListener('click', loadHistory);

// Checkbox changes – delegated so it survives grid re-renders
gridEl.addEventListener('change', e => {
  if (e.target.classList.contains('card-select')) toggleSelect(e.target.dataset.id);
});

// Space / Enter on a focused card toggles it
gridEl.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  const card = e.target.closest('.history-card');
  if (!card || e.target !== card) return;
  e.preventDefault();
  const cb = card.querySelector('.card-select');
  if (cb) { cb.checked = !cb.checked; toggleSelect(card.dataset.id); }
});

selectAllBtn  .addEventListener('click', selectAll);
deselectAllBtn.addEventListener('click', deselectAll);
bulkClearBtn  .addEventListener('click', deselectAll);

bulkPngBtn.addEventListener('click', () =>
  bulkDownloadPng().catch(err => {
    showToast(`Download failed: ${err.message}`, true);
    showProgress(false); isBulkProcessing = false;
  }),
);

bulkPdfBtn.addEventListener('click', () =>
  bulkDownloadPdf().catch(err => {
    showToast(`PDF failed: ${err.message}`, true);
    showProgress(false); isBulkProcessing = false;
  }),
);

bulkPrintBtn.addEventListener('click', bulkPrint);

// ─── Boot ────────────────────────────────────────────────────────────────────
loadHistory();

