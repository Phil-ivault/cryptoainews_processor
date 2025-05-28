document.addEventListener('DOMContentLoaded', () => {
  // Get references to essential DOM elements.
  const priceContainer = document.getElementById('priceContainer');
  const priceScroller = priceContainer?.querySelector('.price-scroller');
  const articleGrid = document.getElementById('articleGrid');
  const modal = document.getElementById('articleModal');
  const closeModalBtn = modal?.querySelector('.close-btn');

  // If any essential element is missing, log an error and stop.
  if (!priceContainer || !priceScroller || !articleGrid || !modal || !closeModalBtn) {
    console.error('Essential frontend elements not found. Aborting script.');
    return;
  }

  // Cache for storing fetched articles to avoid multiple API calls.
  let cachedArticles = [];

  // ================== UTILITY FUNCTIONS ==================

  /**
   * Basic HTML sanitization to prevent XSS from displayed data.
   * @param {string} str - The string to sanitize.
   * @returns {string} The sanitized string.
   */
  function sanitizeHTML(str) {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
  }

  /**
   * Formats an ISO date string into a user-friendly local date format.
   * @param {string} dateString - The ISO date string.
   * @returns {string} The formatted date string or 'Invalid Date'.
   */
  function formatDate(dateString) {
    try {
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) {
      console.warn("Could not format date:", dateString);
      return 'Invalid Date';
    }
  }

  // ================== PRICE TICKER ==================

  /**
   * Fetches the latest prices from the API and updates the price ticker.
   */
  async function updatePrices() {
    if (!priceScroller) return; // Guard clause.

    try {
      const response = await fetch('/api/cached-prices');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const prices = await response.json();
      const symbols = Object.keys(prices);

      if (symbols.length === 0) {
        priceScroller.innerHTML = '<div class="price-item">No price data</div>';
        return;
      }

      // Create HTML for each price item, handling null values.
      const priceElements = symbols.map(symbol => {
        const priceValue = prices[symbol];
        const displayPrice = (typeof priceValue === 'number')
          ? `$${priceValue.toFixed(2)}`
          : '---'; // Placeholder for unavailable prices.
        return `<div class="price-item">${sanitizeHTML(symbol)}: ${displayPrice}</div>`;
      });

      priceScroller.innerHTML = priceElements.join('');

    } catch (error) {
      console.error('Price update failed:', error);
      priceScroller.innerHTML = '<div class="price-error">Prices unavailable</div>';
    }
  }

  // --- Price Ticker Mouse Drag Scrolling Implementation ---
  let isDragging = false;
  let startX;
  let scrollLeft;
  const scrollContainer = priceContainer;

  scrollContainer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.pageX - scrollContainer.offsetLeft;
    scrollLeft = scrollContainer.scrollLeft;
    scrollContainer.style.cursor = 'grabbing'; // Change cursor to indicate dragging.
    scrollContainer.style.userSelect = 'none'; // Prevent text selection.
  });

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    scrollContainer.style.cursor = 'grab'; // Revert cursor.
    scrollContainer.style.removeProperty('user-select');
  };

  // Listen globally to catch mouse up/leave events outside the container.
  window.addEventListener('mouseup', stopDragging);
  scrollContainer.addEventListener('mouseleave', stopDragging);

  scrollContainer.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault(); // Prevent default browser drag actions.
    const x = e.pageX - scrollContainer.offsetLeft;
    const walk = (x - startX) * 1.5; // Multiplier adjusts scroll speed.
    scrollContainer.scrollLeft = scrollLeft - walk;
  });

  // ================== ARTICLE HANDLING ==================

  /**
   * Fetches articles from the API and displays them in the grid.
   */
  async function loadArticles() {
    if (!articleGrid) return; // Guard clause.

    articleGrid.innerHTML = '<div class="loading">Loading articles...</div>'; // Show loading state.

    try {
      const response = await fetch('/api/cached-articles');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      cachedArticles = await response.json(); // Store articles in cache.

      if (!Array.isArray(cachedArticles)) throw new Error("Invalid article data format.");
      if (cachedArticles.length === 0) {
        articleGrid.innerHTML = '<div class="empty">No articles found.</div>';
        return;
      }

      // Sort by Telegram ID (b.id - a.id) to show newest first.
      cachedArticles.sort((a, b) => b.id - a.id);

      // Generate HTML for each article card.
      articleGrid.innerHTML = cachedArticles.map(article => {
        const headline = article.headline || 'Untitled';
        const articleContent = article.article || '';
        const articleId = article.id;
        const articleDate = article.date ? formatDate(article.date) : 'N/A';
        const previewText = articleContent.substring(0, 120); // Create a short preview.

        return `
          <article class="article-card" data-id="${articleId}" tabindex="0" aria-labelledby="article-title-${articleId}">
            <div class="article-header">
              <h3 id="article-title-${articleId}">${sanitizeHTML(headline)}</h3>
            </div>
            <p class="preview">${sanitizeHTML(previewText)}${articleContent.length > 120 ? '...' : ''}</p>
             <div class="article-meta">
                <span class="date">${articleDate}</span>
             </div>
          </article>
        `;
      }).join('');

    } catch (error) {
      console.error('Article load failed:', error);
      articleGrid.innerHTML = `<div class="error">Failed to load articles.</div>`;
    }
  }

  // ================== MODAL SYSTEM ==================

  /**
   * Displays the modal with the content of the selected article.
   * @param {number} articleId - The ID of the article to display.
   */
  function showArticleModal(articleId) {
    // Find the article in the cache using its Telegram ID.
    const article = cachedArticles.find(a => a.id === articleId);
    if (!article || !modal) return;

    // Populate modal elements with article data.
    modal.querySelector('.modal-title').textContent = article.headline || 'Article Details';
    modal.querySelector('.modal-body').textContent = article.article || 'Content not available.';
    const linkElement = modal.querySelector('.modal-link');

    if (article.source) {
      linkElement.href = article.source;
      linkElement.style.display = 'inline-block'; // Show link if available.
    } else {
      linkElement.style.display = 'none'; // Hide link if unavailable.
    }

    // Show the modal and set accessibility attributes.
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    closeModalBtn.focus(); // Focus close button for keyboard navigation.
  }

  /**
   * Hides the article modal.
   */
  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  // --- Event Listeners ---

  // Use event delegation on the grid to handle clicks on any article card.
  articleGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.article-card');
    if (card && card.dataset.id) {
      showArticleModal(parseInt(card.dataset.id, 10));
    }
  });

  // Add keyboard support (Enter key) for opening articles.
  articleGrid.addEventListener('keydown', (event) => {
    const card = event.target.closest('.article-card');
    if (event.key === 'Enter' && card && card.dataset.id) {
      showArticleModal(parseInt(card.dataset.id, 10));
    }
  });

  // Modal close listeners.
  closeModalBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(); // Close if clicking on the overlay.
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal(); // Close with Escape key.
    }
  });

  // ================== INITIAL LOAD & INTERVALS ==================
  updatePrices(); // Load prices once on start.
  loadArticles(); // Load articles once on start.

  // Set up periodic refresh for prices.
  setInterval(updatePrices, 30000); // 30-second interval.

});