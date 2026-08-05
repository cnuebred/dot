import { fetchAuthStatus, startLogin, logout, type AuthUser } from '../logic/authClient';

/**
 * Login panel. Shows either a "Login with GitHub" button or the current
 * user's nickname + admin badge + logout button.
 *
 * Informs the user that ONLY GitHub OAuth is available and that only the
 * nickname and email are stored.
 */
export class LoginPanel {
  private container: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'login-panel';
  }

  /** Renders the panel and kicks off an auth-status fetch. Returns the element. */
  render(): HTMLElement {
    this.container.innerHTML = '<span class="login-status">Checking…</span>';
    this.refresh();
    return this.container;
  }

  /** Re-fetches auth status and re-renders. */
  async refresh(): Promise<void> {
    const status = await fetchAuthStatus();
    if (status.user) {
      this.renderLoggedIn(status.user);
    } else {
      this.renderLoggedOut(status.enabled);
    }
  }

  private renderLoggedOut(enabled: boolean) {
    this.container.innerHTML = '';
    if (!enabled) {
      const hint = document.createElement('p');
      hint.className = 'login-disabled';
      hint.textContent = 'Login is disabled on this server.';
      this.container.appendChild(hint);
      return;
    }

    const info = document.createElement('p');
    info.className = 'login-info';
    info.innerHTML = 'Login via GitHub. Only your nickname and email are stored. No other data is collected. <br>(Account not required to use the dot.qrware.pl service.)';

    const btn = document.createElement('button');
    btn.className = 'btn-primary login-btn';
    btn.textContent = 'Login with GitHub';
    btn.onclick = () => { startLogin(); };

    this.container.append(info, btn);
  }

  private renderLoggedIn(user: AuthUser) {
    this.container.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'login-user';

    const nick = document.createElement('span');
    nick.className = 'login-nick';
    nick.textContent = user.nick;

    if (user.isAdmin) {
      const admin = document.createElement('span');
      admin.className = 'login-admin-badge';
      admin.textContent = 'Admin';
      row.append(nick, admin);
    } else {
      row.appendChild(nick);
    }

    const btn = document.createElement('button');
    btn.className = 'btn-secondary login-btn';
    btn.textContent = 'Logout';
    btn.onclick = async () => {
      await logout();
      this.renderLoggedOut(true);
    };

    this.container.append(row, btn);
  }
}
