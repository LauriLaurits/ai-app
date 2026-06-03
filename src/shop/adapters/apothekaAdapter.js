export function createApothekaAdapter() {
  return {
    async getCurrentCustomer() {
      throw new Error("Apotheka adapter is not configured yet");
    },

    async listOrders() {
      throw new Error("Apotheka adapter is not configured yet");
    },

    async getOrderDetails() {
      throw new Error("Apotheka adapter is not configured yet");
    },
  };
}
