const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const REMOTE_SERVER = 'http://192.168.1.16:8080';

app.use('/uploads', express.static('uploads'));

// Listar archivos locales
app.get('/files', (req, res) => {
  const files = fs.readdirSync('uploads');
  res.json(files);
});

// Subir archivo local
app.post('/upload', upload.single('file'), (req, res) => {
  res.redirect('/');
});

// Interfaz web
app.get('/', async (req, res) => {
  let remoteFiles = [];
  try {
    const r = await axios.get(`${REMOTE_SERVER}/files`);
    remoteFiles = r.data;
  } catch (err) {
    remoteFiles = ['❌ No disponible'];
  }

  const localFiles = fs.readdirSync('uploads');
  res.send(`
    <h2>Servidor local</h2>
    <form method="POST" enctype="multipart/form-data" action="/upload">
      <input type="file" name="file"/>
      <button>Subir</button>
    </form>
    <h3>Archivos locales:</h3>
    <ul>${localFiles.map(f => `<li><a href="/uploads/${f}">${f}</a></li>`).join('')}</ul>
    <h3>Archivos en el otro servidor:</h3>
    <ul>${remoteFiles.map(f => `<li><a href="${REMOTE_SERVER}/uploads/${f}">${f}</a></li>`).join('')}</ul>
  `);
});

app.listen(8080, () => console.log('Servidor activo en puerto 8080'));
