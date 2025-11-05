const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const os = require('os');
const multerPkg = multer;

const app = express();
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Concurrency & lock manager (inspired by the Dining Philosophers)
const MAX_CONCURRENT_UPLOADS = 3;
let currentUploads = 0;
const nameLocks = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// In-memory recent events buffer for dashboard
const recentEvents = [];
function logEvent(msg) {
  const ts = new Date().toISOString();
  recentEvents.unshift(`${ts} ${msg}`);
  if (recentEvents.length > 50) recentEvents.pop();
  console.log(msg);
}

async function acquireLocks(names) {
  const uniq = Array.from(new Set(names.map(n => String(n))));
  uniq.sort();
  while (true) {
    const conflict = uniq.some(n => nameLocks.has(n));
    if (!conflict) {
      uniq.forEach(n => nameLocks.add(n));
      logEvent(`[locks] acquired: [${uniq.join(', ')}] (locks=${nameLocks.size})`);
      return () => { uniq.forEach(n => nameLocks.delete(n)); logEvent(`[locks] released: [${uniq.join(', ')}] (locks=${nameLocks.size})`); };
    }
    await sleep(50);
  }
}

async function acquireUploadSlot() {
  while (currentUploads >= MAX_CONCURRENT_UPLOADS) {
    await sleep(50);
  }
  currentUploads++;
  logEvent(`[semaphore] slot acquired (current=${currentUploads}/${MAX_CONCURRENT_UPLOADS})`);
  return () => { currentUploads--; logEvent(`[semaphore] slot released (current=${currentUploads}/${MAX_CONCURRENT_UPLOADS})`); };
}

function collectStats() {
  const mem = process.memoryUsage();
  return {
    uptime: process.uptime(),
    currentUploads,
    locks: Array.from(nameLocks),
    locksCount: nameLocks.size,
    filesStored: (() => { try { return fs.readdirSync(UPLOAD_DIR).length } catch (e) { return null } })(),
    memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed },
    load: os.loadavg ? os.loadavg() : null,
    platform: process.platform
  };
}

function renderDashboard() {
  const s = collectStats();
  process.stdout.write('\x1Bc');
  console.log('=== Chapin Drive — Resource Monitor ===');
  console.log(`Uptime: ${Math.round(s.uptime)}s   Uploads: ${s.currentUploads}/${MAX_CONCURRENT_UPLOADS}   Locks: ${s.locksCount}   Files: ${s.filesStored}   Mem(MB): ${Math.round(s.memory.heapUsed/1024/1024)}`);
  if (s.load) console.log('Load avg (1/5/15):', s.load.map(n => n.toFixed(2)).join(' '));
  console.log('Recent events:');
  recentEvents.slice(0, 12).forEach(e => console.log('  ' + e));
  console.log('\nPress Ctrl+C to exit.');
}

setInterval(renderDashboard, 1000);

app.get('/stats', (req, res) => {
  res.json(collectStats());
});

// Global error handler (catch Multer errors and others)
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multerPkg.MulterError || (err && err.code && String(err.code).startsWith('LIMIT_'))) {
    console.error('[MulterError]', err.code || err.message, err);
    return res.status(400).json({ error: 'MulterError', code: err.code || 'MULTER_ERROR', message: err.message });
  }
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server_error', message: err && err.message ? err.message : String(err) });
});

const REMOTE_SERVER = 'http://192.168.1.16:8080';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// List local files
app.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Could not list files' });
  }
});

// Download/read file
app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrado' });
  if (req.query && ('download' in req.query)) {
    return res.download(filePath, name);
  }
  res.sendFile(filePath);
});

// Local stream with Range support for video playback and seeking
app.get('/stream', (req, res) => {
  const name = req.query.name && path.basename(req.query.name);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = require('mime').getType(filePath) || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Simple proxy to list files from a remote server (useful for the UI)
app.get('/remote-proxy', async (req, res) => {
  try {
    const r = await axios.get(`${REMOTE_SERVER}/files`, { timeout: 3000 });
    const files = Array.isArray(r.data) ? r.data : [];
    const list = files.map(name => ({ name, url: `${REMOTE_SERVER}/uploads/${encodeURIComponent(name)}` }));
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: 'remote not available' });
  }
});

// Remote download proxy
app.get('/remote-proxy-download', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const remoteUrl = `${REMOTE_SERVER}/uploads/${encodeURIComponent(name)}`;
    const r = await axios.get(remoteUrl, { responseType: 'stream', timeout: 10000 });
    if (r.headers['content-type']) res.setHeader('Content-Type', r.headers['content-type']);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(name)}"`);
    r.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'remote download failed' });
  }
});

// Remote proxy stream: forward Range header to allow streaming and seeking
app.get('/remote-proxy-stream', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const remoteUrl = `${REMOTE_SERVER}/uploads/${encodeURIComponent(name)}`;
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const r = await axios.get(remoteUrl, { responseType: 'stream', headers, timeout: 10000, validateStatus: null });
    res.status(r.status);
    if (r.headers['content-type']) res.setHeader('Content-Type', r.headers['content-type']);
    if (r.headers['accept-ranges']) res.setHeader('Accept-Ranges', r.headers['accept-ranges']);
    if (r.headers['content-range']) res.setHeader('Content-Range', r.headers['content-range']);
    if (r.headers['content-length']) res.setHeader('Content-Length', r.headers['content-length']);
    r.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'remote stream failed' });
  }
});

// Upload local file (create)
app.post('/upload', upload.any(), async (req, res) => {
  // Accept any file field name to prevent Unexpected field errors
  const files = req.files || (req.file ? [req.file] : []);
  if (!files || !files.length) return res.status(400).json({ error: 'No files uploaded' });

  const targets = files.map(f => path.basename(f.originalname || f.filename || f.path || 'file'));
  const releaseSlot = await acquireUploadSlot();
  const releaseLocks = await acquireLocks(targets);

  try {
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safeName = path.basename(f.originalname || f.filename || `file-${Date.now()}`);
      let dest = path.join(UPLOAD_DIR, safeName);
      if (fs.existsSync(dest)) {
        const suffix = Date.now();
        dest = path.join(UPLOAD_DIR, `${suffix}-${safeName}`);
      }
      fs.renameSync(f.path, dest);
      uploaded.push(path.basename(dest));
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ ok: true, files: uploaded });
    }
    res.redirect('/');
  } catch (err) {
    console.error('upload error', err);
    res.status(500).json({ error: 'upload failed' });
  } finally {
    releaseLocks();
    releaseSlot();
  }
});

// Rename/update file (update)
app.put('/files/:name', (req, res) => {
  const oldName = path.basename(req.params.name);
  const newName = req.body.newName || req.query.newName;
  if (!newName) return res.status(400).json({ error: 'newName is required' });
  const oldPath = path.join(UPLOAD_DIR, oldName);
  const newPath = path.join(UPLOAD_DIR, path.basename(newName));
  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
  fs.renameSync(oldPath, newPath);
  res.json({ ok: true, filename: path.basename(newPath) });
});

// Delete file (delete)
app.delete('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// Root: serve the interface at public/index.html
app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(8080, '0.0.0.0', () => logEvent('Servidor activo en puerto 8080'));
