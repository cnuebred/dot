import { stateManager } from '../logic/stateManager';
import { encodeState, encodeStateRaw } from '../logic/encoder';

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

    const payload = encodeState(stateManager.committedFigures);
    const rawPayload = encodeStateRaw(stateManager.committedFigures);
    const url = payload ? `${window.location.origin}/r/${payload}` : '';
    const rawUrl = rawPayload ? `${window.location.origin}/raw/${rawPayload}` : '';
    const faviconUrl = payload ? `${window.location.origin}/favicon/${payload}` : '';

    // Sekcja podglądów: duży + favicon 16×16
    const previewSection = document.createElement('div');
    previewSection.className = 'export-previews';

    const preview = document.createElement('img');
    preview.className = 'export-preview';
    preview.src = url;
    preview.alt = 'Icon preview';

    const faviconPreview = document.createElement('img');
    faviconPreview.className = 'export-favicon-preview';
    faviconPreview.src = faviconUrl;
    faviconPreview.alt = 'Favicon preview 16×16';
    faviconPreview.width = 16;
    faviconPreview.height = 16;

    previewSection.append(preview, faviconPreview);

    // Info o formacie v4
    const v4Figures = stateManager.committedFigures.filter(
      f => f.opacity !== 15 || f.rotation !== 0 || f.zIndex !== 0
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

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const copyUrlBtn = document.createElement('button');
    copyUrlBtn.className = 'btn-primary';
    copyUrlBtn.textContent = 'Copy Hotlink';
    copyUrlBtn.onclick = () => {
      navigator.clipboard.writeText(hotlinkInput.value);
      copyUrlBtn.textContent = 'Copied!';
      setTimeout(() => (copyUrlBtn.textContent = 'Copy Hotlink'), 2000);
    };

    const copySvgBtn = document.createElement('button');
    copySvgBtn.className = 'btn-primary';
    copySvgBtn.textContent = 'Copy SVG Code';
    copySvgBtn.onclick = async () => {
      const res = await fetch(url);
      const svgText = await res.text();
      await navigator.clipboard.writeText(svgText);
      copySvgBtn.textContent = 'Copied!';
      setTimeout(() => (copySvgBtn.textContent = 'Copy SVG Code'), 2000);
    };

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-primary';
    downloadBtn.textContent = 'Download SVG File';
    downloadBtn.onclick = async () => {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'icon.svg';
      a.click();
      URL.revokeObjectURL(objectUrl);
    };

    const copyFaviconSvgBtn = document.createElement('button');
    copyFaviconSvgBtn.className = 'btn-primary';
    copyFaviconSvgBtn.textContent = 'Copy <link> Tag for SVG Favicon';
    copyFaviconSvgBtn.onclick = () => {
      const faviconSvgUrl = payload ? `${window.location.origin}/r/${payload}?favicon=1` : '';
      const tag = `<link rel="icon" type="image/svg+xml" href="${faviconSvgUrl}">`;
      navigator.clipboard.writeText(tag);
      copyFaviconSvgBtn.textContent = 'Copied!';
      setTimeout(() => (copyFaviconSvgBtn.textContent = 'Copy <link> Tag for SVG Favicon'), 2000);
    };

    const copyFaviconIcoBtn = document.createElement('button');
    copyFaviconIcoBtn.className = 'btn-primary';
    copyFaviconIcoBtn.textContent = 'Copy Favicon ICO URL';
    copyFaviconIcoBtn.onclick = () => {
      navigator.clipboard.writeText(faviconUrl);
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
      navigator.clipboard.writeText(rawInput.value);
      copyRawBtn.textContent = 'Copied!';
      setTimeout(() => (copyRawBtn.textContent = 'Copy RAW Link'), 2000);
    };

    rawSection.append(rawLabel, rawInput, copyRawBtn);

    const publishBtn = document.createElement('button');
    publishBtn.className = 'btn-primary';
    publishBtn.textContent = 'Publish to Gallery';
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

    actions.append(copyUrlBtn, copySvgBtn, downloadBtn, copyFaviconSvgBtn, copyFaviconIcoBtn, publishBtn, rawSection);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-delete';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '1.5rem';
    closeBtn.onclick = () => overlay.remove();

    content.append(title, previewSection, formatInfo, hotlinkInput, actions, closeBtn);
    overlay.appendChild(content);
    
    return overlay;
  }
}
