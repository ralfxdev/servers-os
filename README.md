# servers-os

Aplicación simple de ejemplo: dos servidores (ej: `ubuntu-server.js` y `windows-server.js`) que gestionan archivos locales y muestran una interfaz web responsiva.

Instalación (Windows PowerShell):

```powershell
cd "c:\Users\lopez\Downloads\servers-os"
npm install
```

Iniciar un servidor (ejemplo ubuntu):

```powershell
npm run start-ubuntu
```

Iniciar el otro servidor en otra máquina/VM cambiando la constante `REMOTE_SERVER` en el archivo correspondiente y ejecutar:

```powershell
npm run start-windows
```

Qué incluye:
- Endpoints CRUD: `GET /files`, `GET /files/:name`, `POST /upload`, `PUT /files/:name`, `DELETE /files/:name`.
- Interfaz responsiva en `public/` que permite subir, descargar, renombrar y borrar archivos.

Notas:
- Por simplicidad la UI por defecto intenta listar sólo el servidor local. Para ver archivos remotos, los servidores deben apuntarse entre sí (constante `REMOTE_SERVER`) o puedes abrir manualmente la IP remota.
- Asegúrate de que los puertos 8080 estén disponibles.
