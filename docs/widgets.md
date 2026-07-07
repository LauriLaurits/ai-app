# Widget verification checklist (manual, ChatGPT developer mode)

Widgets cannot be tested from CI — verify after each deploy touching
`src/widgets/`:

1. Refresh the app in ChatGPT (or recreate) so resources re-import.
2. "show me products" → product cards render (grid, prices, stock badges).
   - With `WIDGET_IMAGE_DOMAINS` unset, tiles show the placeholder icon.
3. Click "Add to cart" on an in-stock product → confirmation line appears
   with the cart total ("In cart — total …").
4. "show my cart" → cart widget renders lines, unit prices, line totals.
5. Click + then − on a line → quantity and totals update in place.
6. Click ✕ on a line → line disappears; removing the last line shows the
   empty-cart state.
7. Click Checkout:
   - `CHECKOUT_URL_TEMPLATE` unset → "not configured" message appears.
   - Set → the storefront opens externally with the cart.
8. Dark mode: toggle ChatGPT theme; widgets follow.
