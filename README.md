<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-ff69b4?style=flat-square" alt="Bun">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/format-v8.0-8b5cf6?style=flat-square" alt="Format 8.0">
</p>

# 🎨 dot — minimalist SVG icon generator

**dot** is a stateless SVG icon generator. Draw icons on a grid canvas (16×16, 32×32, 64×64 or 128×128 points), encode them into a compact compressed payload, and embed them directly in a URL — **no accounts, no databases, no server-side state**. Every icon is fully self-contained in its URL.

> 🔗 **[dot.qrware.pl](https://dot.qrware.pl)** — public instance

---

## ✨ Why dot?

| Feature | Description |
|---|---|
| ⚡ **Lightning fast** | Bun backend, SVG compiled in <1ms, 1-year cache |
| 🔗 **Hotlinkable** | 16×16 and 32×32 icons are permanent URLs: `/r/:payload` → clean SVG |
| 🧩 **Embeddable** | `/i/:payload` → page with OG meta tags (Discord, Twitter, Facebook) |
| 🎯 **Minimalist** | 16×16 / 32×32 / 64×64 / 128×128 grids, 9 tools, 16 palettes × 64 colors |
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
git clone https://github.com/cnuebred/dot.git
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
all instances.

```bash
sudo ./tools/setup_redis.sh

# verify:
redis-cli -a '<pass>' ping   # → PONG

REDIS_URL=redis://:<pass>@127.0.0.1:6379 bun start
```

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │───▶│  Bun Server  │───▶│  sharp (PNG,  │
│  SVG render  │     │  (Bun.serve) │     │  WebP, ICO)  │
└──────────────┘     └──────────────┘     └──────────────┘
       │                     │
       ▼                     ▼
  StateManager         LRU Cache
 (undo/redo 100)      (500 entries, 1h TTL)
```

### Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Runtime** | Bun 1.x | Native `Bun.serve()`, zero middleware |
| **Frontend** | TypeScript 5.x + Vite 5.x | ES modules, HMR, tree-shaking |
| **Rendering** | Inline SVG (`committedRenderer.ts`) | Client-side, mirrors backend — no round-trip on every edit |
| **State** | `StateManager` singleton | Pub/sub, 100-level undo, canvas-size aware |
| **Encoding** | zlib + Base64URL | v8 base-36 text blocks |
| **Image processing** | `sharp` (libvips) | SVG → PNG/WebP/ICO conversion |
| **Caching** | In-memory LRU (`renderCache`) | 500 entries, 1h TTL; optional Redis tier |
| **Rate limiting** | Token bucket / Redis | Per-IP, configurable windows |
| **Validation** | Custom parser | v3–v8 payload validation |
| **Storage** | SQLite (optional) | `DOT_DB_PATH` → process-safe gallery + links (JSON fallback) |

---

## 📦 Payload Format (v8)

Icons are encoded as a **text block format**, compressed with **zlib**, then serialized to **Base64URL** (RFC 4648 §5, alphabet `A-Za-z0-9_-`, no padding).

### Preamble

```
v8:<size>:<body>
```

- `v8` — format version
- `<size>` — canvas max coordinate (`15` = 16×16, `31` = 32×32), self-describing
- `<body>` — concatenated figure blocks

### Figure Block (13 characters)

```
[X1][Y1][TYPE][X2][Y2][C1][C2][C3][W][OP][RO][ZX][RD]
```

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| X1, Y1 | base-36 | 0–35 | Start coordinates (supports up to 32×32) |
| TYPE | letter | `l s b v a k n z r R c C t T` | Tool + ending; uppercase = fill |
| X2, Y2 | base-36 | 0–35 | End coordinates |
| C1 C2 C3 | hex | 0–4095 | 12-bit color (`paletteId<<6 \| colorIndex`) |
| W | base-36 | 0–35 | Line weight |
| OP | base-36 | 0–35 | Opacity (0 = erase/knockout, 35 = opaque) |
| RO | base-36 | 0–35 | Rotation in 10° steps (0°–350°) |
| ZX | base-36 | 0–35 | Z-index (higher = on top) |
| RD | base-36 | 0–35 | Corner radius / arc curvature |

**Base-36:** every single-symbol field uses `0-9` then `a-z` → range **0–35**.
This lets one character address a 32×32 canvas and gives effect fields finer
control. Legacy **v3–v7** remain decodable (their 0–15 fields are rescaled to
the canonical 0–35 scale on decode so all versions render identically).

**Example:** a 32×32 filled-rectangle icon decompresses to `v8:31:00Rzz0001z000`,
then compresses into a short `/r/...` URL.

### Canvas Sizes

| Size | maxCoord | Stateless (hotlink/export)? |
|------|----------|------------------------------|
| 16×16 | 15 | ✅ Yes |
| 32×32 | 31 | ✅ Yes |
| 64×64 | 63 | ❌ No — client-only |
| 128×128 | 127 | ❌ No — client-only |

---

## 🌐 API Reference

### `GET /r/:payload`

Render an icon from its encoded payload.

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `format` | `svg`, `png`, `webp` | `svg` | Output format |
| `mode` | (empty), `preview`, `favicon` | (empty) | Render mode |
| `bg` | `#RRGGBB` | `#0a0a0c` | Background color (favicon mode) |

**Response:** `200` with `image/svg+xml`, `image/png`, or `image/webp` | `304` Not Modified (ETag) | `400` invalid payload | `429` rate limit

**Caching:** `Cache-Control: public, max-age=31536000, immutable` (1 year) + strong ETag. PNG/WebP cached after first render; Redis shares results across processes.

### `GET /raw/:payload`

Same as `/r/:payload` but accepts an **uncompressed** (human-readable) text payload (e.g. `v8:31:00Rzz0001z000`). Useful for debugging and manual construction.

### `GET /favicon/:payload`

Multi-resolution ICO (16/32/48px). Optional `?bg=#RRGGBB`.

### `GET /api/gallery`

Returns the public gallery (paginated) as a JSON array. Supports `?sort=` and `?search=` / hashtag (`#tag`) filtering.

```json
[
  {
    "id": "abc123",
    "payload": "A...",
    "title": "My Icon",
    "createdAt": 1737000000000
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

Admin auth (GitHub OAuth) also enables `PATCH`/`DELETE /api/gallery/:id`.

### `GET /api/health`

Health check endpoint (reports `features: { redis, sqlite }`).

---

## 🎨 Editor Features

### Drawing Tools

| Tool | Key | Description |
|------|-----|-------------|
| Line | `1` | Round-cap line |
| Line (square) / Line (flat) | — | Square / butt-cap lines |
| Rectangle | `2` | Rectangle (optional rounded corners via Radius) |
| Circle | `3` | Circle inscribed in the drag box |
| Triangle | `4` | Isosceles triangle |
| Arc | `5` | Round-cap arc (+ square/flat variants) |
| Move | — | Click to select, drag to move, marquee-select |

### Shape Properties

| Property | Range | Description |
|----------|-------|-------------|
| Canvas Size | 16/32/64/128 | Grid points per axis |
| Color | 0–4095 | 12-bit color across 16 palettes × 64 colors |
| Line Weight | 0–35 | Stroke thickness |
| Fill | on/off | Outlined vs filled |
| Opacity | 0–35 | 0 = transparent, 35 = opaque |
| Rotation | 0–35 | 10° per step (0°–350°) |
| Z-Layer | 0–35 | Higher = on top |
| Radius | 0–35 | Rounded corners / arc curvature |

> **Recolor selection:** with figures selected (blue box), clicking a color
> swatch **recolors the selected figures** instead of only setting the
> next-drawing color.

### Selection & Editing

- Select (Move tool), Shift-click multi-select, or drag a marquee box.
- Resize + rotate handles on the selection bounding box.
- `Ctrl+C` / `Ctrl+V` / `Ctrl+D` copy / paste / duplicate.
- `Delete` removes the selection (or last figure).
- Erase mode punches a knockout hole through **underlying** figures only (layer-aware).

### Undo / Redo

The `StateManager` keeps a history stack of up to **100 snapshots**.

| Action | Shortcut |
|--------|----------|
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` |
| Delete selection | `Delete` |
| Export modal | `Ctrl+E` |

### Export Options

| Format | MIME Type | Use Case |
|--------|-----------|----------|
| SVG Hotlink | `image/svg+xml` | Direct `<img>` embedding, infinite scaling |
| PNG Hotlink | `image/png` | Social media, markdown files, email |
| WebP Hotlink | `image/webp` | Modern browsers, smaller file size |
| Favicon (.ico) | `image/x-icon` | Multi-resolution favicon (16/32/48px) |
| RAW Payload Link | `text/plain` | Uncompressed, human-readable URL for debugging |

For 64×64 / 128×128 canvases the backend-dependent options (hotlink, favicon,
PNG, RAW, publish) are disabled; **Copy SVG** and **Download SVG** still work
client-side.

### Import

Paste a link (`/r/...` or `/raw/...`) or a raw payload into the import field.
v8 payloads restore the correct canvas size automatically.

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
| `Delete` | Delete selection (or last figure) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | Copy / Paste / Duplicate |
| `Ctrl+E` | Export modal |

---

## 🎨 Color System

The 12-bit color value encodes **16 palettes × 64 colors** = 4096 slots:
`paletteId (4 bits) << 6 | colorIndex (6 bits)`. The editor shows a palette
selector bar and a 64-color grid per palette. Legacy 8-bit payloads (paletteId 0)
remain compatible.

---

## 🔒 Security

- **No user input stored** — all state lives in the URL or client-side memory
- **Rate limiting** — token/Redis buckets per IP; stricter limits for CPU-heavy bitmap (`png`/`webp`/`favicon`) rendering
- **Payload validation** — v3–v8 block parsing with bounds checking; malformed payloads return 400
- **Optional auth** — GitHub OAuth + JWT sessions for admin (gallery/docs moderation)
- **CSP & security headers** — page, asset, and API header sets
- **File/DB mutex** — concurrent-write protection for JSON fallback (`gallery.json`, `staticLinks.json`)
- **Redis timeout guard** — all Redis calls bounded (1.5s) so a dead Redis degrades gracefully instead of hanging requests

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
│   ├── logic/         # encoder, decoder, encodeMemo, stateManager, math,
│   │                  #   booleanOps, committedRenderer, pathBuilder, shortcuts
│   ├── ui/            # HomeView, EditorView, Toolbar, GridCanvas, ColorPicker,
│   │                  #   LayerPanel, ExportModal, GalleryView, DocsView, LoginPanel
│   ├── main.ts        # App entry point, SPA router
│   ├── embed.ts       # Standalone embed script
│   └── style.css      # All styles (dark theme)
├── backend/           # Bun server
│   ├── server.ts      # Main server, all endpoints
│   ├── decoder.ts     # Payload decompression
│   ├── validator.ts   # v3–v8 payload validation
│   ├── svgCompiler.ts # SVG generation from decoded blocks
│   ├── payloadValidation.ts
│   ├── renderCache.ts # LRU cache (500, 1h TTL)
│   ├── redisCache.ts  # Redis overlay + timeout guard
│   ├── redisGuard.ts  # Bounded Redis ops (1.5s)
│   ├── rateLimiter.ts # In-memory / Redis rate limiting
│   ├── security.ts    # CSP + security headers
│   ├── apiKeys.ts     # Paid/free tier + batch limits
│   ├── auth.ts        # GitHub OAuth + JWT sessions
│   ├── docs.ts        # Markdown docs storage
│   ├── gallery.ts     # Gallery CRUD
│   ├── staticLinks.ts # Static link management
│   ├── sqliteStore.ts # SQLite persistence (optional)
│   ├── fileMutex.ts   # Concurrent file write protection
│   └── fallbackSvg.ts # Default SVG when rendering fails
└── shared/            # Shared between frontend and backend
    ├── palette.ts     # 16-palette × 64-color system
    ├── format.ts      # Format version constants (v8)
    ├── coords.ts      # Legacy coordinate encoding
    ├── base36.ts      # Base-36 helpers (v8)
    └── toolEndings.ts # Line/arc caps + arrowheads + strokeWidth
```

### Running Tests

```bash
bun test                          # All tests
bun test tests/encoder.test.ts    # Single test file
```

Tests cover: encoder, decoder, validator, renderCache, svgCompiler, coords,
booleanOps, gallery sort, auth, sqlite, client-side renderer, v8 format, and
selection color.

---

## 📄 License

MIT — use, modify, self-host wherever you want.

---

<p align="center">
  <sub>Built with ❤️ for minimalism. <a href="https://dot.qrware.pl">dot.qrware.pl</a></sub>
</p>
