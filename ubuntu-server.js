const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

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

// Subir archivo local (create)
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const safeName = path.basename(req.file.originalname);
  let dest = path.join(UPLOAD_DIR, safeName);
  if (fs.existsSync(dest)) {
    // evitar sobrescribir: prefijar timestamp
    const suffix = Date.now();
    dest = path.join(UPLOAD_DIR, `${suffix}-${safeName}`);
  }
  fs.renameSync(req.file.path, dest);

  // Si el cliente espera JSON (fetch), devolver JSON
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ ok: true, filename: path.basename(dest) });
  }
  // por defecto redirect para formularios tradicionales
  res.redirect('/');
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

