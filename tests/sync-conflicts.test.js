'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/engine/db/prefs.js');
const a='a'.repeat(32),b='b'.repeat(32);
const payload=(prefix)=>P.backupPayload({avoidList:Array.from({length:80},(_,i)=>(prefix+i).padEnd(80,'漢')),speedMode:'freshest'});
test('two devices can stage writes in the same bank without corrupting either committed backup',async()=>{
  const first=P.toSyncItems(payload('A'),'a',a), second=P.toSyncItems(payload('B'),'a',b);
  const {icBackup:headerA,...partsA}=first, {icBackup:headerB,...partsB}=second;
  for(const head of [headerA,headerB]){
    const cloud={...partsB,...partsA,icBackup:head};
    const restored=await P.readSync({get:async keys=>Object.fromEntries([].concat(keys).map(k=>[k,cloud[k]]))});
    assert.ok(restored.ok);
    assert.equal(restored.values.avoidList[0][0],head._syncDevice===a?'A':'B');
  }
  const partial={...partsA,icBackup:headerB};
  assert.equal(P.fromSyncItems(partial).reason,'incomplete-backup');
  assert.ok(P.fromSyncItems({...partial,...partsB}).ok);
});
test('sync read retries if a new pointer arrives between header and chunk delivery',async()=>{
  const first=P.toSyncItems(payload('A'),'a',a), second=P.toSyncItems(payload('B'),'b',b);
  let reads=0;
  const restored=await P.readSync({get:async keys=>{
    reads++;const cloud=reads===1?first:second;
    return Object.fromEntries([].concat(keys).map(k=>[k,cloud[k]]));
  }});
  assert.ok(restored.ok);assert.equal(restored.values.avoidList[0][0],'B');
});
