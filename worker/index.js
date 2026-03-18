/**
 * Cloudflare Worker - secure upload proxy for Backblaze B2
 *
 * Routes:
 * - GET /health
 * - POST /upload
 * - POST /generate-label
 * - GET /labels
 * - GET /labels/:id
 * - DELETE /delete
 */

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'zip', 'mp4']);
const LABEL_ASSET_EXTENSIONS = new Set(['svg', 'png', 'pdf']);
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_LABEL_MAX_FILE_SIZE = 12 * 1024 * 1024;
// Temporary rollback while the Cloudflare custom domain is unavailable.
const BASE_URL = 'https://gtbl.net';
// const BASE_URL = 'https://qr-file-platform-worker.ithplqrbackend.workers.dev';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const rateMap = new Map();

class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, at: new Date().toISOString() }, 200, corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/upload') {
        return await handleUpload(request, env, corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/generate-label') {
        return await handleGenerateLabel(request, env, corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/download') {
        return await handleDownload(request, env, corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/labels') {
        return await handleListLabels(request, env, corsHeaders);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/labels/')) {
        return await handleGetLabel(request, env, corsHeaders);
      }

      if (request.method === 'DELETE' && url.pathname === '/delete') {
        return await handleDelete(request, env, corsHeaders);
      }

      return json({ success: false, error: 'Not found' }, 404, corsHeaders);
    } catch (error) {
      console.error('Worker error', error);
      if (error instanceof AppError) {
        return json(
          {
            success: false,
            error: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
          error.status,
          corsHeaders
        );
      }

      return json({ success: false, error: 'Internal server error' }, 500, corsHeaders);
    }
  },
};

async function handleUpload(request, env, corsHeaders) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!consumeRate(ip)) {
    return json({ success: false, error: 'Too many requests. Please try again later.' }, 429, corsHeaders);
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');

  if (!(file instanceof File)) {
    return json({ success: false, error: 'Missing file in multipart field "file".' }, 400, corsHeaders);
  }

  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return json({ success: false, error: 'Invalid file type. Allowed: pdf, jpg, png, doc, docx, zip, mp4.' }, 400, corsHeaders);
  }

  const maxBytes = Number(env.MAX_FILE_SIZE_BYTES || DEFAULT_MAX_FILE_SIZE);
  if (file.size <= 0 || file.size > maxBytes) {
    return json({ success: false, error: `File size must be between 1 byte and ${maxBytes} bytes.` }, 413, corsHeaders);
  }

  const buffer = await file.arrayBuffer();
  const safeName = sanitizeFilename(file.name);
  const key = `uploads/${Date.now()}_${safeName}`;

  const auth = await b2Authorize(env);
  const uploadUrlData = await b2GetUploadUrl(auth.apiUrl, auth.authorizationToken, auth.bucketId);
  const uploaded = await b2UploadFile(uploadUrlData, key, buffer, file.type || 'application/octet-stream', safeName);

  // Always return the canonical custom-domain URL, even if the request reached
  // this worker through its temporary workers.dev hostname during migration.
  const publicUrl = buildPublicDownloadUrl(key);

  return json(
    {
      success: true,
      file: {
        url: publicUrl,
        key,
        fileId: uploaded.fileId,
        name: file.name,
        safeName,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
      },
    },
    200,
    corsHeaders
  );
}

async function handleDownload(request, env, corsHeaders) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return json({ success: false, error: 'Missing "key" query parameter.' }, 400, corsHeaders);
  }

  // Prevent path traversal
  if (key.includes('..') || key.includes('\0') || key.startsWith('/')) {
    return json({ success: false, error: 'Invalid key.' }, 400, corsHeaders);
  }

  const auth = await b2Authorize(env);

  const b2Response = await fetch(`${auth.downloadUrl}/file/${auth.bucketName}/${key}`, {
    headers: { Authorization: auth.authorizationToken },
  });

  if (!b2Response.ok) {
    return json(
      { success: false, error: 'File not found or access denied.' },
      b2Response.status,
      corsHeaders
    );
  }

  const responseHeaders = new Headers(corsHeaders);
  const forwardHeaders = ['Content-Type', 'Content-Length', 'Content-Disposition', 'Last-Modified', 'ETag'];
  for (const h of forwardHeaders) {
    const val = b2Response.headers.get(h);
    if (val) responseHeaders.set(h, val);
  }

  return new Response(b2Response.body, { status: 200, headers: responseHeaders });
}

