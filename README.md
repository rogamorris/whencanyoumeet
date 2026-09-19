# When Can You Meet

An agent-friendly site for coordinating a meeting time.

People and agents operate the same poll: create a link, collect availability, choose a time. The service does not read calendars and does not send invitations.

Product requirements: [`docs/agent_native_scheduling_prd_v0_2.md`](docs/agent_native_scheduling_prd_v0_2.md).

## First slice

- Domain: windows, 15-minute starts, four availability states, overlap, capability tokens, versioned finalization
- HTTP API + OpenAPI at `/openapi.json`
- Accountless HTML for create, respond, and organize
- MCP Streamable HTTP at `POST /mcp` (same commands as the API)
- Optional stdio adapter that calls the running HTTP server

## Run

Node 22+ and pnpm.

```bash
pnpm install
pnpm test
pnpm dev
```

Open `http://127.0.0.1:8080`. Data is stored in `data/when.db` (PGlite).

### MCP

While the server is running:

```json
{
  "mcpServers": {
    "whencanyoumeet": {
      "url": "http://127.0.0.1:8080/mcp"
    }
  }
}
```

Or stdio, which proxies to that server:

```bash
WHENCANYOUMEET_URL=http://127.0.0.1:8080 pnpm mcp
```

Save organizer and response links. They are capabilities, not accounts. A display name cannot recover them.
