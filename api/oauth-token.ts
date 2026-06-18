import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../src/config.js";
import { createOAuthHandlers } from "../src/oauth/handlers.js";

const oauth = createOAuthHandlers(config);

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await oauth.handleOAuthTokenRequest(req, res);
}
