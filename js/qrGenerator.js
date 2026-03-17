const PX_PER_INCH = 96;
const PX_PER_CM = 37.795;
const MIN_SIZE_PX = 96;
const MAX_SIZE_PX = 4096;

const modeButtons = document.querySelectorAll('[data-mode]');
const contentLabel = document.getElementById('content-label');
const contentEl = document.getElementById('qr-content');

const sizeValueEl = document.getElementById('qr-size-value');
const sizeUnitEl = document.getElementById('qr-size-unit');
const marginValueEl = document.getElementById('qr-margin-value');
const marginUnitEl = document.getElementById('qr-margin-unit');

const dpiEl = document.getElementById('qr-dpi');
const eccEl = document.getElementById('qr-ecc');
const fgEl = document.getElementById('qr-foreground');
const bgEl = document.getElementById('qr-background');
const transparentBgEl = document.getElementById('qr-transparent-bg');
const dotStyleEl = document.getElementById('qr-dot-style');
const cornerStyleEl = document.getElementById('qr-corner-style');
const filenameEl = document.getElementById('qr-filename');

const previewEl = document.getElementById('qr-preview');
const qualityEl = document.getElementById('quality-indicator');

const contentErrorEl = document.getElementById('content-error');
const sizeErrorEl = document.getElementById('size-error');
const contrastWarningEl = document.getElementById('contrast-warning');
const densityWarningEl = document.getElementById('density-warning');

const pngBtn = document.getElementById('download-png');
const svgBtn = document.getElementById('download-svg');
const copyBtn = document.getElementById('copy-qr');

let mode = 'url';
let lastValidPayload = null;

function pxFromUnit(value, unit) {
  if (unit === 'inch') return value * PX_PER_INCH;
  if (unit === 'cm') return value * PX_PER_CM;
  return value;
}

function sanitizeFileName(name) {
  const base = (name || 'qr-code').trim();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^[_\-.]+/, '').slice(0, 80) || 'qr-code';
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const norm = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * norm[0] + 0.7152 * norm[1] + 0.0722 * norm[2];
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function isHttpsUrl(value) {
  return /^https:\/\/\S+$/i.test(value);
}

function finderArea(row, col, moduleCount) {
  const topLeft = row < 7 && col < 7;
  const topRight = row < 7 && col >= moduleCount - 7;
  const bottomLeft = row >= moduleCount - 7 && col < 7;
  return topLeft || topRight || bottomLeft;
}

