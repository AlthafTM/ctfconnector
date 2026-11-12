import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRelay } from '../web/relay.mjs';
import { keyFromSecret } from '../web/crypto.mjs';
test('branch contention retries the same write but never overwrites a changed file', async () => {
 const key=await keyFromSecret(Buffer.alloc(32,3).toString('base64url'));
 let puts=0;const relay=new GitHubRelay('owner/repo','test',key,async(_url,options)=>{if(options.method==='PUT'){puts++;return puts===1?new Response('{}',{status:409}):Response.json({content:{sha:'saved'}});}return new Response('{}',{status:404});});
 assert.equal((await relay.write('commands/test.json',{id:'same'})).content.sha,'saved');assert.equal(puts,2);
 const conflict=new GitHubRelay('owner/repo','test',key);let attempts=0;conflict.api=async()=>{attempts++;throw Object.assign(new Error('conflict'),{status:409});};conflict.read=async()=>({sha:'changed'});
 await assert.rejects(conflict.write('state.json',{},'expected'),/conflict/);assert.equal(attempts,1);
});
