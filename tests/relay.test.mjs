import test from 'node:test';
import assert from 'node:assert/strict';
import { keyFromSecret, seal, open, b64 } from '../web/crypto.mjs';
import { GitHubRelay } from '../web/relay.mjs';
const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
test('AES-GCM rejects tampering, wrong keys and cross-repository replay', async () => {
  const key = await keyFromSecret(secret()), envelope = await seal(key, { text: 'private prompt' }, 'owner/repo/state.json');
  assert.deepEqual(await open(key, envelope, 'owner/repo/state.json'), { text: 'private prompt' });
  assert.equal(JSON.stringify(envelope).includes('private prompt'), false);
  await assert.rejects(open(key, envelope, 'other/repo/state.json'));
  await assert.rejects(open(await keyFromSecret(secret()), envelope, 'owner/repo/state.json'));
  await assert.rejects(open(key, { ...envelope, data: envelope.data.slice(4) }, 'owner/repo/state.json'));
});
test('relay refuses public repositories', async () => {
  const r = new GitHubRelay('owner/repo', 'test', await keyFromSecret(secret()), async () => new Response(JSON.stringify({ private: false }), { status: 200 }));
  await assert.rejects(r.verify(), /PRIVATE/);
});
test('chunked binary and image transfer preserves exact bytes and checks checksums', async () => {
  const files = new Map(), key = await keyFromSecret(secret());
  const fakeFetch = async (url, options) => {
    const path = new URL(url).pathname.split('/contents/')[1];
    if (options.method === 'PUT') { const body = JSON.parse(options.body); files.set(path, body.content); return Response.json({ content: { sha: crypto.randomUUID() } }); }
    if (!files.has(path)) return new Response('{}', { status: 404 });
    return Response.json({ type: 'file', sha: 'abc', content: files.get(path) });
  };
  const r = new GitHubRelay('owner/repo', 'test', key, fakeFetch); r.branch = 'main';
  const bytes = new Uint8Array(900000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const meta = await r.upload(new File([bytes], 'binary.zip', { type: 'application/zip' }));
  assert.equal(meta.chunks.length, 3); assert.deepEqual(await r.download(meta), bytes);
  await assert.rejects(r.download({ ...meta, digest: b64(new Uint8Array(32)) }), /Checksum/);
  await assert.rejects(r.download({ ...meta, chunks: ['../state.json'] }), /Path/);
  await assert.rejects(r.upload(new File([new Uint8Array(21 * 1024 * 1024)], 'large.bin')), /20 MiB/);
});
test('default browser fetch keeps its Window/global receiver', async () => {
 const original=globalThis.fetch;
 try {globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve(Response.json({private:true,default_branch:'main'}));};const relay=new GitHubRelay('owner/repo','fixture',await keyFromSecret(secret()));await relay.verify();assert.equal(relay.branch,'main');}finally{globalThis.fetch=original;}
});
