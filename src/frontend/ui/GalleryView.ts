import { fetchAuthStatus, type AuthUser } from '../logic/authClient';

interface GalleryEntry {
  id: string;
  payload: string;
  title: string;
  createdAt: number;
}

type SortMode = 'newest' | 'oldest' | 'title-asc' | 'title-desc';

/** Sorts a copy of the entries according to the given mode. */
function sortEntries(entries: GalleryEntry[], mode: SortMode): GalleryEntry[] {
  const sorted = [...entries];
  switch (mode) {
    case 'newest':
      sorted.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'oldest':
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'title-asc':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'title-desc':
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
  }
  return sorted;
}

/**
 * Filters entries by a free-text query. The query can contain plain words
 * (matched against the title/name) and hashtags (e.g. `#logo`), which are
 * matched against hashtags stored in the title. Every token must match.
 */
function filterEntries(entries: GalleryEntry[], query: string): GalleryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;

  // Split into hashtags (#logo) and plain words, preserving the rest.
  const hashtags: string[] = [];
  const words: string[] = [];
  for (const token of q.split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith('#')) hashtags.push(token.slice(1));
    else words.push(token);
  }

  return entries.filter((e) => {
    const titleLower = e.title.toLowerCase();
    // Plain words match anywhere in the name/title.
    for (const w of words) {
      if (!titleLower.includes(w)) return false;
    }
    // Hashtags must be present in the title as `#tag` tokens.
    if (hashtags.length > 0) {
      const titleHashtags = (titleLower.match(/#[\w-]+/g) ?? []).map((h) => h.slice(1));
      for (const tag of hashtags) {
        if (!titleHashtags.includes(tag)) return false;
      }
    }
    return true;
  });
}

/**
 * Public icon gallery - fetches published icons from `/api/gallery`
 * and renders them in a responsive grid. Icons are submitted via
 * the "Publish to Gallery" button in ExportModal.
 */
export class GalleryView {
  private sortMode: SortMode = 'newest';
  private query: string = '';
  private currentUser: AuthUser | null = null;
  private grid: HTMLElement | null = null;

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'gallery-view';

    const header = document.createElement('div');
    header.className = 'gallery-header';

    const title = document.createElement('h1');
    title.textContent = 'Public Gallery';

    // Search box - filters by name and by hashtags (#tag) stored in the title.
    const searchWrap = document.createElement('label');
    searchWrap.className = 'gallery-search';
    searchWrap.textContent = 'Search: ';
    const searchInput = document.createElement('input');
    searchInput.className = 'gallery-search-input';
    searchInput.type = 'search';
    searchInput.placeholder = 'name or #tag...';
    searchInput.value = this.query;
    searchInput.oninput = () => {
      this.query = searchInput.value;
      this.renderGrid(grid, this.entries);
    };
    searchWrap.appendChild(searchInput);

    // Sort control (dropdown)
    const sortWrap = document.createElement('label');
    sortWrap.className = 'gallery-sort';
    sortWrap.textContent = 'Sort: ';
    const sortSelect = document.createElement('select');
    sortSelect.className = 'gallery-sort-select';
    const options: Array<{ value: SortMode; label: string }> = [
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'title-asc', label: 'Title A–Z' },
      { value: 'title-desc', label: 'Title Z–A' },
    ];
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      if (opt.value === this.sortMode) el.selected = true;
      sortSelect.appendChild(el);
    });
    sortSelect.onchange = () => {
      this.sortMode = sortSelect.value as SortMode;
      // Re-render the grid with the new order.
      this.renderGrid(grid, this.entries);
    };
    sortWrap.appendChild(sortSelect);

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-secondary';
    backBtn.textContent = '← Back';
    backBtn.onclick = () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }));

    header.append(title, searchWrap, sortWrap, backBtn);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    container.append(header, grid);

    this.grid = grid;
    this.loadEntries(grid);
    this.loadAuth();

    return container;
  }

  private async loadAuth() {
    const status = await fetchAuthStatus();
    this.currentUser = status.user;
    if (this.grid && this.entries.length > 0) this.renderGrid(this.grid, this.entries);
  }

  private entries: GalleryEntry[] = [];

  /** Renders (or re-renders) the grid from `this.entries`, applying the sort. */
  private renderGrid(grid: HTMLElement, entries: GalleryEntry[]) {
    const filtered = filterEntries(entries, this.query);
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="gallery-empty">No icons match your search.</p>';
      return;
    }
    grid.innerHTML = '';
    const sorted = sortEntries(filtered, this.sortMode);
    sorted.forEach(entry => grid.appendChild(this.renderItem(entry)));
  }

  private async loadEntries(grid: HTMLElement) {
    grid.innerHTML = '<p class="gallery-empty">Loading...</p>';

    try {
      const res = await fetch('/api/gallery');
      const data = await res.json();
      this.entries = data.entries ?? [];

      this.renderGrid(grid, this.entries);
    } catch {
      grid.innerHTML = '<p class="gallery-empty">Failed to load gallery.</p>';
    }
  }

