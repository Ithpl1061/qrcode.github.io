import { CONFIG } from './app.js';

function assertWorkerUrlConfigured() {
  const url = CONFIG.WORKER_URL || '';
  const invalid = !url || url.includes('your-worker') || url.includes('your-subdomain');
  if (invalid) {
    throw new Error('Worker URL is not configured. Set APP_WORKER_URL to your deployed Cloudflare Worker URL.');
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
