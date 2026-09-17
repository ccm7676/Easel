/* Search bar — hands the query to the browser's default search engine, or to
 * the one chosen in settings. */

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');

/** The settings panel lists these in this order. A null url means the browser's own. */
export const ENGINES = {
  default: { label: 'Default', url: null },
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
};

let engine = 'default';

export function initSearch({ engine: initial } = {}) {
  setSearchEngine(initial);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    const { url } = ENGINES[engine];
    if (url) {
      go(url, text);
    } else if (chrome.search?.query) {
      // chrome.search uses whatever engine the user actually set as default.
      chrome.search.query({ text, disposition: 'CURRENT_TAB' }, () => {
        if (chrome.runtime.lastError) go(ENGINES.google.url, text);
      });
    } else {
      go(ENGINES.google.url, text);
    }
  });

  input.focus();
}

/** Unknown ids — say, an engine since removed from the list — fall back to the default. */
export function setSearchEngine(id) {
  engine = Object.hasOwn(ENGINES, id) ? id : 'default';
}

function go(url, text) {
  window.location.href = url + encodeURIComponent(text);
}
