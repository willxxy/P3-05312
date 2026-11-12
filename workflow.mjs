export const MAX_REPAIRS = 2;

export function checkerPrompt(request, instructions, output) {
  return `Check whether the agent’s output follows the applicable instructions in AGENTS.md, considering the original user request.

Identify specific violations and explain what needs to change. Support each finding with evidence from the output. If an instruction cannot be verified from the available evidence, say so.

Return whether fixes are needed and a short list of the required fixes. If there are no supported violations, report “No fixes needed.”

Original request: ${request}

AGENTS.md: ${instructions}

Agent output: ${output}`;
}

export function repairPrompt(request, instructions, output, feedback) {
  return `Revise your output to address the supported AGENTS.md violations below while fulfilling the original request. Make only necessary changes. Return the complete revised output and a short list of fixes actually made.

Original request: ${request}

AGENTS.md: ${instructions}

Agent output: ${output}

Checker feedback: ${JSON.stringify(feedback)}`;
}

export function validateCheck(result) {
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!result || typeof result.fixes_needed !== 'boolean' || !text(result.summary)
    || !Array.isArray(result.fixes) || !Array.isArray(result.unverifiable)
    || !result.unverifiable.every(text)
    || !result.fixes.every((fix) => fix && text(fix.instruction) && text(fix.evidence) && text(fix.change))
    || result.fixes_needed !== (result.fixes.length > 0)) {
    throw new Error('Checker returned an invalid result. Compliance was not established.');
  }
  if (!result.fixes_needed) result.summary = 'No fixes needed.';
  return result;
}

export async function runWorkflow(request, instructions, agent, emit = () => {}) {
  emit({ type: 'status', message: 'Agent is working…' });
  const first = await agent.start(request);
  const original = first.output;
  let output = original;
  const checks = [];
  const repairs = [];
  emit({ type: 'original', output });

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    emit({ type: 'status', message: `Checking ${attempt === 0 ? 'original output' : `repair ${attempt}`}…` });
    const result = validateCheck(await agent.check(checkerPrompt(request, instructions, output)));
    checks.push(result);
    emit({ type: 'check', attempt, result });

    if (!result.fixes_needed || attempt === MAX_REPAIRS) break;

    emit({ type: 'status', message: `Agent is repairing output (${attempt + 1}/${MAX_REPAIRS})…` });
    const repair = await agent.repair(first.threadId, repairPrompt(request, instructions, output, result));
    if (!repair || typeof repair.output !== 'string' || !repair.output.trim()
      || !Array.isArray(repair.fixes_made)
      || !repair.fixes_made.every((fix) => typeof fix === 'string' && fix.trim())) {
      throw new Error('Agent returned an invalid repair. The previous output is still visible.');
    }
    output = repair.output;
    repairs.push(repair);
    emit({ type: 'repair', attempt: attempt + 1, ...repair });
  }

  const result = { original, revised: output, checks, repairs };
  emit({ type: 'done', repairs: repairs.length, fixes_needed: checks.at(-1).fixes_needed });
  return result;
}
