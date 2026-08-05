import { LoginPanel } from './LoginPanel';

export class HomeView {
  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'home-view';

    const title = document.createElement('h1');
    title.textContent = 'dot.qrware.pl';
    title.style.fontSize = '3rem';
    title.style.fontWeight = '800';

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Minimalist SVG icon generator';
    subtitle.style.color = 'var(--text-muted)';
    subtitle.style.fontSize = '1.2rem';

    const navLinks = document.createElement('div');
    navLinks.className = 'nav-links';

    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'Launch Editor';
    
    btn.onclick = () => {
      // Trigger global navigator (simplified via window)
      (window as any).dispatchEvent(new CustomEvent('navigate', { detail: 'editor' }));
    };

    const galleryBtn = document.createElement('button');
    galleryBtn.className = 'btn-secondary';
    galleryBtn.textContent = 'Gallery';
    galleryBtn.onclick = () => {
      (window as any).dispatchEvent(new CustomEvent('navigate', { detail: 'gallery' }));
    };

    const docsBtn = document.createElement('button');
    docsBtn.className = 'btn-secondary';
    docsBtn.textContent = 'Documentation';
    docsBtn.onclick = () => {
      (window as any).dispatchEvent(new CustomEvent('navigate', { detail: 'docs' }));
    };

    navLinks.append(btn, galleryBtn, docsBtn);

    // Login panel (GitHub OAuth).
    const loginPanel = new LoginPanel();
    const loginEl = loginPanel.render();

    container.append(title, subtitle, navLinks, loginEl);
    return container;
  }
}
