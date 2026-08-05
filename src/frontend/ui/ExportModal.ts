import { stateManager } from '../logic/stateManager';
import { encodeState, encodeStateRaw } from '../logic/encoder';
import { encodeCommittedState } from '../logic/encodeMemo';
import { renderCommittedSvgString } from '../logic/committedRenderer';

/** Copies text to clipboard with a graceful fallback for non-secure contexts. */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error('clipboard unavailable');
  } catch {
    // Fallback: hidden textarea + execCommand (works on http/non-secure).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export class ExportModal {
  render(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = (e: MouseEvent) => {
      if (e.target === overlay) overlay.remove();
    };

    const content = document.createElement('div');
    content.className = 'modal-content';

    const title = document.createElement('h2');
    title.textContent = 'Export Icon';

    // 16×16 and 32×32 are stateless (fit base-36 coord range) → full hotlink.
    // 64/128 are client-only: no backend hotlink, but they CAN be shared as a
    // RAW (uncompressed text) link which the editor can export/import.
    const stateless = stateManager.isStateless();
    const payload = stateless ? encodeCommittedState() : '';
    const rawPayload = encodeStateRaw(stateManager.committedFigures, stateManager.canvasSize);
    const url = payload ? `${window.location.origin}/r/${payload}` : '';
    const rawUrl = rawPayload ? `${window.location.origin}/raw/${rawPayload}` : '';
    const faviconUrl = payload ? `${window.location.origin}/favicon/${payload}` : '';

    // Sekcja podglądów: duży + favicon 16×16
    const previewSection = document.createElement('div');
    previewSection.className = 'export-previews';

    const preview = document.createElement('img');
    preview.className = 'export-preview';
    if (stateless) {
      preview.src = url;
    } else {
      // Client-side SVG data URL – no backend round-trip.
      preview.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(renderCommittedSvgString());
    }
    preview.alt = 'Icon preview';

    const faviconPreview = document.createElement('img');
    faviconPreview.className = 'export-favicon-preview';
    if (stateless) {
      faviconPreview.src = faviconUrl;
    } else {
      faviconPreview.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(renderCommittedSvgString());
    }
    faviconPreview.alt = 'Favicon preview 16×16';
    faviconPreview.width = 16;
    faviconPreview.height = 16;

    previewSection.append(preview, faviconPreview);

    // Info o formacie v8
    const v4Figures = stateManager.committedFigures.filter(
      f => f.opacity !== 35 || f.rotation !== 0 || f.zIndex !== 0
    );
    const formatInfo = document.createElement('p');
    formatInfo.className = 'export-format-info';
    if (v4Figures.length > 0) {
      formatInfo.textContent = `Format v4 · ${v4Figures.length} figures with effects (opacity/rotation/layer)`;
    } else {
      formatInfo.textContent = `Format v3 · ${stateManager.committedFigures.length} figures`;
    }

    const hotlinkInput = document.createElement('input');
    hotlinkInput.className = 'input-field';
    hotlinkInput.value = url;
    hotlinkInput.readOnly = true;
    if (!stateless) hotlinkInput.disabled = true;

    // Client-only notice (64/128 canvases).
    const notice = document.createElement('p');
    notice.className = 'export-client-only';
    notice.style.cssText = 'font-size:0.82rem;color:#f59e0b;margin:0.25rem 0;';
    if (!stateless) {
      notice.textContent = `This ${stateManager.maxCoord + 1}×${stateManager.maxCoord + 1} canvas is client-only – backend hotlink, favicon and Gallery publish are disabled. Use the RAW link below to save / re-import the project.`;
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const copyUrlBtn = document.createElement('button');
    copyUrlBtn.className = 'btn-primary';
    copyUrlBtn.textContent = 'Copy Hotlink';
    copyUrlBtn.disabled = !stateless;
    copyUrlBtn.title = stateless ? '' : 'Hotlink is disabled for client-only canvases';
    copyUrlBtn.onclick = () => {
      copyText(hotlinkInput.value);
      copyUrlBtn.textContent = 'Copied!';
      setTimeout(() => (copyUrlBtn.textContent = 'Copy Hotlink'), 2000);
    };

    const copySvgBtn = document.createElement('button');
    copySvgBtn.className = 'btn-primary';
    copySvgBtn.textContent = 'Copy SVG Code';
    copySvgBtn.onclick = async () => {
      let svgText: string;
      if (stateless) {
        const res = await fetch(url);
        svgText = await res.text();
      } else {
        svgText = renderCommittedSvgString();
      }
      await copyText(svgText);
      copySvgBtn.textContent = 'Copied!';
      setTimeout(() => (copySvgBtn.textContent = 'Copy SVG Code'), 2000);
    };

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-primary';
    downloadBtn.textContent = 'Download SVG File';
    downloadBtn.onclick = async () => {
      let blob: Blob;
      if (stateless) {
        const res = await fetch(url);
        blob = await res.blob();
      } else {
        blob = new Blob([renderCommittedSvgString()], { type: 'image/svg+xml' });
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'icon.svg';
      a.click();
      URL.revokeObjectURL(objectUrl);
    };

    const downloadPngBtn = document.createElement('button');
    downloadPngBtn.className = 'btn-primary';
    downloadPngBtn.textContent = 'Download PNG';
    downloadPngBtn.disabled = !stateless;
    downloadPngBtn.title = stateless ? '' : 'PNG export requires the backend (disabled for client-only canvases)';
    downloadPngBtn.onclick = async () => {
      const pngUrl = `${url}?format=png`;
      const res = await fetch(pngUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'icon.png';
      a.click();
      URL.revokeObjectURL(objectUrl);
    };

    const copyFaviconSvgBtn = document.createElement('button');
    copyFaviconSvgBtn.className = 'btn-primary';
    copyFaviconSvgBtn.textContent = 'Copy <link> Tag for SVG Favicon';
    copyFaviconSvgBtn.disabled = !stateless;
    copyFaviconSvgBtn.title = stateless ? '' : 'Favicon requires the backend (disabled for client-only canvases)';
    copyFaviconSvgBtn.onclick = () => {
      const faviconSvgUrl = payload ? `${window.location.origin}/r/${payload}?favicon=1` : '';
      const tag = `<link rel="icon" type="image/svg+xml" href="${faviconSvgUrl}">`;
      copyText(tag);
      copyFaviconSvgBtn.textContent = 'Copied!';
      setTimeout(() => (copyFaviconSvgBtn.textContent = 'Copy <link> Tag for SVG Favicon'), 2000);
    };

    const copyFaviconIcoBtn = document.createElement('button');
    copyFaviconIcoBtn.className = 'btn-primary';
    copyFaviconIcoBtn.textContent = 'Copy Favicon ICO URL';
    copyFaviconIcoBtn.disabled = !stateless;
    copyFaviconIcoBtn.title = stateless ? '' : 'Favicon requires the backend (disabled for client-only canvases)';
    copyFaviconIcoBtn.onclick = () => {
      copyText(faviconUrl);
      copyFaviconIcoBtn.textContent = 'Copied!';
      setTimeout(() => (copyFaviconIcoBtn.textContent = 'Copy Favicon ICO URL'), 2000);
    };

    // Sekcja RAW (nieskompresowany link)
    const rawSection = document.createElement('div');
    rawSection.style.marginTop = '1rem';
    rawSection.style.width = '100%';

    const rawLabel = document.createElement('p');
    rawLabel.style.fontSize = '0.8rem';
    rawLabel.style.color = '#64748b';
    rawLabel.style.marginBottom = '0.25rem';
    rawLabel.textContent = 'RAW Link (uncompressed – view structure directly)';

    const rawInput = document.createElement('input');
    rawInput.className = 'input-field';
    rawInput.value = rawUrl;
    rawInput.readOnly = true;
    rawInput.style.fontSize = '0.75rem';
    rawInput.style.opacity = '0.7';

    const copyRawBtn = document.createElement('button');
    copyRawBtn.className = 'btn-primary';
    copyRawBtn.textContent = 'Copy RAW Link';
    copyRawBtn.style.fontSize = '0.8rem';
    copyRawBtn.style.padding = '0.35rem 0.75rem';
    copyRawBtn.onclick = () => {
      copyText(rawInput.value);
      copyRawBtn.textContent = 'Copied!';
      setTimeout(() => (copyRawBtn.textContent = 'Copy RAW Link'), 2000);
    };

    rawSection.append(rawLabel, rawInput, copyRawBtn);

    const publishBtn = document.createElement('button');
    publishBtn.className = 'btn-primary';
    publishBtn.textContent = 'Publish to Gallery';
    publishBtn.disabled = !stateless;
    publishBtn.title = stateless ? '' : 'Gallery publish requires the backend (disabled for client-only canvases)';
    publishBtn.onclick = async () => {
      const iconTitle = window.prompt('Enter icon name (optional):', '') ?? '';
      try {
        const res = await fetch('/api/gallery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, title: iconTitle }),
        });
        if (res.ok) {
          publishBtn.textContent = 'Published!';
        } else {
          const data = await res.json().catch(() => ({}));
          publishBtn.textContent = data.error ? `Error: ${data.error}` : 'Failed to publish';
        }
      } catch {
        publishBtn.textContent = 'Connection error';
      }
      setTimeout(() => (publishBtn.textContent = 'Publish to Gallery'), 3000);
    };

    actions.append(copyUrlBtn, copySvgBtn, downloadBtn, downloadPngBtn, copyFaviconSvgBtn, copyFaviconIcoBtn, publishBtn, rawSection);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-delete';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '1.5rem';
    closeBtn.onclick = () => overlay.remove();

    content.append(title, previewSection, formatInfo, notice, hotlinkInput, actions, closeBtn);
    overlay.appendChild(content);
    
    return overlay;
  }
}
