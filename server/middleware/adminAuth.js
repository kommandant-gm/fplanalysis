const crypto = require('crypto');

const TOKEN_PREFIX = 'v1';

function getAdminConfig() {
  const ttlRaw = Number.parseInt(process.env.ADMIN_TOKEN_TTL_SECONDS, 10);
  const tokenTtlSeconds = Number.isFinite(ttlRaw) ? Math.max(300, Math.min(ttlRaw, 7 * 24 * 3600)) : 12 * 3600;

  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    secret: process.env.ADMIN_SECRET || '',
    tokenTtlSeconds,
  };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signPart(part, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(part)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function issueAdminToken(username, config = getAdminConfig()) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: username,
    role: 'admin',
    iat: now,
    exp: now + config.tokenTtlSeconds,
  };

  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signature = signPart(payloadPart, config.secret);
  return `${TOKEN_PREFIX}.${payloadPart}.${signature}`;
}

function verifyAdminToken(token, config = getAdminConfig()) {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'Missing token.' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, error: 'Malformed token.' };

  const payloadPart = parts[1];
  const signature = parts[2];
  const expected = signPart(payloadPart, config.secret);
  if (!safeEqual(signature, expected)) return { ok: false, error: 'Invalid token signature.' };

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadPart));
  } catch {
    return { ok: false, error: 'Invalid token payload.' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp < now) return { ok: false, error: 'Token expired.' };
  if (payload?.role !== 'admin') return { ok: false, error: 'Invalid token role.' };

  return { ok: true, payload };
}

function readBearerToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function ensureAdminConfigOrFail(res) {
  const config = getAdminConfig();
  if (!config.password || !config.secret) {
    res.status(500).json({
      success: false,
      error: 'Admin auth not configured. Set ADMIN_PASSWORD and ADMIN_SECRET.',
    });
    return null;
  }
  return config;
}

function requireAdmin(req, res, next) {
  const config = ensureAdminConfigOrFail(res);
  if (!config) return;

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing bearer token.' });
  }

  const verified = verifyAdminToken(token, config);
  if (!verified.ok) {
    return res.status(401).json({ success: false, error: verified.error });
  }

  req.admin = verified.payload;
  return next();
}

module.exports = {
  getAdminConfig,
  issueAdminToken,
  verifyAdminToken,
  safeEqual,
  requireAdmin,
};
