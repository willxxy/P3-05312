import assert from 'node:assert/strict';
import test from 'node:test';
import { checkerPrompt, runWorkflow, validateCheck } from './workflow.mjs';

const clean = () => ({ fixes_needed: false, summary: 'No fixes needed.', fixes: [], unverifiable: ['Tool execution was not supplied.'] });
const violation = () => ({
  fixes_needed: true,
  summary: 'Remove praise.',
  fixes: [{ instruction: 'Avoid praise.', evidence: 'Great question!', change: 'Remove the opening praise.' }],
  unverifiable: [],
});

function fakeAgent(checks) {
  const calls = [];
  return {
    calls,
    async start(request) {
      calls.push({ type: 'start', request });
      return { output: 'Great question! Use npm start.', threadId: 'original-session' };
    },
    async check(prompt) {
      calls.push({ type: 'check', prompt });
      return checks.shift();
    },
    async repair(threadId, prompt) {
      calls.push({ type: 'repair', threadId, prompt });
      return { output: 'Use npm start.', fixes_made: ['Removed opening praise.'] };
    },
  };
}

test('clean output is checked once and preserved without repair', async () => {
  const agent = fakeAgent([clean()]);
  const result = await runWorkflow('How do I start?', 'Avoid praise.', agent);
  assert.equal(result.original, result.revised);
  assert.equal(result.checks.length, 1);
  assert.equal(result.repairs.length, 0);
  assert.deepEqual(agent.calls.map((call) => call.type), ['start', 'check']);
});

test('repair receives request, full instructions, output, and feedback in the original session', async () => {
  const agent = fakeAgent([violation(), clean()]);
  const events = [];
  const instructions = 'Avoid praise.\n\nKeep all instructions intact.';
  const result = await runWorkflow('How do I start?', instructions, agent, (event) => events.push(event));
  assert.equal(result.original, 'Great question! Use npm start.');
  assert.equal(result.revised, 'Use npm start.');
  assert.equal(result.checks.length, 2);
  const repair = agent.calls.find((call) => call.type === 'repair');
  assert.equal(repair.threadId, 'original-session');
  for (const text of ['How do I start?', instructions, result.original, 'Remove the opening praise.']) {
    assert.ok(repair.prompt.includes(text));
  }
  const prompts = agent.calls.filter((call) => call.type === 'check').map((call) => call.prompt);
  assert.equal(prompts[0], checkerPrompt('How do I start?', instructions, result.original));
  assert.equal(prompts[1], checkerPrompt('How do I start?', instructions, result.revised));
  assert.deepEqual(events.filter((event) => event.type !== 'status').map((event) => event.type),
    ['original', 'check', 'repair', 'check', 'done']);
});

test('stops after two repairs and preserves final unresolved findings', async () => {
  const agent = fakeAgent([violation(), violation(), violation(), clean()]);
  const events = [];
  const result = await runWorkflow('Help', 'Avoid praise.', agent, (event) => events.push(event));
  assert.equal(result.repairs.length, 2);
  assert.equal(result.checks.length, 3);
  assert.equal(result.checks.at(-1).fixes_needed, true);
  assert.deepEqual(events.at(-1), { type: 'done', repairs: 2, fixes_needed: true });
});

test('can pass after the second repair', async () => {
  const result = await runWorkflow('Help', 'Avoid praise.', fakeAgent([violation(), violation(), clean()]));
  assert.equal(result.repairs.length, 2);
  assert.equal(result.checks.at(-1).fixes_needed, false);
});

test('unverifiable instructions alone do not trigger repairs', async () => {
  assert.equal(validateCheck(clean()).fixes_needed, false);
});

test('rejects unsupported or contradictory checker findings', () => {
  assert.throws(() => validateCheck({ ...violation(), fixes: [] }), /invalid result/);
  assert.throws(() => validateCheck({ ...violation(), fixes_needed: false }), /invalid result/);
  const missingEvidence = violation();
  missingEvidence.fixes[0].evidence = '';
  assert.throws(() => validateCheck(missingEvidence), /invalid result/);
});

test('checker failure keeps original output visible and never reports completion', async () => {
  const agent = fakeAgent([]);
  agent.check = async () => { throw new Error('Network unavailable'); };
  const events = [];
  await assert.rejects(runWorkflow('Help', 'Avoid praise.', agent, (event) => events.push(event)), /Network unavailable/);
  assert.equal(events.find((event) => event.type === 'original').output, 'Great question! Use npm start.');
  assert.equal(events.some((event) => event.type === 'done'), false);
});

test('invalid repair does not replace the output or report completion', async () => {
  const agent = fakeAgent([violation()]);
  agent.repair = async () => ({ output: '', fixes_made: [] });
  const events = [];
  await assert.rejects(runWorkflow('Help', 'Avoid praise.', agent, (event) => events.push(event)), /invalid repair/);
  assert.equal(events.some((event) => ['repair', 'done'].includes(event.type)), false);
});
