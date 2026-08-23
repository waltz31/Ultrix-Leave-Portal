/** Prefer the app shell so portaled overlays inherit theme CSS variables. */
export function getPortalRoot() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.shell') || document.body;
}
