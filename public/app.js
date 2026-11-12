const form = document.querySelector('#form');
const button = document.querySelector('#run');
const status = document.querySelector('#status');
const original = document.querySelector('#original');
const revised = document.querySelector('#revised');
const note = document.querySelector('#revision-note');
const issues = document.querySelector('#issues');
let finished = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showCheck({ attempt, result }) {
  if (attempt === 0) issues.replaceChildren();
  const block = element('article', '');
  block.append(element('h3', attempt === 0 ? 'Original check' : `Check after repair ${attempt}`));
  block.append(element('p', result.summary, result.fixes_needed ? 'warning' : 'success'));

  const list = element('ol', '');
  for (const fix of result.fixes) {
    const item = element('li', '');
    item.append(element('p', fix.instruction));
    item.append(element('blockquote', fix.evidence));
    item.append(element('p', `Required fix: ${fix.change}`));
    list.append(item);
  }
  if (result.fixes.length) block.append(list);

  if (result.unverifiable.length) {
    const details = element('details', '');
    details.append(element('summary', 'Cannot verify from this output'));
    const items = element('ul', '');
    for (const item of result.unverifiable) items.append(element('li', item));
    details.append(items);
    block.append(details);
  }
  issues.append(block);
}

function showEvent(event) {
  if (event.type === 'status') status.textContent = event.message;
  if (event.type === 'original') {
    original.textContent = event.output;
    original.classList.remove('muted');
  }
  if (event.type === 'check') showCheck(event);
  if (event.type === 'repair') {
    revised.textContent = event.output;
    note.textContent = `Repair ${event.attempt} · awaiting check`;
    const block = element('article', '');
    block.append(element('h3', `Repair ${event.attempt} · fixes made`));
    const list = element('ul', '');
    for (const fix of event.fixes_made) list.append(element('li', fix));
    block.append(list);
    issues.append(block);
  }
  if (event.type === 'done') {
    finished = true;
    if (event.repairs === 0) {
      revised.textContent = original.textContent;
      note.textContent = 'No fixes needed. Output unchanged.';
      status.textContent = 'No fixes needed.';
    } else if (event.fixes_needed) {
      note.textContent = 'Two repairs completed. Remaining issues are shown in the final check.';
      status.textContent = 'Repair limit reached. Issues remain.';
    } else {
      note.textContent = `${event.repairs} repair${event.repairs === 1 ? '' : 's'} completed. No fixes needed.`;
      status.textContent = 'Complete. No fixes needed.';
    }
    status.className = event.fixes_needed ? 'warning' : 'success';
  }
  if (event.type === 'error') throw new Error(event.message);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const request = document.querySelector('#request').value.trim();
  if (!request) return;

  button.disabled = true;
  button.textContent = 'Running…';
  status.className = '';
  status.textContent = 'Starting agent…';
  original.textContent = 'Waiting for the agent…';
  original.classList.add('muted');
  revised.textContent = '';
  note.textContent = 'Waiting for the first check.';
  issues.replaceChildren(element('p', 'Waiting for the checker…', 'muted'));
  finished = false;

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    if (!response.ok) throw new Error(await response.text());

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) if (line.trim()) showEvent(JSON.parse(line));
      }
      if (buffer.trim()) showEvent(JSON.parse(buffer));
    } finally {
      await reader.cancel();
    }
    if (!finished) throw new Error('Connection ended before the final check completed.');
  } catch (error) {
    status.textContent = `Run failed: ${error.message}`;
    status.className = 'warning';
    note.textContent = 'Run incomplete. Any output shown has not passed a final check.';
  } finally {
    button.disabled = false;
    button.textContent = 'Run →';
  }
});
