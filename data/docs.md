# dot.qrware.pl — Technical Documentation

## Overview

**dot.qrware.pl** is a stateless SVG icon generator built on **Bun + TypeScript + Vite**. Draw icons on a grid canvas (16×16, 32×32, 64×64 or 128×128 points), encode them into a compact compressed payload, and embed them directly in a URL — no accounts, no databases, no server-side state required for rendering.

Every stateless icon is fully self-contained in its URL. Share it, bookmark it, embed it in `<img>` tags — it just works.

Discord Server: [dot.qrware.pl](https://discord.gg/Bm6sWcTCMC)
Github: [cnuebred/dot](https://github.com/cnuebred/dot)

---

## Architecture

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

### Frontend Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Language | TypeScript 5.x | Strict mode |
| Bundler | Vite 5.x | ES modules, HMR, tree-shaking |
| Rendering | Inline SVG (`committedRenderer.ts`) | Client-side, mirrors backend `svgCompiler` — no network round-trip on every edit |
| State | `StateManager` singleton | Pub/sub, 100-level undo/redo, canvas-size aware |
| Encoding | zlib + Base64URL | v8 base-36 text blocks, compressed |
| Styling | CSS custom properties | Dark theme, `:root` variables |

### Backend Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Runtime | Bun 1.x | Native `Bun.serve()`, zero middleware |
| Image processing | `sharp` (libvips) | SVG → PNG/WebP/ICO conversion |
| Caching | In-memory LRU (`renderCache`) | 500 entries, 1h TTL |
| Shared caching | Redis / Valkey (optional) | Cross-process render cache + global rate limits |
| Rate limiting | Token bucket / Redis | Per-IP, configurable windows |
| Validation | Custom parser | v3–v8 payload validation |
| Storage | SQLite (optional) | `DOT_DB_PATH` → process-safe gallery + static links (JSON fallback) |

---

## Payload Format (v8)

Icons are encoded as a **text block format**, compressed with **zlib**, then serialized to **Base64URL** (RFC 4648 §5, alphabet `A-Za-z0-9_-`, no padding).

### Preamble

The decompressed payload has the form:

```
v8:<size>:<body>
```

- `v8` — format version
- `<size>` — canvas max coordinate (`15` = 16×16, `31` = 32×32). Self-describing, so a shared icon reopens on the right canvas.
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
| C1 C2 C3 | hex | 0–4095 | 12-bit color: `paletteId<<6 colorIndex` |
| W | base-36 | 0–35 | Line weight |
| OP | base-36 | 0–35 | Opacity (0 = erase/knockout, 35 = opaque) |
| RO | base-36 | 0–35 | Rotation in 10° steps (0°–350°) |
| ZX | base-36 | 0–35 | Z-index (higher = on top) |
| RD | base-36 | 0–35 | Corner radius / arc curvature |

### Base-36 alphabet

Every single-symbol field uses **base-36** (`0-9`, then `a-z`), giving each
field a range of **0–35** instead of hex's 0–15. This lets a single character
address a 32×32 canvas (coords 0–31) and gives effect fields finer control.

### Legacy formats (v3–v7)

v3–v7 remain fully decodable and render identically. Their effect fields (0–15)
are **rescaled to the canonical 0–35 scale** on decode, so all versions share
one rendering pipeline:

- v7 — 17-char blocks, 2-hex coordinates with offset 128 (signed −128..127)
- v6 — 13-char hex blocks (adds RD)
- v5 — 12-char hex blocks (3-hex color)
- v4 — 11-char hex blocks (adds OP/RO/ZX)
- v3 — 8-char hex blocks

> **Note:** v8 and v6 blocks are both 13 characters, so the format version must
> be passed explicitly to disambiguate (same constraint v7's 17-char format had).

### Example

A 32×32 stateless icon of one filled rectangle, decompressed:

```
v8:31:00Rzz0001z000
```

Compressed + Base64URL → a short `/r/...` URL.

---

## Canvas Sizes

| Size | maxCoord | Stateless (hotlink/export)? |
|------|----------|------------------------------|
| 16×16 | 15 | ✅ Yes |
| 32×32 | 31 | ✅ Yes (base-36 coords fit 0–35) |
| 64×64 | 63 | ❌ No — client-only |
| 128×128 | 127 | ❌ No — client-only |

64×64 and 128×128 cannot be encoded into the stateless URL (coordinates exceed
the base-36 range), so their hotlink / export / Gallery-publish options are
disabled in the editor. 16×16 and 32×32 are fully shareable.

---

## API Reference

### `GET /r/:payload`

Render an icon from its encoded payload.

**Path parameters:**
- `payload` — Base64URL-encoded icon data (compressed v3–v8)

**Query parameters:**

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `format` | `svg`, `png`, `webp` | `svg` | Output format |
| `mode` | (empty), `preview`, `favicon` | (empty) | Render mode |
| `bg` | `#RRGGBB` | `#0a0a0c` | Background color (favicon mode) |

**Response:**
- `200` — `image/svg+xml`, `image/png`, or `image/webp`
- `304` — Not Modified (strong ETag based on the render cache key)
- `400` — Invalid payload
- `429` — Rate limit exceeded

**Caching:** `Cache-Control: public, max-age=31536000, immutable` (1 year). A
strong ETag supports conditional revalidation. The LRU cache holds pre-rendered
SVGs; PNG/WebP are cached after first render. With Redis configured, results are
shared across processes.

### `GET /raw/:payload`

Same as `/r/:payload` but accepts the **uncompressed** (human-readable) text
payload (e.g. `v8:31:00Rzz0001z000`). Useful for debugging and manual construction.

### `GET /favicon/:payload`

Returns a multi-resolution ICO (16/32/48px). Optional `?bg=#RRGGBB`.

### `GET /i/:payload`

Static share page with OpenGraph/Twitter meta tags (Discord/Facebook/Twitter embeds).

### `GET /p/:id` & `GET /o/:id`

Public preview and owner-edit pages for static links.

### `GET /api/gallery`

Returns the public gallery (paginated) as a JSON array.

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

Supports `?sort=` and `?search=` / hashtag (`#tag`) filtering.

### `POST /api/gallery`

Publish an icon to the public gallery.

```json
{
  "payload": "A...",
  "title": "My Icon"
}
```

**Response:** `201 Created` | `400 Bad Request` | `429 Too Many Requests`

Admin auth (GitHub OAuth) enables `PATCH /api/gallery/:id` (rename) and
`DELETE /api/gallery/:id`.

### `POST /api/batch`

Render up to 20 icons in one request (`format`: svg/png/webp).

### `GET /api/health` & `GET /api/metrics`

Health and runtime metrics. Metrics report `features: { redis, sqlite }`.

### `GET /api/docs`

Returns this documentation as raw Markdown (`text/markdown`).

---

## Editor Usage

### Drawing Tools

| Tool | Key | Description |
|------|-----|-------------|
| Line | `1` | Round-cap line |
| Line (square) | — | Square-cap line |
| Line (flat) | — | Butt-cap line |
| Rectangle | `2` | Rectangle (optional rounded corners via Radius) |
| Circle | `3` | Circle inscribed in the drag box |
| Triangle | `4` | Isosceles triangle |
| Arc | `5` | Round-cap arc |
| Arc (square) / Arc (flat) | — | Arc cap variants |
| Move | — | Click to select, drag to move, drag empty space to marquee-select |

### Shape Properties

Each shape has adjustable properties (set BEFORE drawing, or applied to the
current **selection**):

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

**Recolor selection:** with figures selected (blue bounding box), clicking a
color swatch **recolors the selected figures in place** instead of only setting
the next-drawing color.

### Selection & Editing

- Click a shape (Move tool) to select; Shift-click for multi-select; drag on empty space for a marquee box.
- Selected figures show a bounding box with resize + rotate handles.
- `Ctrl+C` copy, `Ctrl+V` paste, `Ctrl+D` duplicate.
- `Delete` removes the selection (or the last figure).
- Erase mode (`opacity = 0`) punches a knockout hole through **underlying**
  figures only (layer-aware), not figures drawn above the eraser.

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

Paste a link (`/r/...` or `/raw/...`) or a raw payload into the import field to
load an existing icon. v8 payloads restore the correct canvas size automatically.

---

## Keyboard Shortcuts

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

## Color System

The 12-bit color value (`C1C2C3`) encodes **16 palettes × 64 colors** = 4096
slots: `paletteId (4 bits) << 6 | colorIndex (6 bits)`. The editor shows a
palette selector bar and a 64-color grid per palette. Legacy 8-bit payloads
(paletteId 0) remain compatible.

---

## Security

- **No user input stored** — state lives in the URL or client-side memory
- **Rate limiting** — token/Redis buckets per IP; stricter limits for CPU-heavy bitmap (`png`/`webp`/`favicon`) rendering
- **Payload validation** — v3–v8 block parsing with bounds checking; malformed payloads return 400
- **Optional auth** — GitHub OAuth + JWT sessions for admin (gallery/docs moderation); admin-only routes check cookie or Bearer token
- **CSP & security headers** — page, asset, and API header sets
- **File/DB mutex** — concurrent-write protection for JSON fallback (`gallery.json`, `staticLinks.json`)
- **Redis timeout guard** — all Redis calls are bounded (1.5s) so a dead Redis degrades gracefully instead of hanging requests

---

## Development

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
    ├── toolEndings.ts # Line/arc caps + arrowheads + strokeWidth
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
