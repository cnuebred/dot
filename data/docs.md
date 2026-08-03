# dot.qrware.pl — Technical Documentation

## Overview

**dot.qrware.pl** is a stateless, zero-dependency SVG icon generator. Draw pixel-perfect icons on a 16×16 grid, encode them into a compact Base64URL payload, and embed them directly in a URL — no accounts, no databases, no server-side state.

Every icon is fully self-contained in its URL. Share it, bookmark it, embed it in `<img>` tags — it just works.
Discord Server: [dot.qrware.pl](https://discord.gg/Bm6sWcTCMC)
Github: [cnuebred/dot](https://github.com/cnuebred/dot)
---

## Architecture

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

### Frontend Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Language | TypeScript 5.x | Strict mode, no `any` |
| Bundler | Vite 5.x | ES modules, HMR, tree-shaking |
| Rendering | Canvas 2D API | Custom grid renderer, no libraries |
| State | `StateManager` class | Immutable snapshots, 50-level undo |
| Encoding | Custom bit-packer | 4-bit fields, Base64URL alphabet |
| Styling | CSS custom properties | Dark theme, `:root` variables |

### Backend Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Runtime | Bun 1.x | Native `Bun.serve()`, zero middleware |
| Image processing | `sharp` (libvips) | SVG → PNG/WebP/ICO conversion |
| Caching | In-memory LRU | 1000 entries, TTL-based eviction |
| Rate limiting | Token bucket | Per-IP, configurable refill rate |
| Validation | Custom decoder | Bit-level payload validation |
| Storage | JSON files | `data/gallery.json`, `data/staticLinks.json` |

---

## Payload Format (Binary Specification)

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

Each shape consumes a fixed number of bits depending on the version. For version 0:

| Field | Bits | Range | Description |
|-------|------|-------|-------------|
| Type | 3 | 0–7 | 0=line, 1=rect, 2=circle, 3=triangle, 4=arc, 5=move |
| X1 | 4 | 0–15 | Start X coordinate |
| Y1 | 4 | 0–15 | Start Y coordinate |
| X2 | 4 | 0–15 | End X coordinate |
| Y2 | 4 | 0–15 | End Y coordinate |
| Color index | 6 | 0–63 | Index into 64-color palette |
| Stroke width | 4 | 0–15 | Line thickness in grid units |
| Opacity | 4 | 0–15 | 0=transparent, 15=opaque |
| Rotation | 4 | 0–15 | Multiplied by 22.5° (0–337.5°) |
| Z-index | 4 | 0–15 | Layer ordering (higher = on top) |
| Fill | 1 | 0–1 | 0=stroke only, 1=filled |

**Total per shape: 42 bits** → 7 Base64URL characters.

### Example

A simple 2-shape icon (circle + line) with default background:

```
Payload: A... (header) + .. (bg) + ...... (shape 1) + ...... (shape 2)
Total: ~15–20 characters for simple icons, ~100 for complex ones.
```

---

## API Reference

### `GET /r/:payload`

Render an icon from its encoded payload.

**Path parameters:**
- `payload` — Base64URL-encoded icon data

**Query parameters:**

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `format` | `svg`, `png`, `webp` | `svg` | Output format |
| `mode` | (empty), `preview`, `favicon` | (empty) | Render mode |
| `bg` | `#RRGGBB` | `#ffffff` | Background color (favicon mode) |
| `size` | integer | 512 | Output size in pixels (PNG/WebP) |

**Response:**
- `200` — `image/svg+xml`, `image/png`, or `image/webp`
- `400` — Invalid payload
- `429` — Rate limit exceeded

**Caching:** Responses include `Cache-Control: public, max-age=31536000, immutable` (1 year). The LRU cache holds pre-rendered SVGs; PNG/WebP are cached after first render.

### `GET /raw/:payload`

Same as `/r/:payload` but accepts an **uncompressed** (human-readable) payload format. Useful for debugging and manual construction.

### `GET /api/gallery`

Returns the public gallery as a JSON array.

**Response:** `200 OK`
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

**Request body:**
```json
{
  "payload": "A...",
  "title": "My Icon"
}
```

**Response:** `201 Created` | `400 Bad Request` | `429 Too Many Requests`

### `GET /api/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "1.0.0",
  "formatVersion": 0
}
```

### `GET /api/metrics`

Runtime metrics (counters reset on restart).

**Response:**
```json
{
  "requests": { "total": 15000, "svg": 10000, "png": 4000, "webp": 1000 },
  "errors": { "4xx": 120, "5xx": 3 },
  "cache": { "hits": 8500, "misses": 1500, "size": 847, "maxSize": 1000 },
  "renderTimeAvg": 2.3
}
```

### `GET /api/docs`

Returns this documentation as raw Markdown (`text/markdown`).

---

## Editor Usage

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

Each shape has the following adjustable properties (set BEFORE drawing):

| Property | Range | Description |
|----------|-------|-------------|
| Stroke Width | 0–15 | Line thickness in grid units |
| Fill | on/off | Toggle between outlined and filled shapes |
| Color | 0–63 | Index into the 64-color palette |
| Opacity | 0–15 | 0 = fully transparent, 15 = fully opaque |
| Rotation | 0–15 | Rotation angle × 22.5° (0°, 22.5°, 45°, …, 337.5°) |
| Z-Index | 0–15 | Layer ordering; higher values render on top |

### Undo / Redo

The `StateManager` maintains a history stack of up to **50 immutable snapshots**. Each action pushes a new snapshot. Undo pops the stack; redo restores from a parallel redo stack (cleared on new actions).

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

## Keyboard Shortcuts

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

## Color Palette

The 64-color palette is shared between frontend and backend (`src/shared/palette.ts`). Colors are indexed 0–63, arranged in an 8×8 grid in the editor UI. Each color is a 6-digit hex string (e.g. `#ff0000`). The palette includes:

- 8 grayscale steps (black → white)
- 8 red tones
- 8 orange/yellow tones
- 8 green tones
- 8 cyan/teal tones
- 8 blue tones
- 8 purple/magenta tones
- 8 brown/earth tones

---

## Security

- **No user input stored** — all state lives in the URL or client-side memory
- **Rate limiting** — token bucket algorithm, 60 requests/minute per IP for render endpoints, 10/minute for gallery POST
- **Payload validation** — bit-level decoding with bounds checking; malformed payloads return 400
- **No cookies, no sessions** — fully stateless
- **CSP headers** — `Content-Security-Policy` restricts script sources
- **File mutex** — concurrent write protection for `gallery.json` and `staticLinks.json`

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
