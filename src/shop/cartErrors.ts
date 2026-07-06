/** Expected cart-state condition (no cart / unknown line), not a service failure. */
export class CartNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartNotFoundError";
  }
}
