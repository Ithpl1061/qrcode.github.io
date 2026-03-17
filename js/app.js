const _workerUrl = window.APP_WORKER_URL || '';
if (!_workerUrl || _workerUrl.includes('your-worker') || _workerUrl.includes('YOUR-WORKER')) {
  console.warn(
    '[QR Platform] APP_WORKER_URL is not configured.\n' +
    'Open file-manager.html and file-view.html and replace the placeholder\n' +
    "window.APP_WORKER_URL = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev'\n" +
    'with your real Cloudflare Worker URL.',
  );
}

export const CONFIG = {
  WORKER_URL: _workerUrl,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  STORAGE_KEY: 'qr_file_platform_metadata_v1',
};

export function loadFiles() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFiles(files) {
  localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(files));
}

export function addFile(fileMeta) {
  const next = [fileMeta, ...loadFiles()];
  saveFiles(next);
  return next;
}

export function removeFile(fileIdOrKey) {
  const next = loadFiles().filter((item) => item.fileId !== fileIdOrKey && item.key !== fileIdOrKey);
  saveFiles(next);
  return next;
}

export function getFileByKey(key) {
  return loadFiles().find((item) => item.key === key) || null;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(isoText) {
  if (!isoText) return '-';
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

let toastTimer;
export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}
