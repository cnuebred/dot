export function getFallbackSvg(faviconBackground?: string): string {
  const bg = faviconBackground || '#fee2e2';
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <rect width="16" height="16" fill="${bg}" />
  <path d="M4 4L12 12M12 4L4 12" stroke="#ef4444" stroke-width="1" stroke-linecap="round" />
</svg>`;
}