document.addEventListener('DOMContentLoaded', () => {
  let cachedArticles = [];
  const modal = document.getElementById('articleModal');

  // ================== PRICE TICKER ==================
  async function updatePrices() {
    try {
      const response = await fetch('/api/cached-prices');
      if (!response.ok) throw new Error('Price fetch failed');

      const prices = await response.json();
      const symbols = Object.keys(prices);

      const priceElements = symbols.map(symbol => {
        const price = prices[symbol]?.toFixed(2) || '---';
        return `<div class="price-item">${symbol}: $${price}</div>`;
      });

      document.querySelector('.price-scroller').innerHTML = priceElements.join('');

    } catch (error) {
      document.getElementById('priceContainer').innerHTML =
        '<div class="price-error">Price data unavailable</div>';
    }
  }

  // Horizontal scroll with mouse drag
  let isDragging = false;
  let startX;
  let scrollLeft;
  const container = document.querySelector('.price-container');

  container.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
    container.style.cursor = 'grabbing';
  });

  container.addEventListener('mouseup', () => {
    isDragging = false;
    container.style.cursor = 'grab';
  });

  container.addEventListener('mouseleave', () => {
    isDragging = false;
    container.style.cursor = 'grab';
  });

  container.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 2;
    container.scrollLeft = scrollLeft - walk;
  });

  // ================== ARTICLE HANDLING ==================
  async function loadArticles() {
    const grid = document.getElementById('articleGrid');
    grid.innerHTML = '<div class="loading">Loading articles...</div>';

    try {
      const response = await fetch('/api/cached-articles');
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      cachedArticles = await response.json();

      if (cachedArticles.length === 0) {
        grid.innerHTML = '<div class="empty">No articles found</div>';
        return;
      }

      grid.innerHTML = cachedArticles
        .sort((a, b) => b.id - a.id)
        .map(article => `
          <article class="article-card" data-id="${article.id}">
            <div class="article-header">
              <h3>${article.headline}</h3>
              <div class="article-meta">
                <span class="views">
                  <svg class="view-icon" viewBox="0 0 24 24" width="14" height="14">
                    <path fill="currentColor" d="M12 5C5.648 5 1 12 1 12s4.648 7 11 7 11-7 11-7-4.648-7-11-7zm0 12c-2.841 0-5-2.156-5-5 0-2.841 2.159-5 5-5 2.844 0 5 2.156 5 5 0 2.844-2.156 5-5 5zm0-8c-1.659 0-3 1.341-3 3s1.341 3 3 3 3-1.341 3-3-1.341-3-3-3z"/>
                  </svg>
                  ${article.views.toLocaleString()}
                </span>
                <span class="date">${new Date(article.date).toLocaleDateString()}</span>
              </div>
            </div>
            <p class="preview">${article.article.substring(0, 100)}...</p>
          </article>
        `).join('');

      // Event delegation for article clicks
      grid.addEventListener('click', (event) => {
        const card = event.target.closest('.article-card');
        if (card) showArticle(parseInt(card.dataset.id));
      });

    } catch (error) {
      console.error('Article load failed:', error);
      grid.innerHTML = '<div class="error">Failed to load articles. Check console.</div>';
    }
  }

  // ================== MODAL SYSTEM ==================
  function showArticle(articleId) {
    const article = cachedArticles.find(a => a.id === articleId);
    if (!article) return;

    // Update modal
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.modal-title').textContent = article.headline;
    modal.querySelector('.modal-body').textContent = article.article;
    const linkElement = modal.querySelector('.modal-link');
    linkElement.href = article.source;
    linkElement.textContent = 'Check out the source →';
  }

  // Close handlers
  document.querySelector('.close-btn').addEventListener('click', () => closeModal());
  modal.addEventListener('click', (e) => e.target === modal && closeModal());

  function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  // ================== INITIAL LOAD ==================
  updatePrices();
  loadArticles();
  setInterval(updatePrices, 15000);
});
