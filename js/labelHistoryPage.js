import { fetchLabels } from './b2Client.js';
import { showToast } from './app.js';

const searchInput = document.getElementById('history-search');
const refreshBtn = document.getElementById('history-refresh');
const statusEl = document.getElementById('history-status');
const gridEl = document.getElementById('history-grid');

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

async function loadHistory() {
  const search = String(searchInput.value || '').trim();
  statusEl.textContent = 'Loading labels...';

  try {
    const labels = await fetchLabels(search);
    renderHistory(labels);
    statusEl.textContent = labels.length
      ? `${labels.length} label${labels.length === 1 ? '' : 's'} found`
      : 'No labels found for the current search.';
  } catch (error) {
    gridEl.innerHTML = '';
    statusEl.textContent = error.message || 'Could not load label history.';
    showToast(error.message || 'Could not load label history', true);
  }
}

function renderHistory(labels) {
  if (!labels.length) {
    gridEl.innerHTML = '';
    return;
  }

  gridEl.innerHTML = labels.map((label) => `
    <article class="history-card">
      <a href="${escapeHtml(label.labelImageUrl)}" target="_blank" rel="noopener">
        <img class="history-thumb" src="${escapeHtml(label.labelImageUrl)}" alt="Label ${escapeHtml(label.labelNumber)} preview">
      </a>
      <div class="history-meta">
        <h3>Label ${escapeHtml(label.labelNumber)}</h3>
        <span>${escapeHtml(label.productName)}</span>
        <span class="muted">Batch: ${escapeHtml(label.batchNumber)}</span>
        <span class="muted">${formatDate(label.createdAt)}</span>
      </div>
      <div class="history-actions">
        <a class="btn btn-primary" href="${escapeHtml(label.labelImageUrl)}" target="_blank" rel="noopener">View</a>
        <a class="btn" href="${escapeHtml(label.labelImageUrl)}" download>Download PNG</a>
        ${label.labelPdfUrl ? `<a class="btn" href="${escapeHtml(label.labelPdfUrl)}" target="_blank" rel="noopener">PDF</a>` : ''}
      </div>
    </article>
  `).join('');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const scheduleLoad = debounce(loadHistory, 200);

searchInput.addEventListener('input', scheduleLoad);
refreshBtn.addEventListener('click', loadHistory);

loadHistory();
