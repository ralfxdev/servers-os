const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const os = require('os');
const multerPkg = multer; // alias to check types in error handler

const app = express();
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

// --- Concurrency & lock manager (inspirado en "comensales")
const MAX_CONCURRENT_UPLOADS = 3; // semáforo: máximo de uploads simultáneos
let currentUploads = 0;
const nameLocks = new Set(); // nombres de archivo bloqueados

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Acquire locks for an array of names in a deterministic order to avoid deadlocks
async function acquireLocks(names) {
  const uniq = Array.from(new Set(names.map(n => String(n))));
  uniq.sort();
  while (true) {
    // wait until none of the names are locked
    const conflict = uniq.some(n => nameLocks.has(n));
    if (!conflict) {
      uniq.forEach(n => nameLocks.add(n));
      console.log(`[locks] acquired: [${uniq.join(', ')}] (locks=${nameLocks.size})`);
      // return a release function
      return () => {
        uniq.forEach(n => nameLocks.delete(n));
        console.log(`[locks] released: [${uniq.join(', ')}] (locks=${nameLocks.size})`);
      };
    }
    await sleep(50);
  }
}

async function acquireUploadSlot() {
  while (currentUploads >= MAX_CONCURRENT_UPLOADS) {
    await sleep(50);
  }
  currentUploads++;
  console.log(`[semaphore] slot acquired (current=${currentUploads}/${MAX_CONCURRENT_UPLOADS})`);
  return () => { currentUploads--; console.log(`[semaphore] slot released (current=${currentUploads}/${MAX_CONCURRENT_UPLOADS})`); };
}

// Monitor / logger: imprime estado periódicamente y expone /stats
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

setInterval(() => {
  const s = collectStats();
  console.log('[stats]', JSON.stringify({ uptime: Math.round(s.uptime), currentUploads: s.currentUploads, locks: s.locksCount, files: s.filesStored, memMB: Math.round(s.memory.heapUsed/1024/1024) }));
}, 5000);

app.get('/stats', (req, res) => {
  res.json(collectStats());
});

// Global error handler (catch Multer errors and others)
app.use((err, req, res, next) => {
  if (!err) return next();
  // Multer errors
  if (err instanceof multerPkg.MulterError || (err && err.code && String(err.code).startsWith('LIMIT_'))) {
    console.error('[MulterError]', err.code || err.message, err);
    return res.status(400).json({ error: 'MulterError', code: err.code || 'MULTER_ERROR', message: err.message });
  }
  // Generic
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'server_error', message: err && err.message ? err.message : String(err) });
});

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const REMOTE_SERVER = 'http://192.168.1.17:8080';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Listar archivos locales
app.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo listar archivos' });
  }
});

// Descargar/leer archivo
app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrado' });
  // Si se solicita descarga forzada, enviar como attachment
  if (req.query && ('download' in req.query)) {
    return res.download(filePath, name);
  }
  res.sendFile(filePath);
});

// Proxy simple para listar archivos del servidor remoto (útil para la UI)
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

// Proxy de descarga para archivos remotos: reenvía el stream y fuerza Content-Disposition: attachment
app.get('/remote-proxy-download', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const remoteUrl = `${REMOTE_SERVER}/uploads/${encodeURIComponent(name)}`;
    const r = await axios.get(remoteUrl, { responseType: 'stream', timeout: 10000 });
    // Propagar tipo si existe
    if (r.headers['content-type']) res.setHeader('Content-Type', r.headers['content-type']);
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(name)}"`);
    r.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'remote download failed' });
  }
});

// Subir archivo local (create)
app.post('/upload', upload.any(), async (req, res) => {
  // multer.any() accepts files with any field name - helps avoid "Unexpected field"
  const files = req.files || (req.file ? [req.file] : []);
  if (!files || !files.length) return res.status(400).json({ error: 'No files uploaded' });

  // Map to target names (preserve originalname)
  const targets = files.map(f => path.basename(f.originalname || f.filename || f.path || 'file'));

  // Acquire a slot (semaphore) to limit concurrent upload workers
  const releaseSlot = await acquireUploadSlot();

  // Acquire locks for the target names (deterministic order) to avoid deadlock
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

// Renombrar/actualizar archivo (update)
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

// Borrar archivo (delete)
app.delete('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// Root: sirve la interfaz en public/index.html
app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(8080, '0.0.0.0', () => console.log('Servidor activo en puerto 8080'));

