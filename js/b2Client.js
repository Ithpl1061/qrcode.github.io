import { CONFIG } from './app.js';

function assertWorkerUrlConfigured() {
  const url = CONFIG.WORKER_URL || '';
  const invalid = !url || url.includes('your-worker') || url.includes('your-subdomain');
  if (invalid) {
    throw new Error('Worker URL is not configured. Set the frontend base URL to your deployed Worker origin.');
  }
}

export async function uploadFile(file, onProgress) {
  assertWorkerUrlConfigured();

  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      const pct = Math.round((event.loaded / event.total) * 100);
      onProgress(pct);
    });

    xhr.addEventListener('load', () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch {
        reject(new Error('Invalid response from upload server'));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.file) {
        resolve(payload.file);
        return;
      }

      reject(new Error(payload.error || `Upload failed with status ${xhr.status}`));
    });

    xhr.addEventListener('error', () => reject(new Error('Network error while uploading file')));
    xhr.addEventListener('abort', () => reject(new Error('Upload canceled')));

    xhr.open('POST', `${CONFIG.WORKER_URL}/upload`);
    xhr.send(formData);
  });
}

export async function deleteFile(fileId, fileName) {
  assertWorkerUrlConfigured();

  const res = await fetch(`${CONFIG.WORKER_URL}/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId, fileName }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Delete failed');

  return data;
}

export async function generateLabelAssets({ payload, svgBlob, pngBlob, pdfBlob }) {
  assertWorkerUrlConfigured();

  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  formData.append('labelSvg', svgBlob, 'label.svg');
  formData.append('labelPng', pngBlob, 'label.png');

  if (pdfBlob) {
    formData.append('labelPdf', pdfBlob, 'label.pdf');
  }

  const res = await fetch(`${CONFIG.WORKER_URL}/generate-label`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Label generation failed');

  return data;
}

export async function fetchLabels(search = '') {
  assertWorkerUrlConfigured();

  const url = new URL(`${CONFIG.WORKER_URL}/labels`);
  if (search.trim()) {
    url.searchParams.set('search', search.trim());
  }

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load label history');

  return data.labels || [];
}

export async function fetchLabelById(id) {
  assertWorkerUrlConfigured();

  const res = await fetch(`${CONFIG.WORKER_URL}/labels/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load label details');

  return data.label || null;
}
