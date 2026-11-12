import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const text = { type: 'string' };
const list = { type: 'array', items: text };
const object = (properties) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

const checkSchema = object({
  fixes_needed: { type: 'boolean' },
  summary: { ...text, description: 'Use “No fixes needed.” when there are no supported violations.' },
  fixes: {
    type: 'array',
    items: object({ instruction: text, evidence: text, change: text }),
    description: 'Supported violations only. Evidence must quote the agent output.',
  },
  unverifiable: { ...list, description: 'Instructions that cannot be verified from the supplied output.' },
});
const repairSchema = object({ output: text, fixes_made: list });

// Codex supplies the agent harness, tools, configured model, and saved login.
async function callCodex(prompt, { cwd, signal, threadId, schema, checker = false }) {
  const dir = await mkdtemp(join(tmpdir(), 'agents-check-'));
  const answer = join(dir, 'answer.txt');
  const args = ['-a', 'never', 'exec', '--sandbox', checker ? 'read-only' : 'workspace-write'];
  if (threadId) args.push('resume', threadId);
  if (checker) args.push('--ephemeral', '--skip-git-repo-check');
  args.push('--json', '--output-last-message', answer);

  try {
    if (schema) {
      const path = join(dir, 'schema.json');
      await writeFile(path, JSON.stringify(schema));
      args.push('--output-schema', path);
    }
    args.push('-');

    const events = await new Promise((resolve, reject) => {
      const child = execFile(process.env.CODEX_BIN || 'codex', args, {
        cwd: checker ? dir : cwd,
        signal,
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (signal?.aborted) return reject(new Error('Run cancelled.'));
        if (error.code === 'ENOENT') return reject(new Error('Codex CLI not found. Install it and run codex login.'));
        const detail = stderr.trim().slice(-2000) || error.message;
        reject(new Error(`Codex failed: ${detail}`));
      });
      child.stdin.on('error', () => {}); // Early CLI failures are reported by execFile.
      child.stdin.end(prompt);
    });

    const output = (await readFile(answer, 'utf8')).trim();
    if (!output) throw new Error('Codex returned no output.');
    if (schema) return JSON.parse(output);

    const started = events.split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .find((event) => event.type === 'thread.started');
    if (!started?.thread_id) throw new Error('Codex returned no session ID.');
    return { output, threadId: started.thread_id };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createAgent(cwd, signal) {
  return {
    start: (prompt) => callCodex(prompt, { cwd, signal }),
    check: (prompt) => callCodex(prompt, { cwd, signal, schema: checkSchema, checker: true }),
    repair: (threadId, prompt) => callCodex(prompt, { cwd, signal, threadId, schema: repairSchema }),
  };
}