function isDarkModule(qrData, row, col) {
  if (qrData.modules && typeof qrData.modules.get === 'function') {
    return qrData.modules.get(row, col);
  }

  const size = qrData.modules.size;
  return Boolean(qrData.modules.data[row * size + col]);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawFinder(ctx, x, y, moduleSize, darkColor, lightColor, style) {
  const outer = moduleSize * 7;
  const middle = moduleSize * 5;
  const core = moduleSize * 3;
  const radius = style === 'rounded' ? moduleSize * 1.6 : 0;

  ctx.fillStyle = darkColor;
  if (radius > 0) {
    drawRoundedRect(ctx, x, y, outer, outer, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, outer, outer);
  }

  ctx.fillStyle = lightColor;
  if (radius > 0) {
    drawRoundedRect(ctx, x + moduleSize, y + moduleSize, middle, middle, radius * 0.8);
    ctx.fill();
  } else {
    ctx.fillRect(x + moduleSize, y + moduleSize, middle, middle);
  }

  ctx.fillStyle = darkColor;
  if (radius > 0) {
    drawRoundedRect(ctx, x + moduleSize * 2, y + moduleSize * 2, core, core, radius * 0.6);
    ctx.fill();
  } else {
    ctx.fillRect(x + moduleSize * 2, y + moduleSize * 2, core, core);
  }
}

function drawQrToCanvas(canvas, qrData, drawOptions) {
  const {
    pixelSize,
    marginPx,
    darkColor,
    lightColor,
    transparent,
    dotStyle,
    cornerStyle,
  } = drawOptions;

  const moduleCount = qrData.modules.size;
  const safeMargin = Math.max(0, Math.floor(marginPx));
  const innerSize = pixelSize - safeMargin * 2;
  const moduleSize = innerSize / moduleCount;

  canvas.width = pixelSize;
  canvas.height = pixelSize;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, pixelSize, pixelSize);

  if (!transparent) {
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, pixelSize, pixelSize);
  }

  ctx.fillStyle = darkColor;

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!isDarkModule(qrData, row, col)) continue;
      if (finderArea(row, col, moduleCount)) continue;

      const x = safeMargin + col * moduleSize;
      const y = safeMargin + row * moduleSize;

      if (dotStyle === 'rounded') {
        const radius = moduleSize * 0.42;
        ctx.beginPath();
        ctx.arc(x + moduleSize / 2, y + moduleSize / 2, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, moduleSize, moduleSize);
      }
    }
  }

  drawFinder(ctx, safeMargin, safeMargin, moduleSize, darkColor, transparent ? 'rgba(255,255,255,0)' : lightColor, cornerStyle);
  drawFinder(ctx, safeMargin + moduleSize * (moduleCount - 7), safeMargin, moduleSize, darkColor, transparent ? 'rgba(255,255,255,0)' : lightColor, cornerStyle);
  drawFinder(ctx, safeMargin, safeMargin + moduleSize * (moduleCount - 7), moduleSize, darkColor, transparent ? 'rgba(255,255,255,0)' : lightColor, cornerStyle);

  return { moduleCount, moduleSize };
}

function buildSvg(qrData, drawOptions) {
  const {
    pixelSize,
    marginPx,
    darkColor,
    lightColor,
    transparent,
    dotStyle,
    cornerStyle,
  } = drawOptions;

  const moduleCount = qrData.modules.size;
  const safeMargin = Math.max(0, Math.floor(marginPx));
  const innerSize = pixelSize - safeMargin * 2;
  const moduleSize = innerSize / moduleCount;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${pixelSize} ${pixelSize}" shape-rendering="geometricPrecision">`,
  ];

  if (!transparent) {
    parts.push(`<rect x="0" y="0" width="${pixelSize}" height="${pixelSize}" fill="${lightColor}"/>`);
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!isDarkModule(qrData, row, col)) continue;
      if (finderArea(row, col, moduleCount)) continue;

      const x = safeMargin + col * moduleSize;
      const y = safeMargin + row * moduleSize;

      if (dotStyle === 'rounded') {
        parts.push(`<circle cx="${x + moduleSize / 2}" cy="${y + moduleSize / 2}" r="${moduleSize * 0.42}" fill="${darkColor}"/>`);
      } else {
        parts.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" fill="${darkColor}"/>`);
      }
    }
  }

  parts.push(finderSvg(safeMargin, safeMargin, moduleSize, darkColor, transparent ? 'none' : lightColor, cornerStyle));
  parts.push(finderSvg(safeMargin + moduleSize * (moduleCount - 7), safeMargin, moduleSize, darkColor, transparent ? 'none' : lightColor, cornerStyle));
  parts.push(finderSvg(safeMargin, safeMargin + moduleSize * (moduleCount - 7), moduleSize, darkColor, transparent ? 'none' : lightColor, cornerStyle));

  parts.push('</svg>');
  return parts.join('');
}

function finderSvg(x, y, moduleSize, darkColor, lightColor, style) {
  const outer = moduleSize * 7;
  const middle = moduleSize * 5;
  const core = moduleSize * 3;
  const rx = style === 'rounded' ? moduleSize * 1.6 : 0;

  return [
    `<rect x="${x}" y="${y}" width="${outer}" height="${outer}" rx="${rx}" ry="${rx}" fill="${darkColor}"/>`,
    `<rect x="${x + moduleSize}" y="${y + moduleSize}" width="${middle}" height="${middle}" rx="${rx * 0.8}" ry="${rx * 0.8}" fill="${lightColor}"/>`,
    `<rect x="${x + moduleSize * 2}" y="${y + moduleSize * 2}" width="${core}" height="${core}" rx="${rx * 0.6}" ry="${rx * 0.6}" fill="${darkColor}"/>`,
  ].join('');
}

