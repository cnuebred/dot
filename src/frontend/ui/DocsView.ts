import { fetchAuthStatus, type AuthUser } from '../logic/authClient';

interface DocMeta {
  id: string;
  title: string;
  main: boolean;
}

/**
 * DocsView – fetches the document list and selected document's Markdown from
 * /api/docs and renders it as HTML using a built-in lightweight parser.
 * Admins can edit documents inline (PUT/DELETE via the API).
 *
 * Layout: a left sidebar listing all documents (hamburger menu on mobile),
 * and the content area on the right.
 */
export class DocsView {
  private currentUser: AuthUser | null = null;
  private selectedDoc: string | null = null;
  private docs: DocMeta[] = [];

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'docs-view';

    // --- Header ---
    const header = document.createElement('div');
    header.className = 'docs-header';

    const hamburger = document.createElement('button');
    hamburger.className = 'docs-hamburger';
    hamburger.textContent = '☰';
    hamburger.title = 'Toggle document list';
    hamburger.onclick = () => container.classList.toggle('docs-sidebar-open');

    const title = document.createElement('h1');
    title.textContent = 'Documentation';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-secondary';
    backBtn.textContent = '← Back';
    backBtn.onclick = () =>
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'home' }));

    header.append(hamburger, title, backBtn);

    // --- Layout: sidebar + content ---
    const layout = document.createElement('div');
    layout.className = 'docs-layout';

    const sidebar = document.createElement('nav');
    sidebar.className = 'docs-sidebar';

    const content = document.createElement('div');
    content.className = 'docs-content';

    layout.append(sidebar, content);
    container.append(header, layout);

    // Load auth + docs list + first document.
    this.loadAuth().then(() => {
      this.loadDocs(sidebar, content);
    });

    return container;
  }

  private async loadAuth(): Promise<void> {
    const status = await fetchAuthStatus();
    this.currentUser = status.user;
  }

  /** Fetches the document list and populates the sidebar. */
  private async loadDocs(sidebar: HTMLElement, content: HTMLElement): Promise<void> {
    sidebar.innerHTML = '<p class="docs-loading">Loading…</p>';
    try {
      const res = await fetch('/api/docs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { docs: DocMeta[] };
      this.docs = data.docs ?? [];

      // Build sidebar items.
      sidebar.innerHTML = '';
      const list = document.createElement('ul');
      list.className = 'docs-list';
      this.docs.forEach(doc => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'docs-list-item';
        btn.textContent = doc.title;
        btn.dataset.id = doc.id;
        btn.onclick = () => {
          this.selectedDoc = doc.id;
          this.highlightSidebar(sidebar, doc.id);
          this.loadDoc(content, doc.id);
          // Close sidebar on mobile after selection.
          content.closest('.docs-view')?.classList.remove('docs-sidebar-open');
        };
        li.appendChild(btn);
        list.appendChild(li);
      });
      sidebar.appendChild(list);

      // Admin: "New document" button.
      if (this.currentUser?.isAdmin) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-primary docs-add-btn';
        addBtn.textContent = '+ New document';
        addBtn.onclick = () => this.newDoc(content);
        sidebar.appendChild(addBtn);
      }

      // Load the first document (or an empty state).
      const firstId = this.docs[0]?.id;
      if (firstId) {
        this.selectedDoc = firstId;
        this.highlightSidebar(sidebar, firstId);
        this.loadDoc(content, firstId);
      } else {
        content.innerHTML = '<p class="docs-error">No documents available.</p>';
      }
    } catch {
      sidebar.innerHTML = '';
      content.innerHTML = '<p class="docs-error">Failed to load documentation.</p>';
    }
  }

  private highlightSidebar(sidebar: HTMLElement, id: string) {
    sidebar.querySelectorAll('.docs-list-item').forEach(el => {
      const on = (el as HTMLElement).dataset.id === id;
      el.classList.toggle('active', on);
    });
  }

  /** Fetches and renders a single document. Admins get an "Edit" button. */
  private async loadDoc(content: HTMLElement, id: string): Promise<void> {
    content.innerHTML = '<p class="docs-loading">Loading…</p>';
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { content: string; meta: DocMeta };

      content.innerHTML = '';
      const rendered = document.createElement('div');
      rendered.className = 'docs-rendered';
      rendered.innerHTML = DocsView.parseMarkdown(data.content);
      content.appendChild(rendered);

      // Admin actions.
      if (this.currentUser?.isAdmin) {
        const actions = document.createElement('div');
        actions.className = 'docs-actions';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-primary';
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => this.openEditor(content, id, data.content, data.meta);
        actions.appendChild(editBtn);
        content.appendChild(actions);
      }
    } catch {
      content.innerHTML = '<p class="docs-error">Failed to load document.</p>';
    }
  }

  /** Admin editor with a textarea + save/cancel + (delete for non-main). */
  private openEditor(content: HTMLElement, id: string, markdown: string, meta: DocMeta) {
    content.innerHTML = '';

    const label = document.createElement('h3');
    label.textContent = `Editing: ${meta.title}`;

    const textarea = document.createElement('textarea');
    textarea.className = 'docs-editor';
    textarea.value = markdown;
    textarea.rows = 20;
    textarea.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'docs-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content: textarea.value }),
      });
      if (res.ok) {
        this.loadDoc(content, id);
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save (failed)';
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => this.loadDoc(content, id);

    actions.append(saveBtn, cancelBtn);

    // Delete (only for non-main docs).
    if (!meta.main) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-danger';
      delBtn.textContent = 'Delete document';
      delBtn.onclick = async () => {
        if (!confirm(`Delete document "${meta.title}"?`)) return;
        const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          // Re-render the whole docs view from the list.
          content.closest('.docs-view')?.remove();
          this.render();
        } else {
          alert('Failed to delete document.');
        }
      };
      actions.appendChild(delBtn);
    }

    content.append(label, textarea, actions);
  }

  /** Creates a new document via a prompt-based flow. */
  private async newDoc(content: HTMLElement) {
    const name = prompt('New document name (will be the URL id):');
    if (!name) return;
    const id = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ content: `# ${name}\n\n` }),
    });
    if (res.ok) {
      this.openEditor(content, id, `# ${name}\n\n`, { id, title: name, main: false });
    } else {
      alert('Failed to create document.');
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