async function handleGenerateLabel(request, env, corsHeaders) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!consumeRate(`${ip}:label`)) {
    return json({ success: false, error: 'Too many label generation requests. Please try again later.' }, 429, corsHeaders);
  }

  const formData = await request.formData().catch(() => null);
  const payloadRaw = formData?.get('payload');
  const labelSvg = formData?.get('labelSvg');
  const labelPng = formData?.get('labelPng');
  const labelPdf = formData?.get('labelPdf');

  if (typeof payloadRaw !== 'string') {
    return json({ success: false, error: 'Missing JSON payload.' }, 400, corsHeaders);
  }

  if (!(labelSvg instanceof File) || !(labelPng instanceof File)) {
    return json({ success: false, error: 'labelSvg and labelPng are required.' }, 400, corsHeaders);
  }

  const payload = safeParseJson(payloadRaw);
  payload.labelNumber = normalizeLabelNumber(payload.labelNumber);
  validateLabelPayload(payload);

  const maxBytes = Number(env.MAX_LABEL_FILE_SIZE_BYTES || DEFAULT_LABEL_MAX_FILE_SIZE);
  validateLabelFile(labelSvg, maxBytes, 'svg');
  validateLabelFile(labelPng, maxBytes, 'png');
  if (labelPdf instanceof File) {
    validateLabelFile(labelPdf, maxBytes, 'pdf');
  }

  const auth = await b2Authorize(env);
  const uploadUrlData = await b2GetUploadUrl(auth.apiUrl, auth.authorizationToken, auth.bucketId);

  const baseSlug = [
    sanitizeFilename(payload.productCode || 'label'),
    sanitizeFilename(payload.batchNumber || 'batch'),
    Date.now(),
  ].join('_');

  const svgKey = `labels/${baseSlug}.svg`;
  const pngKey = `labels/${baseSlug}.png`;
  const pdfKey = labelPdf instanceof File ? `labels/${baseSlug}.pdf` : null;
  const manifestKey = `labels/${baseSlug}.json`;

  const svgMeta = await b2UploadFile(
    uploadUrlData,
    svgKey,
    await labelSvg.arrayBuffer(),
    'image/svg+xml',
    `${baseSlug}.svg`
  );
  const pngMeta = await b2UploadFile(
    uploadUrlData,
    pngKey,
    await labelPng.arrayBuffer(),
    'image/png',
    `${baseSlug}.png`
  );

  let pdfMeta = null;
  if (pdfKey && labelPdf instanceof File) {
    pdfMeta = await b2UploadFile(
      uploadUrlData,
      pdfKey,
      await labelPdf.arrayBuffer(),
      'application/pdf',
      `${baseSlug}.pdf`
    );
  }

  const manifest = {
    ...payload,
    sourceFileUrl: payload.sourceFile?.url || payload.fileUrl || '',
    generatedAt: new Date().toISOString(),
    assets: {
      svg: { key: svgKey, fileId: svgMeta.fileId, url: buildPublicDownloadUrl(svgKey) },
      png: { key: pngKey, fileId: pngMeta.fileId, url: buildPublicDownloadUrl(pngKey) },
      pdf: pdfMeta && pdfKey
        ? { key: pdfKey, fileId: pdfMeta.fileId, url: buildPublicDownloadUrl(pdfKey) }
        : null,
    },
  };

  await b2UploadFile(
    uploadUrlData,
    manifestKey,
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)).buffer,
    'application/json',
    `${baseSlug}.json`
  );

  const record = await insertLabelRecord(env, {
    labelNumber: payload.labelNumber,
    productName: payload.productName,
    batchNumber: payload.batchNumber,
    fileUrl: payload.sourceFile?.url || payload.fileUrl || '',
    labelImageUrl: buildPublicDownloadUrl(pngKey),
    labelSvgUrl: buildPublicDownloadUrl(svgKey),
    labelPdfUrl: pdfKey ? buildPublicDownloadUrl(pdfKey) : null,
    manifestUrl: buildPublicDownloadUrl(manifestKey),
  });

  return json(
    {
      success: true,
      labelUrl: buildPublicDownloadUrl(pngKey),
      labelSvgUrl: buildPublicDownloadUrl(svgKey),
      labelPdfUrl: pdfKey ? buildPublicDownloadUrl(pdfKey) : null,
      manifestUrl: buildPublicDownloadUrl(manifestKey),
      fileUrl: payload.sourceFile?.url || payload.fileUrl || '',
      labelNumber: payload.labelNumber,
      record,
    },
    200,
    corsHeaders
  );
}

