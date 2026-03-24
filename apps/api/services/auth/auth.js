// apps/api/services/auth/auth.js
// JWT Auth Service (RS256) + RBAC Middleware
// Fixed: JWT expiry, payload fields, OTP invalidation, rate limiting,
//        refresh token cookie, role names, 2FA JWT, upsert logic

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const { Pool } = require('pg');
const redis = require('redis');

const router = express.Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Constants ────────────────────────────────────────────────────────────────

const fs = require('fs');

function readKeyFile(paths) {
  for (const path of paths) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (e) {}
  }
  return null;
}

const jwtKeyPair = (() => {
  const privateKey = process.env.JWT_PRIVATE_KEY
    || readKeyFile(['./keys/private.pem', '/app/keys/private.pem']);
  const publicKey = process.env.JWT_PUBLIC_KEY
    || readKeyFile(['./keys/public.pem', '/app/keys/public.pem']);

  if (privateKey && publicKey) {
    return { privateKey, publicKey };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.warn('JWT keys not found; generating an ephemeral development key pair.');
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  }

  throw new Error('JWT keys not found. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY.');
})();

const JWT_PRIVATE_KEY = jwtKeyPair.privateKey;
const JWT_PUBLIC_KEY = jwtKeyPair.publicKey;
const JWT_ALGORITHM   = 'RS256';

const ACCESS_EXPIRY = {
  citizen:     3600,   // 1 hour
  officer:     3600,
  dept_head:   3600,
  commissioner: 3600,
};

const REFRESH_EXPIRY = {
  citizen:      604800, // 7 days
  officer:      28800,  // 8 hours
  dept_head:    28800,
  commissioner: 14400,  // 4 hours
};

const OTP_TTL        = 600;  // 10 minutes
const OTP_MAX_TRIES  = 5;    // wrong attempts before lockout
const OTP_RATE_LIMIT = 3;    // requests per phone per 15 min
const OTP_RATE_WINDOW = 900; // 15 minutes in seconds
const SALT_ROUNDS    = 12;
const IS_DEMO        = process.env.DEMO_MODE === 'true';
const OTP_HARDCODE   = process.env.NODE_ENV !== 'production' ? '123456' : null;

// ── Redis ────────────────────────────────────────────────────────────────────

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateAccessToken(user) {
  const payload = {
    sub:     user.id,
    role:    user.role,
    dept_id: user.dept_id  || null,
    ward_id: user.ward_id  || null,
    city_id: user.city_id  || 'DEMO',
    source:  user.source   || 'production',
    jti:     crypto.randomUUID(),
  };
  return jwt.sign(payload, JWT_PRIVATE_KEY, {
    algorithm: JWT_ALGORITHM,
    expiresIn: ACCESS_EXPIRY[user.role] || 3600,
  });
}

async function generateRefreshToken(userId, role) {
  const token = crypto.randomUUID();
  const hash  = await bcrypt.hash(token, 10);
  const ttl   = REFRESH_EXPIRY[role] || 604800;
  await redisClient.setEx(`refresh:${userId}`, ttl, hash);
  return { token, ttl };
}

function setRefreshCookie(res, token, ttl) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge:   ttl * 1000,
  });
}

async function upsertCitizen({ phone, email, name, source }) {
  const { rows } = await db.query(
    `INSERT INTO users (phone, email, name, role, source, city_id)
     VALUES ($1, $2, $3, 'citizen', $4, 'DEMO')
     ON CONFLICT (phone) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, users.name)
     RETURNING *`,
    [phone || null, email || null, name || null, source || 'production']
  );
  return rows[0];
}

// ── RBAC Middleware ───────────────────────────────────────────────────────────

