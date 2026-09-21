# Create AI Web — Durable Agent Pass

This pass adds a real Cloudflare Agent backed by a SQLite-backed Durable Object.

## Added
- `agent.js`: `CreateAIAgent` extends Cloudflare's `Agent` base class.
- Durable state for the conversation message history.
- WebSocket endpoint at `/api/agent/ws?id=<conversationId>`.
- Automatic reconnect from the browser.
- `wrangler.toml` Durable Object/SQLite configuration.
- Existing HTTP APIs and UI remain available as fallback.

## Deployment
Install the Cloudflare Agents package before deploying:

```bash
npm install agents
```

Then deploy with Wrangler:

```bash
npx wrangler deploy
```

The Durable Object class is provisioned through the `exports` configuration with SQLite storage.

## Important
The WebSocket agent is a foundation for durable, synchronized conversations. Authentication is intentionally not included yet; the conversation ID is not an identity or security boundary. Add real authentication before exposing private user data or account-level memory.


## Durable Agent integration
This pass combines the Durable Object Agent WebSocket with the existing HTTP APIs for streaming chat, memory, conversations, images, and the HTTP action agent.

### D1 setup
Set `database_id` in `wrangler.toml` to your D1 database ID, then apply the migration with Wrangler. Do not deploy with the placeholder ID.

### Agent WebSocket
The browser connects to `/api/agent/ws?id=<conversationId>`. The Worker maps that ID to a single `CreateAIAgent` Durable Object, while the existing HTTP endpoints remain available as fallbacks.

This pass fixes an integration gap in the previous Durable Agent package: that package routed the WebSocket correctly but had dropped the earlier HTTP API routes.
