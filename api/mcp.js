import "dotenv/config";
import { waitUntil } from "@vercel/functions";
import { handleMcpRequest } from "../src/httpHandlers.js";

export default async function handler(req, res) {
  await handleMcpRequest(req, res, { waitUntil });
}
