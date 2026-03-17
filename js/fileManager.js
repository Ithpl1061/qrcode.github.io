import { copyText, formatBytes, formatDate, loadFiles, removeFile, showToast } from './app.js';
import { deleteFile } from './b2Client.js';
import { initUploader } from './upload.js';

const fileListEl = document.getElementById('file-list');
const emptyEl = document.getElementById('empty-state');
const searchEl = document.getElementById('search-input');

let allFiles = [];

function render() {
  const query = (searchEl?.value || '').trim().toLowerCase();
  const filtered = query
    ? allFiles.filter((item) => item.name.toLowerCase().includes(query) || item.key.toLowerCase().includes(query))
    : allFiles;

  fileListEl.innerHTML = '';

  if (!filtered.length) {
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  filtered.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${formatBytes(item.size)}</td>
      <td>${formatDate(item.uploadedAt)}</td>
      <td class="actions"></td>
    `;

    const actions = tr.querySelector('.actions');

    const qrBtn = makeButton('Generate QR', 'btn btn-small btn-primary', () => {
      location.href = `file-view.html?key=${encodeURIComponent(item.key)}`;
    });

    const copyBtn = makeButton('Copy Link', 'btn btn-small', async () => {
      const ok = await copyText(item.url);
      showToast(ok ? 'Link copied' : 'Copy failed', !ok);
    });

    const openBtn = makeButton('Open', 'btn btn-small', () => {
      window.open(item.url, '_blank', 'noopener');
    });

    const delBtn = makeButton('Delete', 'btn btn-small btn-danger', async () => {
      const confirmed = window.confirm(`Delete ${item.name}?`);
      if (!confirmed) return;

      try {
        if (item.fileId && item.key) {
          await deleteFile(item.fileId, item.key);
        }
      } catch (error) {
        showToast(error.message || 'Could not delete from B2', true);
      }

      allFiles = removeFile(item.fileId || item.key);
      render();
      showToast('Deleted file metadata');
    });

    actions.append(qrBtn, copyBtn, openBtn, delBtn);
    fileListEl.appendChild(tr);
  });
}

function makeButton(label, className, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function refreshFiles() {
  allFiles = loadFiles().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  render();
}

searchEl?.addEventListener('input', render);

initUploader({ onUploaded: refreshFiles });
refreshFiles();
