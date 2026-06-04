import "dotenv/config";
import { handleOAuthTokenRequest } from "../src/oauth/handlers.js";

export default async function handler(req, res) {
  await handleOAuthTokenRequest(req, res);
}
