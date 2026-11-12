# AGENTS.md check demo

Requires Node.js 22+ and a signed-in Codex CLI (`codex login`). No npm dependencies.

```sh
npm start
```

Open <http://127.0.0.1:3000>. Enter a request and click **Run**.

The agent uses your configured Codex model and tools in this repo with the
`workspace-write` sandbox. Requests can edit repo files. Commands requiring
approval fail rather than waiting for input. Repairs resume the same session.

A separate, read-only checker receives the exact static prompt and this repo’s
full `AGENTS.md`, read once per run. Its structured findings include quoted
evidence, required fixes, and instructions it cannot verify from the output.
Only the final response text is checked; tool actions and file changes are not
independently audited. Each revision is checked again, with at most two repairs
and three checks. Original output, fixes, and any remaining issues stay visible.

The server binds only to `127.0.0.1` and handles one run at a time. Closing the
page cancels the active call. Each Codex call has a five-minute timeout.
Agent sessions use Codex’s normal local history; checker sessions are ephemeral.

Use `PORT=3001 npm start` for another port, or `CODEX_BIN=/path/to/codex npm start`
if Codex is not on your PATH.

```sh
npm test
```
