const REMOTE_SERVER = window.REMOTE_SERVER || null; // optional: server exposes remote constant

async function loadLocal() {
  const res = await fetch('/files');
  const files = await res.json();
  const ul = document.getElementById('localList');
  ul.innerHTML = '';
  files.forEach(f => {
    const li = document.createElement('li');
    li.textContent = f;

  const viewLink = document.createElement('a');
  viewLink.href = `/uploads/${encodeURIComponent(f)}`;
  viewLink.textContent = 'Ver';
  viewLink.target = '_blank';
  viewLink.className = 'btn-link';
  li.appendChild(viewLink);

  const dlLink = document.createElement('a');
  dlLink.href = `/files/${encodeURIComponent(f)}?download=1`;
  dlLink.textContent = 'Descargar';
  dlLink.className = 'btn-link';
  dlLink.setAttribute('download', '');
  li.appendChild(dlLink);

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
        const a = document.createElement('a');
        a.href = f.url || f.path || '#';
        a.textContent = f.name || f;
        a.target = '_blank';
        a.className = 'btn-link';
        li.appendChild(a);

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
    document.getElementById('uploadMsg').textContent = 'Error al subir';
  }
});

// Inicializar
loadLocal();
loadRemote();
