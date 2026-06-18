import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { handleMcpRequest } from "../src/httpHandlers.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleMcpRequest(req, res, { waitUntil });
}
