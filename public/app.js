const REMOTE_SERVER = window.REMOTE_SERVER || null; // optional: server exposes remote constant

async function loadLocal() {
  const res = await fetch('/files');
  const files = await res.json();
  const ul = document.getElementById('localList');
  ul.innerHTML = '';
  files.forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;

  // Decide media type
  const isVideoLocal = /\.(mp4|webm|ogg)$/i.test(f);
  const isImageLocal = /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(f);

  if (isVideoLocal || isImageLocal) {
    const verBtn = document.createElement('button');
    verBtn.textContent = 'Ver';
    verBtn.onclick = () => {
      const modal = ensureMediaModal();
      const video = modal.querySelector('video');
      const img = modal.querySelector('img');
      if (isVideoLocal) {
        img.style.display = 'none';
        video.style.display = 'block';
        video.src = `/stream?name=${encodeURIComponent(f)}`;
        modal.style.display = 'flex';
        video.play().catch(() => {});
      } else {
        video.pause(); video.src = '';
        video.style.display = 'none';
        img.style.display = 'block';
        img.src = `/uploads/${encodeURIComponent(f)}`;
        modal.style.display = 'flex';
      }
    };
    li.appendChild(verBtn);
  }

  const dlLink = document.createElement('a');
  dlLink.href = `/files/${encodeURIComponent(f)}?download=1`;
  dlLink.textContent = 'Descargar';
  dlLink.className = 'btn-link';
  dlLink.setAttribute('download', '');
  li.appendChild(dlLink);

  // NOTE: 'Ver' button above already handles local images and videos; no extra play button needed

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Renombrar';
    renameBtn.onclick = async () => {
      const newName = prompt('Nuevo nombre para ' + f, f);
      if (!newName) return;
      await fetch(`/files/${encodeURIComponent(f)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ newName })
      });
      loadLocal();
      loadRemote();
    };
    li.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Borrar';
    delBtn.onclick = async () => {
      if (!confirm('Borrar ' + f + '?')) return;
      await fetch(`/files/${encodeURIComponent(f)}`, { method: 'DELETE' });
      loadLocal();
      loadRemote();
    };
    li.appendChild(delBtn);

    ul.appendChild(li);
  });
}

async function loadRemote() {
  const ul = document.getElementById('remoteList');
  ul.innerHTML = '';
  // El servidor remoto está configurado en los archivos del servidor; aquí sólo intentamos una llamada a la misma IP-base si existe
  try {
    // infer remote from current page origin? if not available, try known host via relative config
    // Try to fetch using a relative host; the server exposes a REMOTE_SERVER variable when needed
    const resp = await fetch('/remote-proxy', { method: 'GET' });
    if (resp.ok) {
      const files = await resp.json();
      files.forEach(f => {
        const li = document.createElement('li');
        const name = f.name || f;
        const isVideo = /\.(mp4|webm|ogg)$/i.test(name);
        const isImage = /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(name);

        const title = document.createElement('span');
        title.textContent = name;
        title.className = 'btn-link';
        li.appendChild(title);

        if (isVideo || isImage) {
          const ver = document.createElement('button');
          ver.textContent = 'Ver';
          ver.onclick = () => {
            const modal = ensureMediaModal();
            const video = modal.querySelector('video');
            const img = modal.querySelector('img');
            if (isVideo) {
              img.style.display = 'none';
              video.style.display = 'block';
              video.src = `/remote-proxy-stream?name=${encodeURIComponent(name)}`;
              modal.style.display = 'flex';
              video.play().catch(() => {});
            } else {
              video.pause(); video.src = '';
              video.style.display = 'none';
              img.style.display = 'block';
              img.src = f.url || `${REMOTE_SERVER}/uploads/${encodeURIComponent(name)}`;
              modal.style.display = 'flex';
            }
          };
          li.appendChild(ver);
        }

  const dl = document.createElement('a');
  // use proxy-download to force download
  dl.href = `/remote-proxy-download?name=${encodeURIComponent(f.name || f)}`;
        dl.textContent = 'Descargar';
        dl.className = 'btn-link';
        dl.setAttribute('download', '');
        li.appendChild(dl);

        ul.appendChild(li);
      });
      return;
    }
  } catch (e) {
    // continue to try direct remote server if configured
  }

  // fallback: no proxy available — try to fetch using a REMOTE_SERVER host guessed from server code
  // Because the server code includes a REMOTE_SERVER constant, the easiest integration is to rely on the / files endpoint from the other server manually.
  const hint = null; // not available in the client by default
  ul.innerHTML = '<li>❌ No disponible (la UI usa un proxy opcional /remote-proxy). Si quieres ver archivos remotos, consulta la otra instancia en su IP.</li>';
}

// Modal player for remote videos
function ensureMediaModal() {
  if (document.getElementById('mediaModal')) return document.getElementById('mediaModal');
  const modal = document.createElement('div');
  modal.id = 'mediaModal';
  modal.style.position = 'fixed';
  modal.style.left = '0';
  modal.style.top = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.background = 'rgba(0,0,0,0.6)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  const container = document.createElement('div');
  container.style.background = '#000';
  container.style.padding = '10px';
  container.style.borderRadius = '6px';
  container.style.maxWidth = '90%';
  container.style.maxHeight = '90%';

  const video = document.createElement('video');
  video.controls = true;
  video.style.maxWidth = '100%';
  video.style.maxHeight = '80vh';
  video.style.display = 'none';
  container.appendChild(video);

  const img = document.createElement('img');
  img.style.maxWidth = '100%';
  img.style.maxHeight = '80vh';
  img.style.display = 'none';
  container.appendChild(img);

  const close = document.createElement('button');
  close.textContent = 'Cerrar';
  close.style.display = 'block';
  close.style.marginTop = '8px';
  close.onclick = () => { modal.style.display = 'none'; video.pause(); video.src = ''; img.src = ''; };
  container.appendChild(close);

  modal.appendChild(container);
  document.body.appendChild(modal);
  return modal;
}

document.getElementById('uploadForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('fileInput');
  if (!input.files.length) return;
  const fd = new FormData();
  for (let i = 0; i < input.files.length; i++) fd.append('files', input.files[i]);
  const res = await fetch('/upload', { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
  if (res.ok) {
    const data = await res.json().catch(() => null);
    const names = data && data.files ? data.files.join(', ') : (data && data.filename ? data.filename : 'Subido');
    document.getElementById('uploadMsg').textContent = `Subido: ${names}`;
    input.value = '';
    loadLocal();
  } else {
    // Try to show JSON error from server (Multer or other)
    let body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    const msg = body && (body.message || body.error || JSON.stringify(body)) ? (body.message || body.error || JSON.stringify(body)) : `Error ${res.status}`;
    document.getElementById('uploadMsg').textContent = `Error al subir: ${msg}`;
    console.error('Upload failed', res.status, body);
  }
});

// Inicializar
loadLocal();
loadRemote();
