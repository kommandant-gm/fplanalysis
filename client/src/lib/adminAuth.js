const ADMIN_TOKEN_KEY = '__fpl_admin_token';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token) {
  if (!token) return;
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function hasAdminToken() {
  return Boolean(getAdminToken());
}
