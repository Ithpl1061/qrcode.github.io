/**
 * Cloudflare Worker - secure upload proxy for Backblaze B2
 *
 * Routes:
 * - GET /health
 * - POST /upload
 * - DELETE /delete
 */

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'zip', 'mp4']);
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;
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

  const publicUrl = `${auth.downloadUrl}/file/${auth.bucketName}/${key}`;

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

  let allowOrigin;
  if (allowed === '*') {
    // Open — allow any origin (fine for public APIs and local development).
    allowOrigin = '*';
  } else {
    // Strict list — only echo back the origin if it is explicitly listed.
    // Fallback to the FIRST entry is intentionally removed: returning a
    // mismatched origin causes browsers to block the request anyway, but it
    // leaks the existence of other allowed origins in the response header.
    const allowList = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    allowOrigin = allowList.includes(origin) ? origin : null;
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
