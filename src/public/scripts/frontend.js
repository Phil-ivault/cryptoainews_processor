document.addEventListener('DOMContentLoaded', () => {
  // Ensure elements exist before proceeding
  const priceContainer = document.getElementById('priceContainer');
  const priceScroller = priceContainer?.querySelector('.price-scroller');
  const articleGrid = document.getElementById('articleGrid');
  const modal = document.getElementById('articleModal');
  const closeModalBtn = modal?.querySelector('.close-btn');

  if (!priceContainer || !priceScroller || !articleGrid || !modal || !closeModalBtn) {
    console.error('Essential frontend elements not found. Aborting script.');
    return;
  }

  let cachedArticles = [];

  // ================== UTILITY FUNCTIONS ==================
  function sanitizeHTML(str) {
    // Basic sanitization: Replace < > & " '
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
  }

  function formatDate(dateString) {
    try {
      return new Date(dateString).toLocaleDateString(undefined, { // Use user's locale
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) {
      console.warn("Could not format date:", dateString);
      return 'Invalid Date';
    }
  }

  // ================== PRICE TICKER ==================
  async function updatePrices() {
    if (!priceScroller) return; // Guard clause

    try {
      const response = await fetch('/api/cached-prices');
      // Check if response is ok (status in the range 200-299)
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      // Check content type
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new TypeError("Received non-JSON response for prices");
      }

      const prices = await response.json();
      const symbols = Object.keys(prices);

      if (symbols.length === 0) {
        priceScroller.innerHTML = '<div class="price-item">No price data available</div>';
        return;
      }

      // Format prices, handle null/undefined values
      const priceElements = symbols.map(symbol => {
        const priceValue = prices[symbol];
        const displayPrice = (typeof priceValue === 'number')
          ? `$${priceValue.toFixed(2)}` // Format number
          : '---';                     // Placeholder for null/invalid
        return `<div class="price-item">${sanitizeHTML(symbol)}: ${displayPrice}</div>`;
      });

      priceScroller.innerHTML = priceElements.join('');

    } catch (error) {
      console.error('Price update failed:', error);
      // Display error in the price bar
      priceScroller.innerHTML = '<div class="price-error">Price data unavailable</div>';
    }
  }

  // --- Price Ticker Mouse Drag Scrolling ---
  let isDragging = false;
  let startX;
  let scrollLeft;
  const scrollContainer = priceContainer; // Use the container for events

  scrollContainer.addEventListener('mousedown', (e) => {
    isDragging = true;
    // Use pageX as clientX can be relative to viewport
    startX = e.pageX - scrollContainer.offsetLeft;
    scrollLeft = scrollContainer.scrollLeft;
    scrollContainer.style.cursor = 'grabbing';
    scrollContainer.style.userSelect = 'none'; // Prevent text selection while dragging
  });

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    scrollContainer.style.cursor = 'grab';
    scrollContainer.style.removeProperty('user-select');
  }

  // Add listeners to window to catch mouseup/leave outside the container
  window.addEventListener('mouseup', stopDragging);
  scrollContainer.addEventListener('mouseleave', stopDragging); // Also stop if mouse leaves container

  scrollContainer.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault(); // Prevent default drag behavior (like image dragging)
    const x = e.pageX - scrollContainer.offsetLeft;
    const walk = (x - startX) * 1.5; // Increase scroll speed multiplier if needed
    scrollContainer.scrollLeft = scrollLeft - walk;
  });

  // ================== ARTICLE HANDLING ==================
  async function loadArticles() {
    if (!articleGrid) return; // Guard clause

    articleGrid.innerHTML = '<div class="loading">Loading articles...</div>';

    try {
      const response = await fetch('/api/cached-articles');
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new TypeError("Received non-JSON response for articles");
      }

      cachedArticles = await response.json();

      if (!Array.isArray(cachedArticles)) {
        throw new Error("Invalid article data format received from server.");
      }

      if (cachedArticles.length === 0) {
        articleGrid.innerHTML = '<div class="empty">No articles found at the moment.</div>';
        return;
      }

      // Sort articles by ID descending (newest first)
      cachedArticles.sort((a, b) => b.id - a.id);

      // Generate HTML for article cards
      articleGrid.innerHTML = cachedArticles.map(article => {
        // Basic validation of article object structure
        const headline = article.headline || 'Untitled';
        const articleContent = article.article || '';
        const articleId = article.id || Date.now(); // Fallback ID
        const articleDate = article.date ? formatDate(article.date) : 'N/A';
        const previewText = articleContent.substring(0, 120); // Adjust preview length

        return `
            <article class="article-card" data-id="${articleId}" tabindex="0" aria-labelledby="article-title-${articleId}">
              <div class="article-header">
                <h3 id="article-title-${articleId}">${sanitizeHTML(headline)}</h3>
                <div class="article-meta">
                  <span class="date">${articleDate}</span>
                </div>
              </div>
              <p class="preview">${sanitizeHTML(previewText)}${articleContent.length > 120 ? '...' : ''}</p>
            </article>
          `;
      }).join('');

    } catch (error) {
      console.error('Article load failed:', error);
      articleGrid.innerHTML = `<div class="error">Failed to load articles. ${error.message}</div>`;
    }
  }

  // ================== MODAL SYSTEM ==================
  function showArticleModal(articleId) {
    const article = cachedArticles.find(a => a.id === articleId);
    if (!article || !modal) return;

    // Update modal content safely
    modal.querySelector('.modal-title').textContent = article.headline || 'Article Details';
    modal.querySelector('.modal-body').textContent = article.article || 'Content not available.';
    const linkElement = modal.querySelector('.modal-link');

    if (article.source) {
      linkElement.href = article.source;
      linkElement.style.display = 'inline-block'; // Show link if source exists
      linkElement.textContent = 'Read source article →';
    } else {
      linkElement.style.display = 'none'; // Hide link if no source
    }


    // Show modal and manage accessibility attributes
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    // Focus the close button for accessibility
    closeModalBtn.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    // Optional: Return focus to the element that opened the modal if tracked
  }

  // --- Event Listeners ---

  // Event delegation for article clicks on the grid
  articleGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.article-card');
    if (card && card.dataset.id) {
      // Ensure ID is a number before passing
      const articleId = parseInt(card.dataset.id, 10);
      if (!isNaN(articleId)) {
        showArticleModal(articleId);
      }
    }
  });
  // Allow opening modal with Enter key for accessibility
  articleGrid.addEventListener('keydown', (event) => {
    const card = event.target.closest('.article-card');
    if (event.key === 'Enter' && card && card.dataset.id) {
      const articleId = parseInt(card.dataset.id, 10);
      if (!isNaN(articleId)) {
        showArticleModal(articleId);
      }
    }
  });


  // Modal close listeners
  closeModalBtn.addEventListener('click', closeModal);
  // Close if clicking outside the modal content
  modal.addEventListener('click', (e) => {
    // Check if the click is directly on the modal overlay, not its children
    if (e.target === modal) {
      closeModal();
    }
  });
  // Close with Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
  });


  // ================== INITIAL LOAD & INTERVALS ==================
  updatePrices(); // Initial price load
  loadArticles(); // Initial article load

  // Refresh prices periodically (e.g., every 30 seconds)
  // Note: Articles are loaded once; implement refresh logic if needed
  setInterval(updatePrices, 30000); // 30 seconds interval for price updates

}); // End DOMContentLoaded