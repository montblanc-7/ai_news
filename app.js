const categoryNames = {
  all: "すべてのニュース",
  generative: "生成AI",
  business: "ビジネス",
  research: "研究・テクノロジー",
  japan: "日本のAI",
};

const newsGrid = document.querySelector("#news-grid");
const statusMessage = document.querySelector("#status-message");
const articleCount = document.querySelector("#article-count");
const lastUpdated = document.querySelector("#last-updated");
const refreshButton = document.querySelector("#refresh-button");
const searchInput = document.querySelector("#search-input");
let activeCategory = "all";
let activeQuery = "";

document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
}).format(new Date());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch((error) => {
    console.error("Service worker registration failed:", error);
  });
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category;
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.querySelector("#breadcrumb-category").textContent = categoryNames[activeCategory];
    loadNews();
  });
});

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  activeQuery = searchInput.value.trim();
  loadNews();
});

refreshButton.addEventListener("click", () => loadNews());

function formatTime(value) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";

  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function createArticleCard(article) {
  const card = document.createElement("a");
  card.className = "news-card";
  card.href = article.link;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const source = document.createElement("span");
  source.className = "source-name";
  source.textContent = article.source || "Google ニュース";
  const published = document.createElement("time");
  published.className = "published-at";
  published.dateTime = article.publishedAt || "";
  published.textContent = formatTime(article.publishedAt);
  meta.append(source, published);

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = article.title;

  const footer = document.createElement("div");
  footer.className = "card-footer";
  const label = document.createElement("span");
  label.textContent = "AI NEWS";
  const readMore = document.createElement("span");
  readMore.className = "read-more";
  readMore.textContent = "記事を読む ↗";
  footer.append(label, readMore);

  card.append(meta, title, footer);
  return card;
}

async function loadNews() {
  refreshButton.classList.add("is-loading");
  refreshButton.disabled = true;
  newsGrid.replaceChildren();
  statusMessage.hidden = false;
  statusMessage.classList.remove("is-error");
  statusMessage.textContent = "ニュースを読み込んでいます...";
  articleCount.textContent = "— 件";
  lastUpdated.textContent = "取得中...";

  const params = new URLSearchParams({ category: activeCategory, q: activeQuery });
  try {
    const isStatic = window.AI_NEWS_CONFIG?.mode === "static";
    const response = await fetch(
      isStatic ? "news.json" : `/api/news?${params}`,
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ニュースの取得に失敗しました。");

    const articles = isStatic
      ? (result.categories[activeCategory] || []).filter((article) => {
        const text = `${article.title} ${article.source}`.toLocaleLowerCase("ja");
        return !activeQuery || text.includes(activeQuery.toLocaleLowerCase("ja"));
      })
      : result.articles;
    articleCount.textContent = `${articles.length} 件`;
    const isOffline = response.headers.get("X-AI-News-Offline") === "true";
    lastUpdated.textContent = isOffline
      ? "オフライン・前回取得分"
      : `最終更新 ${new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(result.updatedAt))}`;
    document.querySelector("#feed-subtitle").textContent = activeQuery
      ? `「${activeQuery}」の検索結果`
      : `${categoryNames[activeCategory]}の最新情報`;

    if (articles.length === 0) {
      statusMessage.textContent = "ニュースが見つかりませんでした。別のキーワードでお試しください。";
      return;
    }

    const fragment = document.createDocumentFragment();
    articles.forEach((article) => fragment.append(createArticleCard(article)));
    newsGrid.append(fragment);
    statusMessage.hidden = true;
  } catch (error) {
    statusMessage.classList.add("is-error");
    statusMessage.textContent = error instanceof Error
      ? error.message
      : "ニュースの取得に失敗しました。時間をおいて再度お試しください。";
    articleCount.textContent = "— 件";
    lastUpdated.textContent = "取得できませんでした";
  } finally {
    refreshButton.classList.remove("is-loading");
    refreshButton.disabled = false;
  }
}

loadNews();
