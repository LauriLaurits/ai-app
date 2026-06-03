# Apotheka Integration Checklist

When the Apotheka repo or API documentation is available, collect these details:

- login/SSO provider and OAuth support
- user id mapping between auth and webshop customer
- customer profile endpoint
- order listing endpoint
- order details endpoint
- product item fields allowed to expose to ChatGPT
- delivery/tracking endpoint, if available
- allowed scopes and consent text
- staging credentials and test accounts
- privacy/legal rules for pharmacy-related order data

## Preferred Integration

Use OAuth for ChatGPT and call Apotheka APIs from the MCP server with server-side credentials or delegated user tokens.

Do not ask ChatGPT to collect webshop usernames or passwords. Do not scrape the browser UI unless no API exists and the business explicitly accepts that risk.
