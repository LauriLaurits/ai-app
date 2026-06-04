import "dotenv/config";
import { handleOAuthLoginRequest } from "../src/oauth/handlers.js";

export default async function handler(req, res) {
  await handleOAuthLoginRequest(req, res);
}