async function handleListLabels(request, env, corsHeaders) {
  const db = getLabelsDb(env);
  const url = new URL(request.url);
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);

  let sql = `
    SELECT id, label_number, product_name, batch_number, file_url, label_image_url, label_svg_url, label_pdf_url, manifest_url, created_at
    FROM labels
  `;
  const binds = [];

  if (search) {
    sql += `
      WHERE lower(label_number) LIKE ?1
         OR lower(batch_number) LIKE ?1
         OR lower(product_name) LIKE ?1
    `;
    binds.push(`%${search}%`);
  }

  sql += ' ORDER BY datetime(created_at) DESC LIMIT ?' + (binds.length + 1);
  binds.push(limit);

  const { results } = await db.prepare(sql).bind(...binds).all();
  return json(
    {
      success: true,
      labels: (results || []).map(mapLabelRow),
    },
    200,
    corsHeaders
  );
}

async function handleGetLabel(request, env, corsHeaders) {
  const db = getLabelsDb(env);
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.slice('/labels/'.length));

  if (!id) {
    return json({ success: false, error: 'Missing label id.' }, 400, corsHeaders);
  }

  const row = await db
    .prepare(`
      SELECT id, label_number, product_name, batch_number, file_url, label_image_url, label_svg_url, label_pdf_url, manifest_url, created_at
      FROM labels
      WHERE id = ?1
    `)
    .bind(id)
    .first();

  if (!row) {
    return json({ success: false, error: 'Label not found.' }, 404, corsHeaders);
  }

  return json({ success: true, label: mapLabelRow(row) }, 200, corsHeaders);
}

function buildPublicDownloadUrl(key) {
  return `${BASE_URL}/download?key=${encodeURIComponent(key)}`;
}

