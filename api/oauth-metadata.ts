import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../src/config.js";
import { createOAuthHandlers } from "../src/oauth/handlers.js";

const oauth = createOAuthHandlers(config);

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  oauth.handleOAuthMetadataRequest(req, res);
}
