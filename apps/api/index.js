// apps/api/index.js
// Main Express API entry point for ResolveX backend

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const { router: authRouter }              = require('./services/auth/auth');
const complaintsRouter                    = require('./services/complaints/complaints');
const mediaRouter                         = require('./services/media/media');
const gisRouter                           = require('./services/gis/gis');
const routingRouter                       = require('./services/routing/routing');
const { router: notifRouter, initWS }     = require('./services/notifications/notifications');
const { connect: connectRabbitMQ }        = require('./rabbitmq');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing + cookies ────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────────────────

const unauthLimit = rateLimit({
  windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => !!req.headers['authorization'],
});
const authLimit = rateLimit({
  windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => !req.headers['authorization'],
});
app.use(unauthLimit);
app.use(authLimit);

// ── Routes — all under /api/v1 ────────────────────────────────────────────────

app.use('/api/v1/auth',         authRouter);
app.use('/api/v1/complaints',   complaintsRouter);
app.use('/api/v1/media',        mediaRouter);
app.use('/api/v1/gis',          gisRouter);
app.use('/api/v1/routing',      routingRouter);
app.use('/api/v1/notification', notifRouter);
app.use('/api/v1/admin',        gisRouter);  // demo reset: DELETE /api/v1/admin/demo/reset

app.get('/health', (req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
);

// ── Global error handler ──────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error' : err.message;
  console.error(`[${req.method}] ${req.path} →`, err.message);
  res.status(status).json({ error: message });
});

// ── Start — http.Server returned by listen() is passed to initWS ──────────────
// WebSocket server attaches to the same port as Express (no extra port).
// RabbitMQ connect() retries automatically on failure.

const PORT = process.env.APP_PORT || 4000;

const server = app.listen(PORT, async () => {
  console.log(`ResolveX API on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  initWS(server);           // attach WS to same HTTP server
  await connectRabbitMQ();  // start queue connection with auto-retry
});

module.exports = app;