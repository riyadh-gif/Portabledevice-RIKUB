# Jaga Padi - Portable Device RIKUB

Smart Rice Field Monitoring System untuk monitoring sawah. Aplikasi ini berisi
SmartGIS, Chatbot AI, dan Deteksi Penyakit Padi.

## Stack

| Bagian | Teknologi |
| --- | --- |
| Frontend | React 19, Vite, TypeScript config, Tailwind CSS |
| UI | lucide-react, class-variance-authority, shadcn-style components |
| Peta | Leaflet, Leaflet MarkerCluster |
| Backend | FastAPI di `server/` |
| Database | PostgreSQL |
| Database layer | SQLAlchemy |
| Package manager FE | Bun |

## Struktur Project

```text
web/                  Frontend utama Vite
  src/                Source UI aplikasi
  public/             Static assets yang diserve Vite
  public/data/cover/  Gambar cover menu
  dist/               Output build, bisa dibuat ulang

server/               Backend FastAPI
  main.py             Entry app FastAPI
  requirements.txt    Dependency backend langsung, tanpa pin versi
  venv/               Virtualenv lokal, tidak perlu dicommit

warna.md              Catatan warna/desain
```

Folder legacy seperti `frontend/`, `web-build/`, `app.py`, `tools/`, dan dokumen
pywebview lama sudah dihapus. Source frontend sekarang langsung dikerjakan di
`web/`.

## Menjalankan Frontend

```bash
cd web
bun install
bun run dev
```

Build produksi:

```bash
cd web
bun run build
```

Lint:

```bash
cd web
bun run lint
```

## Menjalankan Backend

```bash
cd server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Di Windows, aktivasi venv bisa memakai:

```powershell
venv\Scripts\activate
```

Endpoint backend saat ini masih minimal:

```text
GET /
```

Dependency backend sengaja ditulis tanpa versi dan hanya berisi dependency
langsung:

```text
fastapi
uvicorn[standard]
SQLAlchemy
```

Package transitif seperti `starlette`, `pydantic`, `greenlet`, dan lainnya akan
dipasang otomatis oleh `pip`.

## Database

Target database project ini adalah PostgreSQL, dengan SQLAlchemy sebagai ORM
agar query tidak ditulis sebagai raw SQL langsung.

Konfigurasi koneksi database nantinya sebaiknya dibaca dari environment
variable, misalnya:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/jaga_padi
```

Untuk saat ini struktur model, session, dan migration belum dibuat di
`server/`. Saat fitur database mulai dikerjakan, dependency driver PostgreSQL
seperti `psycopg` atau `asyncpg` bisa ditambahkan ke
`server/requirements.txt` sesuai pola koneksi yang dipilih.

## Integrasi AI

Frontend masih memanggil service AI berikut dari `web/src/api.js`:

| Service | URL default | Fungsi |
| --- | --- | --- |
| Chatbot | `http://127.0.0.1:5000/api/chat` | Kirim pesan chatbot |
| Analisis parameter | `http://127.0.0.1:5000/api/analyze` | Analisis parameter sawah |
| Deteksi penyakit | `http://127.0.0.1:5001/api/detect` | Upload citra daun |

Kalau service itu mau digabung ke FastAPI `server/`, update `web/src/api.js`
agar mengarah ke endpoint baru.

## Aset Publik

Aset yang dipakai langsung oleh frontend harus berada di `web/public/`, karena
Vite akan menyajikannya dari root URL.

Yang sudah tersedia:

```text
web/public/data/cover/chatbot.jpg
web/public/data/cover/detection.jpg
web/public/data/cover/gis.jpg
```

Halaman Maps masih punya referensi ke beberapa aset yang belum ada di
`web/public/`:

```text
/data/photos.json
/data/icon/ruteits.png
/data/MapsJemberNew2/{z}/{x}/{y}.png
/tiles/index.json
/tiles/<layer>/{z}/{x}/{y}.png
```

Jika fitur Maps offline ingin dipakai penuh, salin aset tersebut ke struktur
yang sesuai di `web/public/` atau ubah kode Maps agar memakai sumber data baru.

## Catatan Development

- Jangan edit output `web/dist/` secara manual.
- `web/node_modules/`, `web/dist/`, `server/venv/`, dan `server/__pycache__/`
  adalah hasil lokal/regenerable.
- UI lama dari `frontend/` sudah dimigrasi ke `web/src/`.

## Author

RIKUB Kemdintisaintek 2025
