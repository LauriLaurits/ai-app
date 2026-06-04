import "dotenv/config";
import { handleOAuthAuthorizeRequest } from "../src/oauth/handlers.js";

export default function handler(req, res) {
  handleOAuthAuthorizeRequest(req, res);
}
