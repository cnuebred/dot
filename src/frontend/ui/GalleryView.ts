interface GalleryEntry {
  id: string;
  payload: string;
  title: string;
  createdAt: number;
}

/**
 * Public icon gallery - fetches published icons from `/api/gallery`
 * and renders them in a responsive grid. Icons are submitted via
 * the "Publish to Gallery" button in ExportModal.
 */
export class GalleryView {
  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'gallery-view';

    const header = document.createElement('div');
    header.className = 'gallery-header';

    const title = document.createElement('h1');
    title.textContent = 'Public Gallery';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-secondary';
    backBtn.textContent = '← Back';
    backBtn.onclick = () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }));

    header.append(title, backBtn);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    container.append(header, grid);

    this.loadEntries(grid);

    return container;
  }

  private async loadEntries(grid: HTMLElement) {
    grid.innerHTML = '<p class="gallery-empty">Loading...</p>';

    try {
      const res = await fetch('/api/gallery');
      const data = await res.json();
      const entries: GalleryEntry[] = data.entries ?? [];

      if (entries.length === 0) {
        grid.innerHTML = '<p class="gallery-empty">Gallery is empty. Be the first!</p>';
        return;
      }

      grid.innerHTML = '';
      entries.forEach(entry => grid.appendChild(this.renderItem(entry)));
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
