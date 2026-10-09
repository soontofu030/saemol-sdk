import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { PurchaseStore } from './store.mjs'
import { createHandlers } from './handlers.mjs'

test('duplicate grants survive a restart; refund before payment stays revoked', () => {
  const dir = mkdtempSync(join(tmpdir(),'saemol-receipts-')); const path = join(dir,'purchases.sqlite')
  let store = new PurchaseStore(path)
  try {
    const purchase = { eventId:'paid:o1',orderId:'o1',userId:'u1',itemCode:'credit',quantity:100 }
    store.apply(purchase); store.close(); store=new PurchaseStore(path); store.apply(purchase)
    assert.equal(store.forUser('u1').length,1)
    store.apply({ eventId:'refund:o2',orderId:'o2',revoke:true })
    store.apply({ ...purchase,eventId:'paid:o2',orderId:'o2' })
    assert.equal(store.isActive('o2'),false)
    store.apply({ eventId:'refund:o1',orderId:'o1',revoke:true })
    assert.equal(store.forUser('u1').length,0)
  } finally { store.close(); rmSync(dir,{ recursive:true,force:true }) }
})
test('failed grant rolls back the dedupe receipt so the event can retry', () => {
  const store = new PurchaseStore(':memory:')
  try {
    store.db.exec("CREATE TRIGGER fail_grant BEFORE INSERT ON purchases BEGIN SELECT RAISE(ABORT,'temporary'); END")
    assert.throws(() => store.apply({ eventId:'e',orderId:'o',userId:'u',itemCode:'pro' }))
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM processed_events').get().n,0)
    store.db.exec('DROP TRIGGER fail_grant')
    assert.equal(store.apply({ eventId:'e',orderId:'o',userId:'u',itemCode:'pro' }).active,true)
  } finally { store.close() }
})
test('lost application confirmation retries without granting twice', async () => {
  const store = new PurchaseStore(':memory:'); const secret='fixture-only'; let attempts=0
  const handlers=createHandlers({ store,webhookSecret:secret,resolveUserId:()=>'u',allowedItemCodes:['pro'],saemol:{
    getCheckout:async()=>({ status:'completed',order_id:'o',external_user_id:'u',item_code:'pro',entitlement:{ status:'active' } }),
    acknowledgeCheckout:async()=>{ if (++attempts===1) throw new Error('lost response') },
  } })
  const body=JSON.stringify({ event:'checkout.completed',event_id:'event',data:{ order_id:'o',session_id:'s',external_user_id:'u',item_code:'pro' } })
  const timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')
  const request=()=>new Request('http://localhost/webhook',{ method:'POST',body,headers:{ 'x-saemol-timestamp':timestamp,'x-saemol-signature':signature,'x-saemol-event-id':'event' } })
  try {
    assert.equal((await handlers.webhook(request())).status,503)
    assert.equal((await handlers.webhook(request())).status,200)
    assert.equal(attempts,2); assert.equal(store.forUser('u').length,1)
  } finally { store.close() }
})
