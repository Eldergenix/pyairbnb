export const STAYS_WIDGET_URI = "ui://pyairbnb/stays-v1.html";

export const STAYS_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --surface: #ffffff;
        --surface-subtle: #f7f7f7;
        --text: #222222;
        --muted: #6a6a6a;
        --border: #dddddd;
        --accent: #e21c5a;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --surface: #171717;
          --surface-subtle: #222222;
          --text: #f5f5f5;
          --muted: #b0b0b0;
          --border: #3a3a3a;
          --accent: #ff5a7f;
        }
      }
      * { box-sizing: border-box; }
      body { margin: 0; color: var(--text); background: var(--surface); }
      main { padding: 14px; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      h1 { margin: 0; font-size: 1rem; line-height: 1.3; }
      #meta { color: var(--muted); font-size: 0.78rem; white-space: nowrap; }
      #listings { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
      article { overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
      .photo { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: var(--surface-subtle); }
      .body { padding: 10px; }
      .badge { display: inline-block; margin-bottom: 5px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; font-size: 0.68rem; font-weight: 650; }
      h2 { margin: 0 0 5px; font-size: 0.88rem; line-height: 1.35; }
      .price { margin: 0; font-size: 0.84rem; font-weight: 700; }
      .rating { margin: 4px 0 0; color: var(--muted); font-size: 0.76rem; }
      a { color: inherit; text-decoration: none; }
      a:hover h2, a:focus-visible h2 { color: var(--accent); text-decoration: underline; }
      .empty { padding: 24px; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1 id="title">Airbnb stays</h1>
        <span id="meta">Waiting for results</span>
      </header>
      <section id="listings" aria-live="polite"></section>
    </main>
    <script type="module">
      const root = document.getElementById("listings");
      const title = document.getElementById("title");
      const meta = document.getElementById("meta");
      const pending = new Map();
      let nextRequestId = 1;
      let bridgeReady = false;
      let hostCapabilities = {};

      function post(message) {
        window.parent.postMessage(message, "*");
      }

      function notify(method, params) {
        post({ jsonrpc: "2.0", method, params });
      }

      function request(method, params) {
        const id = nextRequestId++;
        post({ jsonrpc: "2.0", id, method, params });
        return new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            pending.delete(id);
            reject(new Error(method + " timed out"));
          }, 5000);
          pending.set(id, { resolve, reject, timeout });
        });
      }

      function sendSize() {
        if (!bridgeReady) return;
        notify("ui/notifications/size-changed", {
          width: Math.ceil(window.innerWidth),
          height: Math.ceil(document.documentElement.getBoundingClientRect().height),
        });
      }

      async function openExternal(url, event) {
        if (bridgeReady && hostCapabilities.openLinks) {
          event.preventDefault();
          await request("ui/open-link", { url });
          return;
        }
        if (window.openai && typeof window.openai.openExternal === "function") {
          event.preventDefault();
          await window.openai.openExternal({ href: url });
        }
      }

      function text(value) {
        return value == null ? "" : String(value);
      }

      function render(payload) {
        const content = payload && payload.structuredContent ? payload.structuredContent : payload;
        const listings = Array.isArray(content && content.listings) ? content.listings : [];
        const query = content && content.query;
        title.textContent = query && query.location ? "Stays in " + query.location : "Airbnb stays";
        meta.textContent = listings.length + " result" + (listings.length === 1 ? "" : "s");
        root.replaceChildren();
        if (!listings.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "No matching stays were returned.";
          root.append(empty);
          return;
        }

        for (const listing of listings) {
          const article = document.createElement("article");
          const link = document.createElement("a");
          link.href = text(listing.url);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.addEventListener("click", (event) => {
            void openExternal(link.href, event).catch(() => window.open(link.href, "_blank", "noopener"));
          });

          const image = document.createElement("img");
          image.className = "photo";
          image.loading = "lazy";
          image.src = text(listing.images && listing.images[0] && listing.images[0].url);
          image.alt = text(listing.images && listing.images[0] && listing.images[0].alt) || text(listing.name);
          link.append(image);

          const body = document.createElement("div");
          body.className = "body";
          if (listing.guest_favorite) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = "Guest favorite";
            body.append(badge);
          }
          const heading = document.createElement("h2");
          heading.textContent = text(listing.name);
          body.append(heading);

          const price = document.createElement("p");
          price.className = "price";
          const total = listing.price && listing.price.total;
          price.textContent = total == null
            ? "Price unavailable"
            : new Intl.NumberFormat(undefined, { style: "currency", currency: listing.price.currency }).format(total) +
              " total · " + listing.nights + " night" + (listing.nights === 1 ? "" : "s");
          body.append(price);

          const rating = document.createElement("p");
          rating.className = "rating";
          rating.textContent = listing.rating == null ? "No rating shown" : "★ " + listing.rating;
          body.append(rating);
          link.append(body);
          article.append(link);
          root.append(article);
        }
        sendSize();
      }

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
          const handler = pending.get(message.id);
          if (!handler) return;
          pending.delete(message.id);
          window.clearTimeout(handler.timeout);
          if (message.error) handler.reject(new Error(message.error.message || "Host request failed"));
          else handler.resolve(message.result);
          return;
        }
        if (message.method === "ui/notifications/tool-result") render(message.params);
      }, { passive: true });

      if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);

      async function connectHost() {
        const initialized = await request("ui/initialize", {
          appInfo: { name: "pyairbnb-stays", version: "1.0.0" },
          appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
          protocolVersion: "2026-01-26",
        });
        hostCapabilities = initialized && initialized.hostCapabilities
          ? initialized.hostCapabilities
          : {};
        bridgeReady = true;
        notify("ui/notifications/initialized", {});
        sendSize();
        new ResizeObserver(() => window.requestAnimationFrame(sendSize))
          .observe(document.documentElement);
      }

      void connectHost().catch(() => {
        bridgeReady = false;
      });
    </script>
  </body>
</html>`;
