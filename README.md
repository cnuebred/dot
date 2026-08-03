<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-ff69b4?style=flat-square" alt="Bun">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/format-v4.0-8b5cf6?style=flat-square" alt="Format 4.0">
</p>

# 🎨 dot — minimalist SVG icon generator

**dot** is a stateless, zero-dependency SVG icon generator. Draw pixel-perfect icons on a 16×16 grid, encode them into a compact Base64URL payload, and embed them directly in a URL — **no accounts, no databases, no server-side state**. Every icon is fully self-contained in its URL.

> 🔗 **[dot.qrware.pl](https://dot.qrware.pl)** — public instance

---

## ✨ Why dot?

| Feature | Description |
|---|---|
| ⚡ **Lightning fast** | Bun backend, SVG compiled in <1ms, 1-year cache |
| 🔗 **Hotlinkable** | Every icon is a permanent URL: `/r/:payload` → clean SVG |
| 🧩 **Embeddable** | `/i/:payload` → page with OG meta tags (Discord, Twitter, Facebook) |
| 🎯 **Minimalist** | 16×16 grid, 5 tools, 64 colors — zero bloat |
| 📦 **Single binary** | Backend + frontend = one Bun process |
| 🔒 **Secure** | Payload validation, rate limiting, security headers |
| 🖼️ **Public gallery** | `/api/gallery` — browse and share community icons |
| 🧱 **Embeddable widget** | `embed.js` — embed the editor on your own page |

---

## 🚀 Quick start (self-hosted)

### Requirements

- **[Bun](https://bun.com)** ≥ 1.3.0

### Installation

```bash
git clone https://github.com/your-org/dot.git
cd dot
bun install
```

### Development

```bash
# Terminal 1 — backend (Bun)
bun start
# → SVG Generator running at http://localhost:3250

# Terminal 2 — frontend (Vite dev server with HMR)
bun run dev
# → http://localhost:5173
```

Vite automatically proxies `/r/*`, `/i/*` and `/api/*` to the backend on port 3250.

### Production

```bash
# 1. Build frontend
bun run build
# → dist/ (static HTML/CSS/JS + embed.js)

# 2. Start backend (also serves frontend from dist/)
bun start
# → http://localhost:3250
```

The backend automatically serves the built frontend from the `dist/` directory — **one process, zero reverse proxy**.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3250` | HTTP server port |
| `PUBLIC_ORIGIN` | `http://localhost:3250` | Public base URL used for absolute links (`/p/...`, `/o/...`) |
| `TRUSTED_PROXIES` | _(empty)_ | Comma-separated IPs/CIDRs from which `X-Forwarded-For` is trusted |

**Multi-machine / shared state:**

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | _(empty)_ | Enables **global rate-limiting** (across all instances) and a **shared render cache** tier |
| `VALKEY_URL` | `REDIS_URL` | Alias for Valkey |
| `DOT_DB_PATH` | _(empty)_ | Path to a SQLite DB for **process-safe** gallery + static links (falls back to JSON files if unset) |

**Monetization / API keys:**

| Variable | Default | Description |
|---|---|---|
| `DOT_API_KEYS` | _(empty)_ | Comma-separated paid API keys (accepted via `Authorization: Bearer <key>`) |
| `DOT_BATCH_PAID_LIMIT` | `1000` | `/api/batch` requests/min for paid keys |
| `DOT_BATCH_FREE_LIMIT` | `30` | `/api/batch` requests/min for anonymous |
| `DOT_LINKS_FREE_QUOTA` | `5` | Static links/day for anonymous; paid keys are unlimited |

**CDN note:** routes `/r/*`, `/favicon/*` return `Cache-Control: immutable` + a strong `ETag` and are safe to put entirely behind a CDN/nginx cache — no shared state is needed for pure icon rendering.

```bash
PORT=8080 bun start
```

### Operations — Redis & SQLite

The app scales from a single process (default, zero setup) to multi-process /
multi-machine by enabling two optional stores. All are **opt-in** via env vars.

**1. SQLite (`DOT_DB_PATH`)** — makes gallery + static links process-safe
(avoids the JSON-file + in-memory-cache race across processes):

```bash
# migrate existing JSON data once (idempotent)
DOT_DB_PATH=/var/www/dot/dot.db ./tools/migrate_json_to_sqlite.sh

DOT_DB_PATH=/var/www/dot/dot.db bun start
```

**2. Redis (`REDIS_URL`)** — global rate-limiting + shared render cache across
all instances. Postaw Redis lokalnie na serwerze:

```bash
# Arch/Manjaro, Debian/Ubuntu, RHEL/Fedora – instaluje, konfiguruje (AOF+hasło),
# startuje i wypisuje REDIS_URL do wstawienia w .env:
sudo ./tools/setup_redis.sh

# zweryfikuj:
redis-cli -a '<hasło z setup>' ping   # → PONG

REDIS_URL=redis://:<hasło>@127.0.0.1:6379 bun start
```

> ⚠️ `setup_redis.sh` binduje Redis do `127.0.0.1` i chroni go hasłem — nie
> wystawiaj go publicznie bez TLS/SSH-tunelu.

**Health & metrics:** `/api/health` i `/api/metrics` raportują, czy `redis` /
`sqlite` są aktywne (pola `features`).

**Recepta skalowania:**
- 1 proces / mały ruch → nic nie trzeba (pliki JSON, in-memory cache).
- 1 maszyna, wiele procesów → `DOT_DB_PATH` (SQLite) + `REDIS_URL`.
- wiele maszyn → `REDIS_URL` (rate-limit + cache) + SQLite na wspólnym FS,
  najlepiej docelowo Postgres (interfejs `RateLimitStore` jest gotowy do podmiany).
---

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │───▶│  Bun Server  │───▶│  sharp (PNG, │
│  Canvas 2D   │     │  (Bun.serve) │     │  WebP, ICO)  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                     │
       ▼                     ▼
  StateManager         LRU Cache
  (undo/redo)          (1000 entries)
```

### Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Runtime** | Bun 1.x | Native `Bun.serve()`, zero middleware |
| **Frontend** | TypeScript 5.x + Vite 5.x | ES modules, HMR, tree-shaking |
| **Rendering** | Canvas 2D API | Custom grid renderer, no libraries |
| **State** | `StateManager` class | Immutable snapshots, 50-level undo |
| **Encoding** | Custom bit-packer | 4-bit fields, Base64URL alphabet |
| **Image processing** | `sharp` (libvips) | SVG → PNG/WebP/ICO conversion |
| **Caching** | In-memory LRU | 1000 entries, TTL-based eviction |
| **Rate limiting** | Token bucket | Per-IP, configurable refill rate |
| **Validation** | Custom decoder | Bit-level payload validation |
| **Storage** | JSON files | `data/gallery.json`, `data/staticLinks.json` |

---

## 📦 Payload Format (Binary Specification)

Icons are encoded as a compact binary structure, then serialized to **Base64URL** (RFC 4648 §5, alphabet: `A-Za-z0-9_-`, no padding).

### Header (first character)

The first Base64URL character encodes 6 bits:

| Bits | Field | Range | Description |
|------|-------|-------|-------------|
| 5–4 | Version | 0–3 | Format version (currently `0`) |
| 3–0 | Shape count | 0–15 | Number of shapes in the icon |

### Background Color (next 2 characters)

12 bits total, 4 bits per RGB channel (0–15 each, scaled to 0–255):

| Bits | Channel |
|------|---------|
| 11–8 | Red |
| 7–4 | Green |
| 3–0 | Blue |

### Shape Data (variable length)

Each shape consumes **42 bits** → 7 Base64URL characters:

| Field | Bits | Range | Description |
|-------|------|-------|-------------|
| Type | 3 | 0–7 | 0=line, 1=rect, 2=circle, 3=triangle, 4=arc, 5=move |
| X1, Y1 | 4+4 | 0–15 | Start coordinates |
| X2, Y2 | 4+4 | 0–15 | End coordinates |
| Color index | 6 | 0–63 | Index into 64-color palette |
| Stroke width | 4 | 0–15 | Line thickness in grid units |
| Opacity | 4 | 0–15 | 0=transparent, 15=opaque |
| Rotation | 4 | 0–15 | ×22.5° (0–337.5°) |
| Z-index | 4 | 0–15 | Layer ordering (higher = on top) |
| Fill | 1 | 0–1 | 0=stroke only, 1=filled |

**Example:** A simple 2-shape icon (circle + line) with default background → ~15–20 characters total.

---

## 🌐 API Reference

### `GET /r/:payload`

Render an icon from its encoded payload.

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `format` | `svg`, `png`, `webp` | `svg` | Output format |
| `mode` | (empty), `preview`, `favicon` | (empty) | Render mode |
| `bg` | `#RRGGBB` | `#ffffff` | Background color (favicon mode) |
| `size` | integer | 512 | Output size in pixels (PNG/WebP) |

**Response:** `200` with `image/svg+xml`, `image/png`, or `image/webp` | `400` invalid payload | `429` rate limit

**Caching:** `Cache-Control: public, max-age=31536000, immutable` (1 year).

### `GET /raw/:payload`

Same as `/r/:payload` but accepts an **uncompressed** (human-readable) payload format. Useful for debugging and manual construction.

### `GET /api/gallery`

Returns the public gallery as a JSON array.

```json
[
  {
    "id": "abc123",
    "payload": "A...",
    "title": "My Icon",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

### `POST /api/gallery`

Publish an icon to the public gallery.

```json
// Request
{
  "payload": "A...",
  "title": "My Icon"
}

// Response: 201 Created | 400 Bad Request | 429 Too Many Requests
```

### `GET /api/health`

Health check endpoint.

```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "1.0.0",
  "formatVersion": 0
}
```

---

## 🎨 Editor Features

### Drawing Tools

| Tool | Key | Description |
|------|-----|-------------|
| Line | `1` | Click and drag to draw a straight line |
| Rectangle | `2` | Click and drag to draw a rectangle |
| Circle | `3` | Click and drag to draw a circle/ellipse |
| Triangle | `4` | Click and drag to draw a triangle |
| Arc | `5` | Click and drag to draw an arc segment |
| Move | — | Click a shape to select and drag to reposition |

### Shape Properties

| Property | Range | Description |
|----------|-------|-------------|
| Stroke Width | 0–15 | Line thickness in grid units |
| Fill | on/off | Toggle between outlined and filled shapes |
| Color | 0–63 | Index into the 64-color palette |
| Opacity | 0–15 | 0 = fully transparent, 15 = fully opaque |
| Rotation | 0–15 | Rotation angle × 22.5° (0°–337.5°) |
| Z-Index | 0–15 | Layer ordering; higher values render on top |

### Undo / Redo

The `StateManager` maintains a history stack of up to **50 immutable snapshots**.

| Action | Shortcut | Button |
|--------|----------|--------|
| Undo | `Ctrl+Z` | ↩ |
| Redo | `Ctrl+Shift+Z` | ↪ |
| Delete last shape | `Delete` | — |

### Export Options

| Format | MIME Type | Use Case |
|--------|-----------|----------|
| SVG Hotlink | `image/svg+xml` | Direct `<img>` embedding, infinite scaling |
| PNG Hotlink | `image/png` | Social media, markdown files, email |
| WebP Hotlink | `image/webp` | Modern browsers, smaller file size |
| Favicon (.ico) | `image/x-icon` | Multi-resolution favicon (16/32/48px) |
| Raw SVG Code | `image/svg+xml` | Copy-paste into HTML or design tools |
| RAW Payload Link | `text/plain` | Uncompressed, human-readable URL for debugging |

### Import

Paste a link (e.g. `/r/...` or `/raw/...`) or a raw payload into the import field to load an existing icon into the editor.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `1` | Line tool |
| `2` | Rectangle tool |
| `3` | Circle tool |
| `4` | Triangle tool |
| `5` | Arc tool |
| `F` | Toggle fill |
| `Delete` | Remove last shape |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+E` | Export modal |

---

## 🎨 Color Palette

The 64-color palette is shared between frontend and backend (`src/shared/palette.ts`). Colors are indexed 0–63, arranged in an 8×8 grid in the editor UI. The palette includes:

- 8 grayscale steps (black → white)
- 8 red tones
- 8 orange/yellow tones
- 8 green tones
- 8 cyan/teal tones
- 8 blue tones
- 8 purple/magenta tones
- 8 brown/earth tones

---

## 🔒 Security

- **No user input stored** — all state lives in the URL or client-side memory
- **Rate limiting** — token bucket algorithm, 60 requests/minute per IP for render endpoints, 10/minute for gallery POST
- **Payload validation** — bit-level decoding with bounds checking; malformed payloads return 400
- **No cookies, no sessions** — fully stateless
- **CSP headers** — `Content-Security-Policy` restricts script sources
- **File mutex** — concurrent write protection for `gallery.json` and `staticLinks.json`

---

## 🧱 Embedding on your own page

```html
<!-- Paste anywhere on your page -->
<script src="https://your-instance.com/embed.js"></script>
<div data-dot-editor></div>
```

The editor will appear inside the `[data-dot-editor]` element. Users can draw icons without leaving your page.

---

## 🛠️ Development

### Local Setup

```bash
# Install dependencies
bun install

# Start dev server (frontend + backend)
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

### Project Structure

```
src/
├── frontend/          # TypeScript + Vite
│   ├── logic/         # encoder, decoder, stateManager, math, shortcuts
│   ├── ui/            # HomeView, EditorView, Toolbar, GridCanvas, etc.
│   ├── main.ts        # App entry point, SPA router
│   ├── embed.ts       # Standalone embed script
│   └── style.css      # All styles (dark theme)
├── backend/           # Bun server
│   ├── server.ts      # Main server, all endpoints
│   ├── decoder.ts     # Payload binary decoder
│   ├── validator.ts   # Payload validation
│   ├── svgCompiler.ts # SVG generation from decoded data
│   ├── renderCache.ts # LRU cache
│   ├── rateLimiter.ts # Token bucket rate limiter
│   ├── security.ts    # CSP headers, security middleware
│   ├── gallery.ts     # Gallery CRUD
│   ├── staticLinks.ts # Static link management
│   ├── payloadValidation.ts
│   ├── fileMutex.ts   # Concurrent file write protection
│   └── fallbackSvg.ts # Default SVG when rendering fails
└── shared/            # Shared between frontend and backend
    ├── palette.ts     # 64-color palette
    └── format.ts      # Format version constants
```

### Running Tests

```bash
bun test                          # All tests
bun test tests/decoder.test.ts    # Single test file
```

Tests cover: encoder, decoder, validator, renderCache, svgCompiler.

---

## 📄 License

MIT — use, modify, self-host wherever you want.

---

<p align="center">
  <sub>Built with ❤️ for minimalism. <a href="https://dot.qrware.pl">dot.qrware.pl</a></sub>
</p>
