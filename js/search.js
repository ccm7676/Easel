/* Search bar — hands the query to the browser's own default search engine. */

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');

export function initSearch() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    // chrome.search uses whatever engine the user actually set as default.
    if (chrome.search?.query) {
      chrome.search.query({ text, disposition: 'CURRENT_TAB' }, () => {
        if (chrome.runtime.lastError) fallback(text);
      });
    } else {
      fallback(text);
    }
  });

  input.focus();
}

function fallback(text) {
  window.location.href =
    'https://www.google.com/search?q=' + encodeURIComponent(text);
}
