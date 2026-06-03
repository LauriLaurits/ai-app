# Architecture

```text
ChatGPT
  -> HTTPS /mcp
     -> MCP server
        -> OAuth/JWT verification
        -> webshop adapter
           -> Apotheka API or another webshop API
        -> structured logs
           -> OpenObserve
```

## V1 Scope

V1 is read-only and focused on proving the connector shape:

- user authentication
- customer lookup
- order listing
- order details
- request/tool logging

No checkout, payment, prescription changes, order edits, or account mutation should be added until authentication and audit logging are reviewed.

## Adapter Boundary

The MCP tool layer should not know Apotheka internals. It calls a shop adapter with these methods:

- `getCurrentCustomer(identity)`
- `listOrders(identity, filters)`
- `getOrderDetails(identity, orderId)`

The real Apotheka adapter can later call REST, GraphQL, internal services, or a thin backend facade.
