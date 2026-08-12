# Installing the Yahoo Mail MCP server in Claude Desktop

This is the **local stdio** setup: the server runs on your machine, talks
directly to Yahoo over IMAP, and is never exposed to the internet. Nothing is
deployed, no public URL exists, and your credentials stay on your machine.

Use this vendored copy (`tools/yahoo-mail-mcp/`), not a fresh clone of upstream
— it carries the security patches described in `SECURITY-AUDIT.md`.

---

## Step 1 — Get the code onto your machine

From wherever you keep this repo locally:

```bash
git fetch origin claude/yahoo-mail-mcp-safety-2q38xq
git checkout claude/yahoo-mail-mcp-safety-2q38xq
cd tools/yahoo-mail-mcp
npm ci --omit=dev
```

`npm ci` reads the patched lockfile, so you get the versions with 0 advisories.
`--omit=dev` skips nodemon/cross-env, which stdio mode does not need.

Confirm it is clean:

```bash
npm audit --omit=dev     # expect: found 0 vulnerabilities
node --check server.js   # expect: no output
```

Note the absolute path — you need it in step 3:

```bash
pwd    # e.g. /Users/andrew/Cold-Flow-Forge/tools/yahoo-mail-mcp
```

## Step 2 — Generate a Yahoo app password

Do **not** use your main Yahoo password.

1. Go to https://login.yahoo.com/account/security
2. Click **Generate app password** (or *Manage app passwords*)
3. Choose **Other App**, name it `Claude MCP`
4. Copy the 16-character password

This password grants full IMAP access to that mailbox. Revoke it from the same
page if it is ever exposed.

## Step 3 — Add it to Claude Desktop

Open **Claude Desktop → Settings → Developer → Edit Config**, or edit the file
directly:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `yahoo-mail` entry inside `mcpServers`, replacing the path with your
`pwd` from step 1 and the password with your app password:

```json
{
  "mcpServers": {
    "yahoo-mail": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/tools/yahoo-mail-mcp/server.js"],
      "env": {
        "TRANSPORT_MODE": "stdio",
        "YAHOO_EMAIL": "you@yahoo.com",
        "YAHOO_APP_PASSWORD": "your16charapppassword"
      }
    }
  }
}
```

If `mcpServers` already has entries, add `yahoo-mail` alongside them — don't
replace the block.

Notes:

- The path must be **absolute**. `~` is not expanded here.
- On Windows, escape backslashes: `"C:\\Users\\andrew\\...\\server.js"`.
- `claude_desktop_config.json` will contain your app password in plaintext.
  It is already in this repo's ignore list; keep it out of version control.
- Credentials can go in a `.env` file next to `server.js` instead of the `env`
  block if you prefer — copy `.env.example` to `.env` and fill it in. `.env` is
  gitignored.

## Step 4 — Restart and verify

Quit Claude Desktop **completely** (not just the window — use Cmd/Ctrl+Q) and
reopen it. Then:

1. Look for the MCP/tools indicator in the chat input area — `yahoo-mail`
   should be listed with 11 tools.
2. Ask: *"List my 5 most recent Yahoo emails."*
3. It should return subjects, senders, dates, and UIDs.

### If it doesn't appear

Check the logs:

- **macOS:** `~/Library/Logs/Claude/mcp-server-yahoo-mail.log`
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-yahoo-mail.log`

Or test the server standalone — this should print a JSON line listing the tools:

```bash
cd tools/yahoo-mail-mcp
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | TRANSPORT_MODE=stdio YAHOO_EMAIL=you@yahoo.com YAHOO_APP_PASSWORD=xxx node server.js
```

Common causes:

| Symptom | Cause |
|---|---|
| Server not listed at all | Bad JSON in the config, or a relative path |
| `Authentication failed` | Using your main password instead of an app password, or the app password was revoked |
| `Cannot connect to Yahoo Mail servers` | Network/firewall blocking outbound 993 |
| Tools listed but calls hang | IMAP connect timeout — the server gives up after 35s |

---

## What the 11 tools can do

Read-ish: `list_emails`, `read_email`, `search_emails`, `list_folders`.

Mutating: `delete_emails` (moves to Trash — recoverable), `archive_emails`,
`move_emails`, `mark_as_read`, `mark_as_unread`, `flag_emails`, `unflag_emails`.

There is **no send-email tool and no permanent-delete tool**, which is the main
reason the worst case here stays recoverable.

## Two things to keep in mind

1. **Email content reaches the model.** Anything in an email you ask about —
   including text written by whoever sent it — becomes part of the context. A
   hostile email can try to talk the assistant into calling the delete or move
   tools. Read tool-call confirmations on this server before approving them.
2. **Don't switch this to SSE mode and deploy it.** The patched server now
   refuses to start in SSE mode without OAuth credentials, but a public
   deployment still puts your mailbox behind a URL. If you ever need remote
   access, read `SECURITY-AUDIT.md` first and set `OAUTH_CLIENT_ID` /
   `OAUTH_CLIENT_SECRET` to values from `openssl rand -hex 16` / `-hex 32`.
