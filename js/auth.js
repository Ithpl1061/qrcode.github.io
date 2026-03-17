const AUTH_KEY = 'qr_platform_auth_v1';

let state = {
  isAuthenticated: false,
  email: '',
};

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn({ ...state }));
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.email === 'string' && parsed.email) {
      state = {
        isAuthenticated: true,
        email: parsed.email,
      };
    }
  } catch {
    state = { isAuthenticated: false, email: '' };
  }
}

function persistState() {
  if (!state.isAuthenticated) {
    localStorage.removeItem(AUTH_KEY);
    return;
  }

  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      email: state.email,
      signedInAt: new Date().toISOString(),
    })
  );
}

export function initAuth() {
  readStoredState();
  notify();
}

export function signIn(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  if (!emailOk) {
    return { success: false, error: 'Enter a valid email address.' };
  }

  if (normalizedPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  state = {
    isAuthenticated: true,
    email: normalizedEmail,
  };

  persistState();
  notify();
  return { success: true };
}

export function signOut() {
  state = {
    isAuthenticated: false,
    email: '',
  };
  persistState();
  notify();
}

export function getAuthState() {
  return { ...state };
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

