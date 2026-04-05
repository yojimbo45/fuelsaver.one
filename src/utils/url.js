/** Merge query-param updates into the current URL without destroying the hash. */
export function updateUrlParams(updates) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Change the hash fragment without destroying query params. */
export function navigateTo(hash) {
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