function setQualityBadge(level) {
  qualityEl.textContent = level;
  qualityEl.className = `quality-badge ${level.toLowerCase()}`;
}

function setStatusLine(element, text, show) {
  element.textContent = text;
  element.hidden = !show;
}

function parseAndValidate() {
  const content = contentEl.value.trim();
  const sizeValue = Number(sizeValueEl.value);
  const marginValue = Number(marginValueEl.value);

  const sizePx = Math.round(pxFromUnit(sizeValue, sizeUnitEl.value));
  const marginPx = Math.round(pxFromUnit(marginValue, marginUnitEl.value));

  setStatusLine(contentErrorEl, '', false);
  setStatusLine(sizeErrorEl, '', false);
  setStatusLine(contrastWarningEl, '', false);
  setStatusLine(densityWarningEl, '', false);

  if (!content) {
    return { valid: false, reason: 'empty' };
  }

  if (mode === 'url' && !isHttpsUrl(content)) {
    setStatusLine(contentErrorEl, 'URL must include https://', true);
    return { valid: false, reason: 'invalid-url' };
  }

  if (!Number.isFinite(sizePx) || sizePx < MIN_SIZE_PX || sizePx > MAX_SIZE_PX) {
    setStatusLine(sizeErrorEl, `Size must be between ${MIN_SIZE_PX}px and ${MAX_SIZE_PX}px.`, true);
    return { valid: false, reason: 'invalid-size' };
  }

  if (!Number.isFinite(marginPx) || marginPx < 0 || marginPx > Math.floor(sizePx * 0.35)) {
    setStatusLine(sizeErrorEl, 'Margin must be non-negative and less than 35% of size.', true);
    return { valid: false, reason: 'invalid-margin' };
  }

  const foreground = fgEl.value;
  const background = bgEl.value;
  const transparent = transparentBgEl.checked;

  if (!transparent) {
    const ratio = contrastRatio(foreground, background);
    if (ratio < 3) {
      setStatusLine(contrastWarningEl, `Low contrast (${ratio.toFixed(2)}:1). Scanning reliability may be poor.`, true);
    } else if (ratio < 4.5) {
      setStatusLine(contrastWarningEl, `Moderate contrast (${ratio.toFixed(2)}:1). Consider stronger contrast.`, true);
    }
  }

  return {
    valid: true,
    content,
    sizePx,
    marginPx,
    dpi: Number(dpiEl.value),
    ecc: eccEl.value,
    foreground,
    background,
    transparent,
    dotStyle: dotStyleEl.value,
    cornerStyle: cornerStyleEl.value,
    filename: sanitizeFileName(filenameEl.value),
  };
}

function computeQuality(moduleSizePx, hasContrastWarning) {
  let quality = 'Good';

  if (moduleSizePx < 4.2) quality = 'Medium';
  if (moduleSizePx < 2.8) quality = 'Poor';
  if (hasContrastWarning && quality === 'Good') quality = 'Medium';
  if (hasContrastWarning && quality === 'Medium' && moduleSizePx < 4) quality = 'Poor';

  return quality;
}

