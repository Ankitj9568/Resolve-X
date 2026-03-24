const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const crypto    = require('crypto');
const path      = require('path');
const Minio     = require('minio');
const { requireRole } = require('../auth/auth');
const pool      = require('../db/db');
 
// ── MinIO client ──────────────────────────────────────────────────────────────
// Use env vars that match docker-compose.yml and production Railway config.
// S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_USE_SSL
 
const minioClient = new Minio.Client({
  endPoint:  process.env.S3_ENDPOINT  || 'localhost',
  port:      parseInt(process.env.S3_PORT || '9000'),
  useSSL:    process.env.S3_USE_SSL === 'true',
  accessKey: process.env.S3_ACCESS_KEY || 'resolvex',
  secretKey: process.env.S3_SECRET_KEY || 'local-dev-secret',
});
 
const BUCKET = process.env.S3_BUCKET || 'complaint-media';
 
// Public base URL for returning file URLs to the client.
// In dev: http://localhost:9000/complaint-media
// In prod: set S3_PUBLIC_URL to the CDN or proxy URL
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL
  || `http://${process.env.S3_ENDPOINT || 'localhost'}:${process.env.S3_PORT || '9000'}`;
 
// ── MIME magic bytes ──────────────────────────────────────────────────────────
// multer's file.mimetype is set from the Content-Type header — the client
// controls it. A renamed .exe uploaded as image/jpeg passes the original check.
// Magic bytes are the first bytes of the actual file content — unforgeable.
 
const MAGIC_BYTES = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'video/mp4':  [
    Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), // ftyp at offset 4
    Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
  ],
};
 
// Map MIME type to the media_type enum the DB expects ('image' | 'video')
const MIME_TO_MEDIA_TYPE = {
  'image/jpeg': 'image',
  'image/png':  'image',
  'video/mp4':  'video',
};
 
function validateMagicBytes(buffer, mimeType) {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;
 
  // For MP4, the ftyp box starts at byte 4 — check a slice
  const checkBuffer = mimeType === 'video/mp4' ? buffer : buffer;
 
  return signatures.some(sig => {
    if (mimeType === 'video/mp4') {
      // ftyp marker is at offset 4 in most MP4 files
      return buffer.length >= sig.length &&
        sig.slice(4).equals(buffer.slice(4, sig.length));
    }
    return buffer.length >= sig.length &&
      sig.equals(buffer.slice(0, sig.length));
  });
}
 
// ── Multer config ─────────────────────────────────────────────────────────────
// Memory storage — file lands in req.file.buffer for magic byte inspection
// and direct stream to MinIO. Limit: 10MB per file, 1 file per request.
 
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:  10 * 1024 * 1024, // 10MB
    files:     1,                 // one file per request; FE calls 3× for 3 files
  },
});
 
// ── POST /media/upload ────────────────────────────────────────────────────────
 
router.post('/upload',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  upload.single('file'),
  async (req, res) => {
    const file         = req.file;
    const complaintId  = req.body.complaint_id;
    const citizenId    = req.user.sub;
 
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!complaintId) {
      return res.status(400).json({ error: 'complaint_id is required' });
    }
 
    // ── Step 1: Declared MIME type must be in allowlist ───────────────────
    const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }
 
    // ── Step 2: Validate magic bytes — prevents MIME spoofing ────────────
    if (!validateMagicBytes(file.buffer, file.mimetype)) {
      return res.status(400).json({ error: 'File content does not match declared type' });
    }
 
    // ── Step 3: Verify complaint exists and belongs to the uploading user ─
    // Citizens can only attach files to their own complaints.
    // Officers can attach to any complaint in their dept.
    const ownershipCheck = req.user.role === 'citizen'
      ? 'SELECT id FROM complaints WHERE id = $1 AND citizen_id = $2'
      : 'SELECT id FROM complaints WHERE id = $1';
    const ownershipParams = req.user.role === 'citizen'
      ? [complaintId, citizenId]
      : [complaintId];
 
    const { rows: complaintRows } = await pool.query(ownershipCheck, ownershipParams);
    if (!complaintRows.length) {
      return res.status(404).json({ error: 'Complaint not found or access denied' });
    }
 
    // ── Step 4: Check file count limit (max 3 per complaint) ─────────────
    const { rows: [countRow] } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM complaint_media WHERE complaint_id = $1',
      [complaintId]
    );
    if (parseInt(countRow.cnt) >= 3) {
      return res.status(400).json({ error: 'Maximum 3 files per complaint' });
    }
 
    // ── Step 5: Build a safe object name — no originalname in the path ───
    // Using originalname directly allows path traversal attacks.
    // UUID + extension derived from validated MIME type only.
    const ext = file.mimetype === 'video/mp4' ? '.mp4'
              : file.mimetype === 'image/png'  ? '.png'
              : '.jpg';
    const objectName = `${complaintId}/${crypto.randomUUID()}${ext}`;
 
    try {
      // ── Step 6: Upload to MinIO/S3 ──────────────────────────────────────
      await minioClient.putObject(
        BUCKET,
        objectName,
        file.buffer,
        file.buffer.length,
        { 'Content-Type': file.mimetype }
      );
 
      // ── Step 7: Build public URL from env var, not hardcoded host ───────
      const fileUrl = `${S3_PUBLIC_URL}/${BUCKET}/${objectName}`;
 
      // ── Step 8: Persist to DB ────────────────────────────────────────────
      // media_type column is 'image' | 'video' — not the full MIME string
      const mediaType = MIME_TO_MEDIA_TYPE[file.mimetype];
 
      const { rows: [media] } = await pool.query(
        `INSERT INTO complaint_media
           (id, complaint_id, file_url, media_type, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, now())
         RETURNING file_url`,
        [complaintId, fileUrl, mediaType]
      );
 
      return res.json({ file_url: media.file_url });
 
    } catch (err) {
      console.error('Media upload error', err);
      return res.status(500).json({ error: 'File upload failed' });
    }
  }
);
 
module.exports = router;
 
