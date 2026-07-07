import type { WidgetDefinition } from "./registry.js";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --fg:#1a1a1a; --muted:#6b7280; --card:#ffffff; --border:#e5e7eb; --accent:#0a7d33; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#ececec; --muted:#9ca3af; --card:#1f2123; --border:#3a3d41; --accent:#34c268; --err:#f87171; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); padding: 4px; }
  .cart { background: var(--card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .row .title { flex: 1; font-weight: 600; }
  .qty { display: flex; align-items: center; gap: 6px; }
  .qty button { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; font-weight: 700; }
  .qty button:disabled { opacity: .5; cursor: default; }
  .lineTotal { min-width: 76px; text-align: right; font-variant-numeric: tabular-nums; }
  .remove { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 16px; }
  .footer { display: flex; align-items: center; justify-content: space-between; padding: 12px; }
  .total { font-size: 16px; font-weight: 700; }
  .btn { border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; }
  .btn:disabled { opacity: .55; cursor: default; }
  .note { padding: 0 12px 12px; font-size: 12px; color: var(--muted); }
  .note.err { color: var(--err); }
  .empty { padding: 28px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById("root");
  var busy = false;

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

  function setNote(cls, text) {
    var el = root.querySelector(".note");
    if (el) { el.className = "note " + cls; el.textContent = text; }
  }

  function update(lineItemId, quantity) {
    if (busy) return;
    busy = true;
    setNote("", "Updating…");
    window.openai.callTool("update_cart_item", { lineItemId: lineItemId, quantity: quantity }).then(function (res) {
      busy = false;
      var cart = res && res.structuredContent && res.structuredContent.cart;
      if (cart) { render(cart); } else { setNote("err", "Could not update the cart."); }
    }).catch(function () {
      busy = false;
      setNote("err", "Could not update the cart.");
    });
  }

  function checkout() {
    if (busy) return;
    busy = true;
    setNote("", "Getting checkout link…");
    window.openai.callTool("get_checkout_link", {}).then(function (res) {
      busy = false;
      var out = (res && res.structuredContent) || {};
      if (out.checkoutUrl) {
        window.openai.openExternal(out.checkoutUrl);
        setNote("", "Checkout opened in the webshop.");
      } else {
        setNote("err", out.message || "Checkout link is not available.");
      }
    }).catch(function () {
      busy = false;
      setNote("err", "Could not get the checkout link.");
    });
  }

  function row(line) {
    var el = document.createElement("div");
    el.className = "row";
    el.innerHTML =
      '<div class="title">' + esc(line.title) +
      ' <span style="color:var(--muted);font-weight:400">' + esc(fmt(line.unitPrice)) + "</span></div>" +
      '<div class="qty">' +
      '<button data-a="dec">−</button><span>' + esc(line.quantity) + "</span>" +
      '<button data-a="inc">+</button></div>' +
      '<div class="lineTotal">' + esc(fmt(line.lineTotal)) + "</div>" +
      '<button class="remove" title="Remove">✕</button>';
    el.querySelector('[data-a="dec"]').addEventListener("click", function () {
      update(line.id, Math.max(0, line.quantity - 1));
    });
    el.querySelector('[data-a="inc"]').addEventListener("click", function () {
      update(line.id, line.quantity + 1);
    });
    el.querySelector(".remove").addEventListener("click", function () { update(line.id, 0); });
    return el;
  }

  function render(cart) {
    root.innerHTML = "";
    if (!cart || !cart.items || cart.items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Your cart is empty. Ask for products to get started.";
      root.appendChild(empty);
      return;
    }
    var box = document.createElement("div");
    box.className = "cart";
    cart.items.forEach(function (line) { box.appendChild(row(line)); });
    var footer = document.createElement("div");
    footer.className = "footer";
    footer.innerHTML =
      '<div class="total">Total: ' + esc(fmt(cart.total)) + "</div>" +
      '<button class="btn">Checkout</button>';
    footer.querySelector(".btn").addEventListener("click", checkout);
    box.appendChild(footer);
    root.appendChild(box);
    var note = document.createElement("div");
    note.className = "note";
    box.appendChild(note);
  }

  var lastOutput = null;
  function renderFromGlobals() {
    var out = (window.openai && window.openai.toolOutput) || {};
    if (out === lastOutput) return;
    lastOutput = out;
    render(out.cart || null);
  }

  window.addEventListener("openai:set_globals", renderFromGlobals);
  renderFromGlobals();
})();
</script>
</body>
</html>
`;

export const cartWidget: WidgetDefinition = {
  name: "cart",
  uri: "ui://widget/cart.html",
  description:
    "Interactive shopping cart: line items with quantity steppers, running total and a checkout button.",
  html,
};