async function insertLabelRecord(env, input) {
  const db = getLabelsDb(env);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO labels (
        id,
        label_number,
        product_name,
        batch_number,
        file_url,
        label_image_url,
        label_svg_url,
        label_pdf_url,
        manifest_url,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `)
    .bind(
      id,
      input.labelNumber,
      input.productName,
      input.batchNumber,
      input.fileUrl,
      input.labelImageUrl,
      input.labelSvgUrl,
      input.labelPdfUrl,
      input.manifestUrl,
      createdAt
    )
    .run();

  return {
    id,
    labelNumber: input.labelNumber,
    productName: input.productName,
    batchNumber: input.batchNumber,
    fileUrl: input.fileUrl,
    labelImageUrl: input.labelImageUrl,
    labelSvgUrl: input.labelSvgUrl,
    labelPdfUrl: input.labelPdfUrl,
    manifestUrl: input.manifestUrl,
    createdAt,
  };
}

async function handleDelete(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  const fileId = body?.fileId;
  const fileName = body?.fileName;

  if (!fileId || !fileName) {
    return json({ success: false, error: 'fileId and fileName are required.' }, 400, corsHeaders);
  }

  const auth = await b2Authorize(env);

  const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId, fileName }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return json({ success: false, error: errorData.message || 'Backblaze delete failed.' }, response.status, corsHeaders);
  }

  return json({ success: true }, 200, corsHeaders);
}

function buildCorsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGINS || '*';
  const origin = request.headers.get('Origin');
  const isLocalDevOrigin = isLoopbackOrigin(origin);

  let allowOrigin;
  if (allowed === '*') {
    // Open — allow any origin (fine for public APIs and local development).
    allowOrigin = '*';
  } else if (isLocalDevOrigin) {
    // Always allow loopback origins so local static development works
    // against the deployed worker without editing production allowlists.
    allowOrigin = origin.replace(/\/+$/, '');
  } else {
    // Strict list — only echo back the origin if it is explicitly listed.
    // Fallback to the FIRST entry is intentionally removed: returning a
    // mismatched origin causes browsers to block the request anyway, but it
    // leaks the existence of other allowed origins in the response header.
    const allowList = allowed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        try {
          return new URL(entry).origin;
        } catch {
          return entry.replace(/\/+$/, '');
        }
      });

    const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : '';
    allowOrigin = allowList.includes(normalizedOrigin) ? normalizedOrigin : null;
  }

  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  // Only add the header when the origin is actually permitted;
  // omitting it is the correct way to signal "CORS not allowed".
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }

  return headers;
}

function isLoopbackOrigin(origin) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getExtension(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function sanitizeFilename(name) {
  const base = (name || 'file').split(/[\\/]/).pop();
  return base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.\-]+/, '')
    .slice(0, 120) || 'upload';
}

function validateLabelFile(file, maxBytes, expectedExtension) {
  const extension = getExtension(file.name);
  if (!LABEL_ASSET_EXTENSIONS.has(extension) || extension !== expectedExtension) {
    throw new AppError(`Invalid label asset for ${expectedExtension}.`, 400);
  }

  if (file.size <= 0 || file.size > maxBytes) {
    throw new AppError(`Label asset ${file.name} exceeds the allowed size limit.`, 413);
  }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError('Payload must be valid JSON.', 400);
  }
}

function validateLabelPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Payload must be an object.', 400);
  }

  const required = [
    'labelNumber',
    'productName',
    'productCode',
    'batchNumber',
    'manufacturingMonth',
    'retestMonth',
    'containerNumber',
    'grossWeight',
    'tareWeight',
    'netWeight',
    'manufacturerName',
    'manufacturerAddress',
    'drugLicenseNumber',
    'fileUrl',
  ];

  const missing = required.filter((key) => !String(payload[key] || '').trim());
  if (missing.length) {
    throw new AppError('Missing required label fields.', 400, { missing });
  }

  if (payload.width !== undefined || payload.height !== undefined || payload.unit !== undefined) {
    const width = Number(payload.width);
    const height = Number(payload.height);
    const unit = String(payload.unit || '').trim();

    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new AppError('Label size width and height must be positive numbers.', 400);
    }

    if (!['px', 'in', 'cm'].includes(unit)) {
      throw new AppError('Label size unit must be px, in, or cm.', 400);
    }
  }
}

function getLabelsDb(env) {
  if (!env.LABELS_DB) {
    throw new AppError('Missing D1 binding for label history.', 500, {
      missing: ['LABELS_DB'],
    });
  }

  return env.LABELS_DB;
}

function normalizeLabelNumber(value) {
  const raw = String(value || '').trim();
  if (raw) return raw;

  const stamp = new Date().toISOString().replace(/\D/g, '');
  return stamp.slice(-6);
}

function mapLabelRow(row) {
  return {
    id: row.id,
    labelNumber: row.label_number,
    productName: row.product_name,
    batchNumber: row.batch_number,
    fileUrl: row.file_url,
    labelImageUrl: row.label_image_url,
    labelSvgUrl: row.label_svg_url,
    labelPdfUrl: row.label_pdf_url,
    manifestUrl: row.manifest_url,
    createdAt: row.created_at,
  };
}

function clampInt(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function consumeRate(ip) {
  const now = Date.now();
  const row = rateMap.get(ip);

  if (!row || now > row.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (row.count >= RATE_LIMIT_MAX_REQUESTS) return false;

  row.count += 1;
  return true;
}

async function b2Authorize(env) {
  const cfg = getB2Config(env);

  const basic = btoa(`${cfg.keyId}:${cfg.appKey}`);
  const response = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!response.ok) {
    const msg = await response.text();
    throw new AppError('Backblaze authorization failed.', 502, {
      stage: 'b2_authorize_account',
      raw: msg,
    });
  }

  const auth = await response.json();
  return {
    ...auth,
    bucketId: cfg.bucketId,
    bucketName: cfg.bucketName,
  };
}

async function b2GetUploadUrl(apiUrl, token, bucketId) {
  const response = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bucketId }),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const message = String(errorJson?.message || '');
    const code = String(errorJson?.code || '');

    if (response.status === 400 && code === 'bad_request' && /bucketid invalid/i.test(message)) {
      throw new AppError('Invalid bucket ID', 400, {
        stage: 'b2_get_upload_url',
        hint: 'Use Backblaze bucketId (not bucket name) in B2_BUCKET_ID.',
      });
    }

    throw new AppError('Backblaze get-upload-url failed.', 502, {
      stage: 'b2_get_upload_url',
      status: response.status,
      b2: errorJson || message,
    });
  }

  return response.json();
}

async function b2UploadFile(uploadData, key, arrayBuffer, contentType, displayName) {
  const sha1 = await sha1Hex(arrayBuffer);
  const contentDisposition = encodeURIComponent(`inline; filename*=UTF-8''${displayName}`);

  const response = await fetch(uploadData.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadData.authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(key),
      'X-Bz-Content-Sha1': sha1,
      'X-Bz-Info-b2-content-disposition': contentDisposition,
      'Content-Type': contentType,
      'Content-Length': String(arrayBuffer.byteLength),
    },
    body: arrayBuffer,
  });

  if (!response.ok) {
    const msg = await response.text();
    throw new AppError('Backblaze upload failed.', 502, {
      stage: 'b2_upload_file',
      raw: msg,
    });
  }

  return response.json();
}

async function sha1Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getB2Config(env) {
  const keyId = (env.B2_KEY_ID || '').trim();
  const appKey = (env.B2_APP_KEY || '').trim();
  const bucketId = (env.B2_BUCKET_ID || '').trim();
  const bucketName = (env.B2_BUCKET_NAME || '').trim();

  const missing = [];
  if (!keyId) missing.push('B2_KEY_ID');
  if (!appKey) missing.push('B2_APP_KEY');
  if (!bucketId) missing.push('B2_BUCKET_ID');
  if (!bucketName) missing.push('B2_BUCKET_NAME');

  if (missing.length) {
    throw new AppError('Missing required Backblaze environment variables.', 500, {
      missing,
    });
  }

  if (isPlaceholder(bucketId)) {
    throw new AppError('Invalid bucket ID', 400, {
      stage: 'env_validation',
      hint: 'B2_BUCKET_ID is a placeholder. Set the real bucketId from Backblaze console.',
    });
  }

  return { keyId, appKey, bucketId, bucketName };
}

function isPlaceholder(value) {
  const v = value.toLowerCase();
  return (
    v.includes('your_b2_bucket_id') ||
    v.includes('your bucket id') ||
    v.includes('replace') ||
    v === 'your_b2_bucket_id'
  );
}
