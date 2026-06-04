import "dotenv/config";
import { handleOAuthMetadataRequest } from "../src/oauth/handlers.js";

export default function handler(req, res) {
  handleOAuthMetadataRequest(req, res);
}
