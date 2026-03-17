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
  fileNameEl.textContent = item.name;
  fileTypeEl.textContent = item.type || '-';
  fileSizeEl.textContent = formatBytes(item.size);
  fileDateEl.textContent = formatDate(item.uploadedAt);
  fileUrlEl.value = item.url;
  openFileEl.href = item.url;

  renderPreview(item);
  renderQr(item.url);

  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(item.url);
    showToast(ok ? 'Link copied' : 'Copy failed', !ok);
  });

  qrPngBtn.addEventListener('click', downloadPng);
  qrSvgBtn.addEventListener('click', () => downloadSvg(item.url));
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

function downloadPng() {
  const canvas = qrEl.querySelector('canvas');
  if (!canvas) return;

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'file-qr.png';
  link.click();
}

function downloadSvg(url) {
  QRCode.toString(url, { type: 'svg', width: 512, margin: 2, errorCorrectionLevel: 'M' }, (error, svg) => {
    if (error) return;

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'file-qr.svg';
    link.click();
    URL.revokeObjectURL(link.href);
  });
}