function requireRole(...roles) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Missing token' });

    try {
      const decoded = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: [JWT_ALGORITHM],
      });

      if (!roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.user = decoded;

      // Attach scoped data filter for controllers to use
      if (decoded.role === 'citizen') {
        req.filter = { citizen_id: decoded.sub };
      } else if (decoded.role === 'officer') {
        req.filter = { assigned_to: decoded.sub, dept_id: decoded.dept_id };
      } else if (decoded.role === 'dept_head') {
        req.filter = { dept_id: decoded.dept_id };
      }
      // commissioner: no filter — sees all

      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// ── POST /auth/otp/request ────────────────────────────────────────────────────

router.post('/otp/request', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    // Rate limit: max OTP_RATE_LIMIT requests per phone per 15 min
    const rateLimitKey = `otp:ratelimit:${phone}`;
    const attempts = await redisClient.incr(rateLimitKey);
    if (attempts === 1) await redisClient.expire(rateLimitKey, OTP_RATE_WINDOW);
    if (attempts > OTP_RATE_LIMIT) {
      return res.status(429).json({ error: 'Too many OTP requests. Try again in 15 minutes.' });
    }

    // Generate OTP (hardcoded in non-production)
    const otp = OTP_HARDCODE || String(Math.floor(100000 + Math.random() * 900000));

    // Store bcrypt hash only — plaintext never persisted
    const hash = await bcrypt.hash(otp, SALT_ROUNDS);
    await redisClient.setEx(`otp:${phone}`, OTP_TTL, hash);

    // In production: dispatch via Twilio/MSG91 here
    if (process.env.NODE_ENV === 'production') {
      // await sendOTP(phone, otp);
    }

    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    console.error('OTP request error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/otp/verify ─────────────────────────────────────────────────────

router.post('/otp/verify', async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

    // Check attempt lockout
    const attemptsKey = `otp:attempts:${phone}`;
    const attemptCount = parseInt(await redisClient.get(attemptsKey) || '0');
    if (attemptCount >= OTP_MAX_TRIES) {
      return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
    }

    // Fetch stored hash
    const hash = await redisClient.get(`otp:${phone}`);
    if (!hash) return res.status(400).json({ error: 'OTP expired or not requested' });

    // Verify
    const valid = await bcrypt.compare(String(otp), hash);
    if (!valid) {
      await redisClient.multi()
        .incr(attemptsKey)
        .expire(attemptsKey, OTP_RATE_WINDOW)
        .exec();
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Single-use: invalidate immediately on success
    await redisClient.del(`otp:${phone}`);
    await redisClient.del(attemptsKey);

    // Upsert citizen (auto-create on first login)
    const user = await upsertCitizen({ phone, name });

    // Issue tokens
    const accessToken = generateAccessToken(user);
    const { token: refreshToken, ttl } = await generateRefreshToken(user.id, user.role);
    setRefreshCookie(res, refreshToken, ttl);

    res.json({ token: accessToken, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    console.error('OTP verify error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/login (staff: employee_id + password) ─────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { employee_id, password } = req.body;
    if (!employee_id || !password) {
      return res.status(400).json({ error: 'Employee ID and password are required' });
    }

    // Lookup user — generic error to prevent enumeration
    const { rows } = await db.query(
      'SELECT * FROM users WHERE employee_id = $1 AND is_active = true',
      [employee_id]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    // Check failed login lockout
    const lockKey = `login:lock:${user.id}`;
    const locked  = await redisClient.get(lockKey);
    if (locked) {
      return res.status(429).json({ error: 'Account locked. Contact IT helpdesk.' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const failKey   = `login:fail:${user.id}`;
      const failCount = await redisClient.incr(failKey);
      await redisClient.expire(failKey, OTP_RATE_WINDOW);
      if (failCount >= 3) {
        await redisClient.setEx(lockKey, OTP_RATE_WINDOW, '1');
        return res.status(429).json({ error: 'Account locked for 15 minutes' });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Clear fail counter on success
    await redisClient.del(`login:fail:${user.id}`);

    // Store partial session — awaiting 2FA
    const partialKey = `partial:${user.id}`;
    await redisClient.setEx(partialKey, 300, JSON.stringify({ id: user.id, role: user.role }));

    res.json({ partial_session: true, user_id: user.id });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/login/2fa ──────────────────────────────────────────────────────

router.post('/login/2fa', async (req, res) => {
  try {
    const { user_id, totp } = req.body;
    if (!user_id || !totp) {
      return res.status(400).json({ error: 'user_id and TOTP code are required' });
    }

    // Verify partial session exists
    const partialKey  = `partial:${user_id}`;
    const partialData = await redisClient.get(partialKey);
    if (!partialData) {
      return res.status(401).json({ error: 'No active login session. Start from /auth/login.' });
    }

    // Fetch user and TOTP secret
    const { rows } = await db.query(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [user_id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];

    // Verify TOTP
    const totpValid = speakeasy.totp.verify({
      secret:   user.totp_secret,
      encoding: 'base32',
      token:    String(totp),
      window:   1, // allow 30s clock drift
    });

    if (!totpValid) {
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    // Clear partial session
    await redisClient.del(partialKey);

    // Issue full JWT with all required payload fields
    const accessToken = generateAccessToken(user);
    const { token: refreshToken, ttl } = await generateRefreshToken(user.id, user.role);
    setRefreshCookie(res, refreshToken, ttl);

    res.json({ token: accessToken, user: { id: user.id, role: user.role, dept_id: user.dept_id } });
  } catch (err) {
    console.error('2FA error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/demo/login ─────────────────────────────────────────────────────

router.post('/demo/login', async (req, res) => {
  if (!IS_DEMO) return res.status(404).json({ error: 'Not found' });

  try {
    // Upsert the demo citizen account — no real PII
    const { rows } = await db.query(
      `INSERT INTO users (email, name, role, source, ward_id, city_id)
       VALUES ('demo@resolvex.in', 'Demo Citizen', 'citizen', 'demo_sandbox', 'DEMO_WARD', 'DEMO')
       ON CONFLICT (email) DO UPDATE SET source = 'demo_sandbox'
       RETURNING *`
    );
    const user = rows[0];

    // Sandbox JWT — cannot access real complaints or admin endpoints
    const accessToken = generateAccessToken({
      ...user,
      source:  'demo_sandbox',
      ward_id: 'DEMO_WARD',
    });

    // No refresh token for demo — session is intentionally ephemeral
    res.json({ token: accessToken });
  } catch (err) {
    console.error('Demo login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    const incoming = req.cookies?.refresh_token;
    if (!incoming) return res.status(401).json({ error: 'No refresh token' });

    // Decode the expired access token to get user_id
    // (we accept expired tokens here — we're only using sub for the Redis lookup)
    const authHeader = req.headers['authorization'];
    const oldToken   = authHeader?.split(' ')[1];
    let userId;
    try {
      const decoded = jwt.verify(oldToken, JWT_PUBLIC_KEY, {
        algorithms:           [JWT_ALGORITHM],
        ignoreExpiration:     true,
      });
      userId = decoded.sub;
    } catch {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Verify refresh token hash in Redis
    const stored = await redisClient.get(`refresh:${userId}`);
    if (!stored) return res.status(401).json({ error: 'Refresh token expired or revoked' });

    const valid = await bcrypt.compare(incoming, stored);
    if (!valid) return res.status(401).json({ error: 'Invalid refresh token' });

    // Fetch fresh user data
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.status(401).json({ error: 'User not found' });
    const user = rows[0];

    // Rotate: delete old refresh token, issue new pair
    await redisClient.del(`refresh:${userId}`);
    const accessToken = generateAccessToken(user);
    const { token: newRefresh, ttl } = await generateRefreshToken(user.id, user.role);
    setRefreshCookie(res, newRefresh, ttl);

    res.json({ token: accessToken });
  } catch (err) {
    console.error('Refresh error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

router.post('/logout',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      // Invalidate refresh token in Redis
      await redisClient.del(`refresh:${req.user.sub}`);

      // Clear HttpOnly cookie
      res.clearCookie('refresh_token', {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Logout error', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /auth/sessions ────────────────────────────────────────────────────────

router.get('/sessions',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    // In a full implementation, track sessions in a separate Redis set
    // For MVP: just confirm one active session exists
    const hasSession = await redisClient.exists(`refresh:${req.user.sub}`);
    res.json({ sessions: hasSession ? [{ id: 'current', active: true }] : [] });
  }
);

// ── DELETE /auth/sessions/revoke-all ─────────────────────────────────────────

router.post('/sessions/revoke-all',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    await redisClient.del(`refresh:${req.user.sub}`);
    res.clearCookie('refresh_token', { httpOnly: true, secure: true, sameSite: 'Strict' });
    res.json({ success: true, message: 'All sessions revoked' });
  }
);

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { router, requireRole };
