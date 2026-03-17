import { CONFIG, addFile, formatBytes, showToast } from './app.js';
import { uploadFile } from './b2Client.js';

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'zip', 'mp4']);

function isAllowedFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

export function initUploader({ onUploaded }) {
  const zone = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');
  const progressWrap = document.getElementById('upload-progress');
  const barInner = document.getElementById('progress-bar-inner');
  const pctLabel = document.getElementById('upload-pct');
  const nameLabel = document.getElementById('upload-name');

  if (!zone || !input) return;

  const onFilePicked = async (file) => {
    if (!file) return;

    if (!isAllowedFile(file)) {
      showToast('Unsupported file type. Allowed: pdf, jpg, png, doc, docx, zip, mp4', true);
      return;
    }

    if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
      showToast(`File is too large. Max ${formatBytes(CONFIG.MAX_FILE_SIZE_BYTES)}`, true);
      return;
    }

    progressWrap.hidden = false;
    nameLabel.textContent = file.name;
    setProgress(0);

    try {
      const meta = await uploadFile(file, setProgress);
      addFile(meta);
      showToast('File uploaded successfully');
      if (typeof onUploaded === 'function') onUploaded();
    } catch (error) {
      showToast(error.message || 'Upload failed', true);
    } finally {
      input.value = '';
      setTimeout(() => {
        progressWrap.hidden = true;
        setProgress(0);
      }, 900);
    }
  };

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => onFilePicked(input.files?.[0]));

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    onFilePicked(event.dataTransfer?.files?.[0]);
  });

  function setProgress(pct) {
    barInner.style.width = `${pct}%`;
    pctLabel.textContent = `${pct}%`;
  }
}