function renderPreview() {
  const parsed = parseAndValidate();

  if (!parsed.valid) {
    previewEl.innerHTML = '<p class="muted">Enter valid content to generate QR code.</p>';
    setQualityBadge('Medium');
    lastValidPayload = null;
    pngBtn.disabled = true;
    svgBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  let qrData;
  try {
    qrData = typeof QRCode.create === 'function'
      ? QRCode.create(parsed.content, { errorCorrectionLevel: parsed.ecc })
      : null;
  } catch {
    qrData = null;
  }

  if (!qrData && typeof QRCode.toCanvas === 'function') {
    const previewSize = Math.min(parsed.sizePx, 420);
    const ratio = previewSize / parsed.sizePx;
    const previewMargin = Math.round(parsed.marginPx * ratio);
    const canvas = document.createElement('canvas');

    QRCode.toCanvas(
      canvas,
      parsed.content,
      {
        width: previewSize,
        margin: Math.max(0, previewMargin),
        errorCorrectionLevel: parsed.ecc,
        color: {
          dark: parsed.foreground,
          light: parsed.transparent ? '#0000' : parsed.background,
        },
      },
      (error) => {
        if (error) {
          previewEl.innerHTML = '<p class="muted">QR encoding failed for current content.</p>';
          setQualityBadge('Poor');
          lastValidPayload = null;
          pngBtn.disabled = true;
          svgBtn.disabled = true;
          copyBtn.disabled = true;
          return;
        }

        previewEl.innerHTML = '';
        previewEl.appendChild(canvas);
        setQualityBadge('Medium');
        lastValidPayload = { parsed, qrData: null, fallback: true };
        pngBtn.disabled = false;
        svgBtn.disabled = false;
        copyBtn.disabled = false;
      }
    );
    return;
  }

  if (!qrData) {
    previewEl.innerHTML = '<p class="muted">QR library could not render preview.</p>';
    setQualityBadge('Poor');
    lastValidPayload = null;
    pngBtn.disabled = true;
    svgBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  const previewSize = Math.min(parsed.sizePx, 420);
  const ratio = previewSize / parsed.sizePx;
  const previewMargin = Math.round(parsed.marginPx * ratio);

  const canvas = document.createElement('canvas');
  const drawResult = drawQrToCanvas(canvas, qrData, {
    pixelSize: previewSize,
    marginPx: previewMargin,
    darkColor: parsed.foreground,
    lightColor: parsed.background,
    transparent: parsed.transparent,
    dotStyle: parsed.dotStyle,
    cornerStyle: parsed.cornerStyle,
  });

  previewEl.innerHTML = '';
  previewEl.appendChild(canvas);

  const modulePxAtOutput = (parsed.sizePx - parsed.marginPx * 2) / qrData.modules.size;
  if (modulePxAtOutput < 2.5) {
    setStatusLine(densityWarningEl, 'QR is dense for selected size/content. Increase size or use shorter content.', true);
  }

  const hasContrastWarning = !contrastWarningEl.hidden;
  const quality = computeQuality(drawResult.moduleSize, hasContrastWarning);
  setQualityBadge(quality);

  lastValidPayload = { parsed, qrData, fallback: false };
  pngBtn.disabled = false;
  svgBtn.disabled = false;
  copyBtn.disabled = false;
}

function exportPixelSize(parsed) {
  return Math.max(1, Math.round(parsed.sizePx * (parsed.dpi / PX_PER_INCH)));
}

function exportMargin(parsed) {
  return Math.max(0, Math.round(parsed.marginPx * (parsed.dpi / PX_PER_INCH)));
}

function downloadPng() {
  if (!lastValidPayload) return;

  const { parsed, qrData, fallback } = lastValidPayload;

  if (fallback || !qrData) {
    QRCode.toCanvas(
      parsed.content,
      {
        width: exportPixelSize(parsed),
        margin: exportMargin(parsed),
        errorCorrectionLevel: parsed.ecc,
        color: {
          dark: parsed.foreground,
          light: parsed.transparent ? '#0000' : parsed.background,
        },
      },
      (error, canvas) => {
        if (error || !canvas) return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${parsed.filename}.png`;
        link.click();
      }
    );
    return;
  }

  const canvas = document.createElement('canvas');

  drawQrToCanvas(canvas, qrData, {
    pixelSize: exportPixelSize(parsed),
    marginPx: exportMargin(parsed),
    darkColor: parsed.foreground,
    lightColor: parsed.background,
    transparent: parsed.transparent,
    dotStyle: parsed.dotStyle,
    cornerStyle: parsed.cornerStyle,
  });

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${parsed.filename}.png`;
  link.click();
}

function downloadSvg() {
  if (!lastValidPayload) return;

  const { parsed, qrData, fallback } = lastValidPayload;

  if (fallback || !qrData) {
    QRCode.toString(
      parsed.content,
      {
        type: 'svg',
        width: exportPixelSize(parsed),
        margin: exportMargin(parsed),
        errorCorrectionLevel: parsed.ecc,
        color: {
          dark: parsed.foreground,
          light: parsed.transparent ? '#0000' : parsed.background,
        },
      },
      (error, svg) => {
        if (error || !svg) return;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${parsed.filename}.svg`;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    );
    return;
  }

  const svgString = buildSvg(qrData, {
    pixelSize: exportPixelSize(parsed),
    marginPx: exportMargin(parsed),
    darkColor: parsed.foreground,
    lightColor: parsed.background,
    transparent: parsed.transparent,
    dotStyle: parsed.dotStyle,
    cornerStyle: parsed.cornerStyle,
  });

  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${parsed.filename}.svg`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyQr() {
  if (!lastValidPayload || !navigator.clipboard || typeof ClipboardItem === 'undefined') return;

  const { parsed, qrData, fallback } = lastValidPayload;

  if (fallback || !qrData) {
    QRCode.toCanvas(
      parsed.content,
      {
        width: exportPixelSize(parsed),
        margin: exportMargin(parsed),
        errorCorrectionLevel: parsed.ecc,
        color: {
          dark: parsed.foreground,
          light: parsed.transparent ? '#0000' : parsed.background,
        },
      },
      async (error, canvas) => {
        if (error || !canvas) return;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copyBtn.textContent = 'Copied';
        } catch {
          copyBtn.textContent = 'Copy failed';
        }
        setTimeout(() => {
          copyBtn.textContent = 'Copy QR';
        }, 900);
      }
    );
    return;
  }

  const canvas = document.createElement('canvas');

  drawQrToCanvas(canvas, qrData, {
    pixelSize: exportPixelSize(parsed),
    marginPx: exportMargin(parsed),
    darkColor: parsed.foreground,
    lightColor: parsed.background,
    transparent: parsed.transparent,
    dotStyle: parsed.dotStyle,
    cornerStyle: parsed.cornerStyle,
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    copyBtn.textContent = 'Copied';
    setTimeout(() => {
      copyBtn.textContent = 'Copy QR';
    }, 900);
  } catch {
    copyBtn.textContent = 'Copy failed';
    setTimeout(() => {
      copyBtn.textContent = 'Copy QR';
    }, 900);
  }
}

function switchMode(nextMode) {
  mode = nextMode;

  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (mode === 'url') {
    contentLabel.textContent = 'URL (must start with https://)';
    contentEl.placeholder = 'https://example.com';
  } else {
    contentLabel.textContent = 'Text (multi-line supported)';
    contentEl.placeholder = 'Enter text...';
  }

  scheduleRender();
}

const scheduleRender = debounce(renderPreview, 120);

modeButtons.forEach((button) => {
  button.addEventListener('click', () => switchMode(button.dataset.mode));
});

[
  contentEl,
  sizeValueEl,
  sizeUnitEl,
  marginValueEl,
  marginUnitEl,
  dpiEl,
  eccEl,
  fgEl,
  bgEl,
  transparentBgEl,
  dotStyleEl,
  cornerStyleEl,
  filenameEl,
].forEach((el) => {
  el.addEventListener('input', scheduleRender);
  el.addEventListener('change', scheduleRender);
});

pngBtn.addEventListener('click', downloadPng);
svgBtn.addEventListener('click', downloadSvg);
copyBtn.addEventListener('click', copyQr);

switchMode('url');
renderPreview();
