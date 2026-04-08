/** Merge query-param updates into the current URL without destroying the path. */
export function updateUrlParams(updates) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  window.history.replaceState(null, '', url.pathname + url.search);
}

/** Navigate to a path (e.g. '/trip', '/sources', '/') using History API. */
export function navigateTo(path) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
