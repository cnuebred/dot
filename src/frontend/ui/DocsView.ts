/**
 * DocsView – fetches Markdown from /api/docs and renders it as HTML
 * using a built-in lightweight parser (no external libraries).
 */
export class DocsView {
  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'docs-view';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'docs-header';

    const title = document.createElement('h1');
    title.textContent = 'Documentation';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-secondary';
    backBtn.textContent = '← Back';
    backBtn.onclick = () =>
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }));

    header.append(title, backBtn);

    // --- Content ---
    const content = document.createElement('div');
    content.className = 'docs-content';

    container.append(header, content);

    this.loadDocs(content);

    return container;
  }

  private async loadDocs(container: HTMLElement): Promise<void> {
    container.innerHTML = '<p class="docs-loading">Loading documentation…</p>';

    try {
      const res = await fetch('/api/docs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const markdown = await res.text();
      container.innerHTML = DocsView.parseMarkdown(markdown);
    } catch {
      container.innerHTML =
        '<p class="docs-error">Failed to load documentation.</p>';
    }
  }

  // ---------------------------------------------------------------
  // Simple Markdown → HTML parser (no external dependencies)
  // ---------------------------------------------------------------
  static parseMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const raw = lines[i]!;

      // --- Blok kodu (```) ---
      if (raw.startsWith('```')) {
        const lang = raw.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i]!.startsWith('```')) {
          codeLines.push(DocsView.escapeHtml(lines[i]!));
          i++;
        }
        i++; // pomiń zamykające ```
        const langAttr = lang ? ` class="language-${DocsView.escapeHtml(lang)}"` : '';
        out.push(`<pre><code${langAttr}>${codeLines.join('\n')}</code></pre>`);
        continue;
      }

      // --- Pusta linia ---
      if (raw.trim() === '') {
        i++;
        continue;
      }

      // --- Nagłówki ---
      const headingMatch = raw.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const text = DocsView.parseInline(headingMatch[2]!);
        out.push(`<h${level}>${text}</h${level}>`);
        i++;
        continue;
      }

      // --- Lista nieuporządkowana (- lub *) ---
      if (/^[\-\*]\s+/.test(raw)) {
        out.push('<ul>');
        while (i < lines.length && /^[\-\*]\s+/.test(lines[i]!)) {
          const itemText = lines[i]!.replace(/^[\-\*]\s+/, '');
          out.push(`<li>${DocsView.parseInline(itemText)}</li>`);
          i++;
        }
        out.push('</ul>');
        continue;
      }

      // --- Lista uporządkowana (1. ) ---
      if (/^\d+\.\s+/.test(raw)) {
        out.push('<ol>');
        while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
          const itemText = lines[i]!.replace(/^\d+\.\s+/, '');
          out.push(`<li>${DocsView.parseInline(itemText)}</li>`);
          i++;
        }
        out.push('</ol>');
        continue;
      }

      // --- Linia pozioma ---
      if (/^(\-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // --- Tabela (linie zaczynające się od |, z separatorem w drugiej linii) ---
      if (raw.startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1]!.trim())) {
        const headerLine = raw;
        const sepLine = lines[i + 1]!;
        i += 2;

        const headers = DocsView.parseTableRow(headerLine);
        const alignments = DocsView.parseTableAlignments(sepLine);

        out.push('<table>');
        out.push('<thead><tr>');
        for (let h = 0; h < headers.length; h++) {
          const align = alignments[h] ? ` style="text-align:${alignments[h]}"` : '';
          out.push(`<th${align}>${DocsView.parseInline(headers[h]!)}</th>`);
        }
        out.push('</tr></thead>');

        out.push('<tbody>');
        while (i < lines.length && lines[i]!.startsWith('|')) {
          const cells = DocsView.parseTableRow(lines[i]!);
          out.push('<tr>');
          for (let c = 0; c < cells.length; c++) {
            const align = alignments[c] ? ` style="text-align:${alignments[c]}"` : '';
            out.push(`<td${align}>${DocsView.parseInline(cells[c]!)}</td>`);
          }
          out.push('</tr>');
          i++;
        }
        out.push('</tbody></table>');
        continue;
      }

      // --- Paragraf (zbieraj kolejne linie aż do pustej) ---
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.trim() !== '' &&
        !lines[i]!.startsWith('```') &&
        !/^(#{1,6})\s+/.test(lines[i]!) &&
        !/^[\-\*]\s+/.test(lines[i]!) &&
        !/^\d+\.\s+/.test(lines[i]!) &&
        !/^(\-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!)
      ) {
        paraLines.push(lines[i]!);
        i++;
      }
      if (paraLines.length > 0) {
        out.push(`<p>${DocsView.parseInline(paraLines.join(' '))}</p>`);
      }
    }

    return out.join('\n');
  }

  /** Parses a table row: "| a | b |" → ["a", "b"] */
  private static parseTableRow(line: string): string[] {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim());
  }

  /** Parses table separator: "|:---|:---:|---:|" → ["left","center","right"] */
  private static parseTableAlignments(sepLine: string): string[] {
    return DocsView.parseTableRow(sepLine).map(cell => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });
  }

  /** Parses inline elements: bold, italic, code, links, images */
  private static parseInline(text: string): string {
    let result = DocsView.escapeHtml(text);

    // Images ![alt](url)
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // Links [text](url)
    result = result.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bold **text** or __text__
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic *text* or _text_
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/_(.+?)_/g, '<em>$1</em>');

    // Inline code `text`
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

    return result;
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}