private renderItem(entry: GalleryEntry): HTMLElement {
    const item = document.createElement('div');
    item.className = 'gallery-item';

    const fullUrl = `/r/${entry.payload}`;

    const img = document.createElement('img');
    img.src = fullUrl;
    img.alt = entry.title;
    img.loading = 'lazy';
    img.style.cursor = 'pointer'; // Signal that image is clickable

    // Click on image opens modal
    img.onclick = () => this.openImageModal(fullUrl, entry.title);

    const label = document.createElement('span');
    label.textContent = entry.title;

    item.append(img, label);

    // Admin-only moderation controls (rename / delete).
    if (this.currentUser?.isAdmin) {
      const adminBar = document.createElement('div');
      adminBar.className = 'gallery-admin-bar';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn-secondary gallery-admin-btn';
      renameBtn.textContent = 'Rename';
      renameBtn.onclick = async () => {
        const newTitle = prompt('New title:', entry.title);
        if (newTitle == null || newTitle.trim() === '') return;
        const res = await fetch(`/api/gallery/${encodeURIComponent(entry.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (res.ok && this.grid) {
          this.entries = this.entries.map(e => e.id === entry.id ? { ...e, title: newTitle.trim() } : e);
          this.renderGrid(this.grid, this.entries);
        }
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-danger gallery-admin-btn';
      delBtn.textContent = 'Delete';
      delBtn.onclick = async () => {
        if (!confirm(`Delete "${entry.title}"?`)) return;
        const res = await fetch(`/api/gallery/${encodeURIComponent(entry.id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok && this.grid) {
          this.entries = this.entries.filter(e => e.id !== entry.id);
          this.renderGrid(this.grid, this.entries);
        }
      };

      adminBar.append(renameBtn, delBtn);
      item.appendChild(adminBar);
    }

    return item;
  }

  private openImageModal(url: string, title: string) {
    // 1. Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'image-modal-overlay';
    
    // Click on background closes modal
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    };

    // 2. Modal content container
    const content = document.createElement('div');
    content.className = 'image-modal-content';

    // 3. Enlarged image
    const img = document.createElement('img');
    img.src = url+'?mode=preview';
    img.alt = title;

    // 4. URL bar with copy button
    const urlBar = document.createElement('div');
    urlBar.className = 'image-modal-url-bar';

    const urlText = document.createElement('span');
    urlText.className = 'url-text';
    // Truncate URL to 32 chars, add "..." if longer
    urlText.textContent = url.length > 32 ? url.substring(0, 32) + '...' : url;
    urlText.title = url; // Full URL visible on hover

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy';
    copyBtn.textContent = 'Copy URL';
    copyBtn.onclick = async () => {
      try {
        // Copy full absolute URL to clipboard
        const absoluteUrl = new URL(url, window.location.origin).href;
        await navigator.clipboard.writeText(absoluteUrl+'?mode=preview');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
      } catch (err) {
        console.error('Copy error:', err);
      }
    };

    urlBar.append(urlText, copyBtn);
    content.append(img, urlBar);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }
}
