import { copyText, formatBytes, formatDate, getFileByKey, showToast } from './app.js';

const params = new URLSearchParams(window.location.search);
const key = params.get('key');
const file = key ? getFileByKey(key) : null;

const fileNameEl = document.getElementById('file-name');
const fileTypeEl = document.getElementById('file-type');
const fileSizeEl = document.getElementById('file-size');
const fileDateEl = document.getElementById('file-date');
const fileUrlEl = document.getElementById('file-url');
const openFileEl = document.getElementById('open-file');
const previewEl = document.getElementById('file-preview');
const qrEl = document.getElementById('file-qr');
const copyBtn = document.getElementById('copy-url');
const qrPngBtn = document.getElementById('qr-png');
const qrSvgBtn = document.getElementById('qr-svg');

if (!file) {
  fileNameEl.textContent = 'File not found';
  previewEl.innerHTML = '<p class="muted">File metadata is missing. Go back to File Manager.</p>';
  qrPngBtn.disabled = true;
  qrSvgBtn.disabled = true;
} else {
  renderFile(file);
}

function renderFile(item) {
  const qrUrl = item.url;

  fileNameEl.textContent = item.name;
  fileTypeEl.textContent = item.type || '-';
  fileSizeEl.textContent = formatBytes(item.size);
  fileDateEl.textContent = formatDate(item.uploadedAt);
  fileUrlEl.value = qrUrl;
  openFileEl.href = item.url;

  renderPreview(item);
  renderQr(qrUrl);

  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(qrUrl);
    showToast(ok ? 'Link copied' : 'Copy failed', !ok);
  });

  qrPngBtn.addEventListener('click', () => downloadPng(qrUrl));
  qrSvgBtn.addEventListener('click', () => downloadSvg(qrUrl));
}

function renderPreview(item) {
  previewEl.innerHTML = '';

  if (item.type?.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.name;
    previewEl.appendChild(img);
    return;
  }

  if (item.type === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = item.url;
    iframe.title = item.name;
    previewEl.appendChild(iframe);
    return;
  }

  if (item.type?.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = item.url;
    video.controls = true;
    previewEl.appendChild(video);
    return;
  }

  previewEl.innerHTML = '<p class="muted">Preview not available for this file type.</p>';
}

function renderQr(url) {
  qrEl.innerHTML = '';
  QRCode.toCanvas(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }, (error, canvas) => {
    if (error) {
      qrEl.innerHTML = '<p class="muted">Could not generate QR code.</p>';
      qrPngBtn.disabled = true;
      qrSvgBtn.disabled = true;
      return;
    }

    qrEl.appendChild(canvas);
    qrPngBtn.disabled = false;
    qrSvgBtn.disabled = false;
  });
}

function getSizeInPx() {
  const DPI = 300;
  const raw = parseFloat(document.getElementById('qr-size-value')?.value);
  const value = (isNaN(raw) || raw < 32) ? 512 : raw;
  const unit = document.getElementById('qr-size-unit')?.value || 'px';
  switch (unit) {
    case 'in': return Math.round(value * DPI);
    case 'cm': return Math.round(value * DPI / 2.54);
    case 'mm': return Math.round(value * DPI / 25.4);
    default:   return Math.round(value);
  }
}

function downloadPng(url) {
  const sizePx = getSizeInPx();
  QRCode.toCanvas(url, { width: sizePx, margin: 2, errorCorrectionLevel: 'M' }, (error, canvas) => {
    if (error) { showToast('Could not generate QR code', true); return; }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `file-qr-${sizePx}px.png`;
    link.click();
  });
}

function downloadSvg(url) {
  const sizePx = getSizeInPx();
  QRCode.toString(url, { type: 'svg', width: sizePx, margin: 2, errorCorrectionLevel: 'M' }, (error, svg) => {
    if (error) return;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `file-qr-${sizePx}px.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}
