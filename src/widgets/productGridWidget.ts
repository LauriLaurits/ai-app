import type { WidgetDefinition } from "./registry.js";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --fg:#1a1a1a; --bg:transparent; --muted:#6b7280; --card:#ffffff; --border:#e5e7eb; --accent:#0a7d33; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#ececec; --muted:#9ca3af; --card:#1f2123; --border:#3a3d41; --accent:#34c268; --err:#f87171; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); padding: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .thumb { width: 100%; aspect-ratio: 1; border-radius: 8px; background: var(--border); object-fit: cover; display: block; }
  .thumb.ph { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 22px; }
  .title { font-weight: 600; min-height: 2.6em; }
  .price { font-size: 15px; }
  .stock { font-size: 12px; color: var(--accent); }
  .stock.out { color: var(--muted); }
  .btn { border: 1px solid var(--border); background: var(--card); color: var(--fg); border-radius: 8px; padding: 7px 10px; cursor: pointer; font-weight: 600; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn:disabled { opacity: .55; cursor: default; }
  .note { font-size: 12px; color: var(--muted); }
  .note.ok { color: var(--accent); }
  .note.err { color: var(--err); }
  .empty { padding: 24px; text-align: center; color: var(--muted); }
  .variants { display: flex; flex-direction: column; gap: 4px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById("root");

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmt(price) {
    if (!price) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
    } catch (e) {
      return price.amount + " " + price.currency;
    }
  }

  function note(card, cls, text) {
    var el = card.querySelector(".note");
    el.className = "note " + cls;
    el.textContent = text;
  }

  function addVariant(card, variantId) {
    var btns = card.querySelectorAll("button");
    btns.forEach(function (b) { b.disabled = true; });
    note(card, "", "Adding…");
    window.openai.callTool("add_to_cart", { variantId: variantId, quantity: 1 }).then(function (res) {
      var cart = res && res.structuredContent && res.structuredContent.cart;
      if (cart) {
        note(card, "ok", "In cart — total " + fmt(cart.total));
      } else {
        note(card, "err", "Could not add to cart.");
      }
      btns.forEach(function (b) { b.disabled = false; });
    }).catch(function () {
      note(card, "err", "Could not add to cart.");
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  function showVariants(card, variants) {
    var box = card.querySelector(".variants");
    box.innerHTML = "";
    variants.forEach(function (v) {
      var b = document.createElement("button");
      b.className = "btn";
      b.textContent = v.title + (v.price ? " — " + fmt(v.price) : "");
      b.disabled = !v.inStock;
      b.addEventListener("click", function () { addVariant(card, v.id); });
      box.appendChild(b);
    });
  }

  function onAdd(card, product) {
    var btns = card.querySelectorAll("button");
    btns.forEach(function (b) { b.disabled = true; });
    if (product.variants && product.variants.length) {
      pick(card, product.variants);
      return;
    }
    note(card, "", "Loading options…");
    window.openai.callTool("get_product", { productId: product.id }).then(function (res) {
      var full = res && res.structuredContent && res.structuredContent.product;
      pick(card, (full && full.variants) || []);
    }).catch(function () {
      note(card, "err", "Could not load product options.");
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  function pick(card, variants) {
    var inStock = variants.filter(function (v) { return v.inStock; });
    if (inStock.length === 0) {
      note(card, "err", "Out of stock.");
    } else if (inStock.length === 1) {
      addVariant(card, inStock[0].id);
    } else {
      note(card, "", "Choose an option:");
      showVariants(card, inStock);
    }
  }

  function card(product) {
    var el = document.createElement("div");
    el.className = "card";
    var img = product.thumbnail
      ? '<img class="thumb" src="' + esc(product.thumbnail) + '" alt="">'
      : '<div class="thumb ph">🛍️</div>';
    el.innerHTML =
      img +
      '<div class="title">' + esc(product.title) + "</div>" +
      '<div class="price">' + esc(fmt(product.price)) + "</div>" +
      '<div class="stock' + (product.inStock ? "" : " out") + '">' +
      (product.inStock ? "In stock" : "Out of stock") + "</div>" +
      '<button class="btn primary"' + (product.inStock ? "" : " disabled") + ">Add to cart</button>" +
      '<div class="variants"></div>' +
      '<div class="note"></div>';
    el.querySelector(".btn.primary").addEventListener("click", function () { onAdd(el, product); });
    return el;
  }

  function render() {
    var out = (window.openai && window.openai.toolOutput) || {};
    var products = out.products || (out.product ? [out.product] : []);
    root.innerHTML = "";
    if (!products.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No products found.";
      root.appendChild(empty);
      return;
    }
    var grid = document.createElement("div");
    grid.className = "grid";
    products.forEach(function (p) { grid.appendChild(card(p)); });
    root.appendChild(grid);
  }

  window.addEventListener("openai:set_globals", render);
  render();
})();
</script>
</body>
</html>
`;

export const productGridWidget: WidgetDefinition = {
  name: "product-grid",
  uri: "ui://widget/product-grid.html",
  description:
    "Product cards with image, price, stock and an add-to-cart button for webshop catalog results.",
  html,
};
