import { getAuthState, initAuth, onAuthChange, signIn, signOut } from './auth.js';

function ensureAuthActions() {
  const nav = document.querySelector('.site-header nav');
  if (!nav || document.getElementById('auth-actions')) return;

  const wrap = document.createElement('div');
  wrap.id = 'auth-actions';
  wrap.className = 'auth-actions';
  wrap.innerHTML = `
    <span id="auth-email" class="auth-email" hidden></span>
    <button id="btn-sign-in" class="btn btn-small" type="button">Sign In</button>
    <button id="btn-sign-out" class="btn btn-small" type="button" hidden>Sign Out</button>
  `;
  nav.appendChild(wrap);
}

function ensureAuthModal() {
  if (document.getElementById('auth-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.className = 'auth-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <h2 id="auth-title">Sign In</h2>
      <p class="muted">Session is stored locally in your browser.</p>
      <label class="label" for="auth-email-input">Email</label>
      <input id="auth-email-input" class="input" type="email" placeholder="you@example.com" />
      <label class="label" for="auth-password-input">Password</label>
      <input id="auth-password-input" class="input" type="password" placeholder="Minimum 6 characters" />
      <p id="auth-error" class="status-line error" hidden></p>
      <div class="button-row">
        <button id="auth-submit" class="btn btn-primary" type="button">Sign In</button>
        <button id="auth-cancel" class="btn" type="button">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function setUiFromState() {
  const { isAuthenticated, email } = getAuthState();
  const emailEl = document.getElementById('auth-email');
  const signInBtn = document.getElementById('btn-sign-in');
  const signOutBtn = document.getElementById('btn-sign-out');

  if (!emailEl || !signInBtn || !signOutBtn) return;

  emailEl.hidden = !isAuthenticated;
  emailEl.textContent = email;
  signInBtn.hidden = isAuthenticated;
  signOutBtn.hidden = !isAuthenticated;
}

function openModal() {
  const modal = document.getElementById('auth-modal');
  const error = document.getElementById('auth-error');
  if (!modal) return;
  if (error) error.hidden = true;
  modal.hidden = false;
}

function closeModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.hidden = true;
}

function wireEvents() {
  const signInBtn = document.getElementById('btn-sign-in');
  const signOutBtn = document.getElementById('btn-sign-out');
  const submitBtn = document.getElementById('auth-submit');
  const cancelBtn = document.getElementById('auth-cancel');
  const modal = document.getElementById('auth-modal');

  signInBtn?.addEventListener('click', openModal);
  signOutBtn?.addEventListener('click', () => signOut());
  cancelBtn?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  submitBtn?.addEventListener('click', () => {
    const emailInput = document.getElementById('auth-email-input');
    const passInput = document.getElementById('auth-password-input');
    const error = document.getElementById('auth-error');

    const result = signIn(emailInput?.value || '', passInput?.value || '');
    if (!result.success) {
      if (error) {
        error.textContent = result.error || 'Sign in failed.';
        error.hidden = false;
      }
      return;
    }

    closeModal();
    if (emailInput) emailInput.value = '';
    if (passInput) passInput.value = '';
  });
}

ensureAuthActions();
ensureAuthModal();
wireEvents();
onAuthChange(setUiFromState);
initAuth();
setUiFromState();

