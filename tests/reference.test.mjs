import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('original PROMPT MASTER reference stays byte-for-byte unchanged', async () => {
  const bytes = await readFile(new URL('../docs/PROMPT_MASTER_ORIGINAL.md', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'aab34190ef8d6c7b6bfa5b14d8963ac5cc47794763bada1976a8439a4a29ae95');
});
