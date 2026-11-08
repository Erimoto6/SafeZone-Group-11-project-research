const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/test-email');
const env = { GMAIL_USER:'safezone.project0@gmail.com', GMAIL_APP_PASSWORD:'abcd efgh ijkl mnop', EMAIL_TEST_TO:'test.owner@gmail.com', EMAIL_TEST_SECRET:'a-test-secret-with-at-least-32-characters' };
function fixture(options = {}) {
  const calls = []; let closed = false;
  const handler = createHandler({ env, createTransport: transportOptions => ({
    sendMail: async message => { calls.push({transportOptions,message}); return {accepted:[env.EMAIL_TEST_TO]}; },
    close: () => {closed = true;}
  }), ...options });
  async function invoke({method='POST',authorization='Bearer '+env.EMAIL_TEST_SECRET,body={}} = {}) {
    const response = { headers:{}, setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;return this;} };
    await handler({method,headers:{authorization},body},response);
    return response;
  }
  return {invoke,calls,isClosed:()=>closed};
}
test('GET and unauthenticated requests cannot send email', async () => {
  const f=fixture();
  assert.equal((await f.invoke({method:'GET'})).statusCode,405);
  assert.equal((await f.invoke({authorization:''})).statusCode,401);
  assert.equal((await f.invoke({authorization:'Bearer wrong-secret'})).statusCode,401);
  assert.equal(f.calls.length,0);
});
test('requires a long secret and complete sender configuration', async () => {
  assert.equal((await fixture({env:{...env,EMAIL_TEST_SECRET:'short'}}).invoke()).statusCode,503);
  assert.equal((await fixture({env:{...env,GMAIL_APP_PASSWORD:''}}).invoke()).statusCode,503);
  assert.equal((await fixture({env:{...env,EMAIL_TEST_TO:'victim@example.com'}}).invoke()).statusCode,503);
});
test('only the configured recipient and fixed test content can be sent', async () => {
  const f=fixture();
  const r=await f.invoke({body:{to:'attacker@gmail.com',subject:'spam',text:'arbitrary content',code:'123456'}});
  assert.equal(r.statusCode,200);assert.equal(r.headers['Cache-Control'],'no-store');
  const {transportOptions:t,message:m}=f.calls[0];
  assert.equal(t.host,'smtp.gmail.com');assert.equal(t.port,465);assert.equal(t.secure,true);
  assert.equal(t.auth.pass,'abcdefghijklmnop');assert.equal(m.to,env.EMAIL_TEST_TO);
  assert.equal(m.from.address,env.GMAIL_USER);assert.equal(m.subject,'SafeZone email delivery test');
  assert(!m.text.includes('123456'));assert.equal(f.isClosed(),true);
});
test('SMTP failures return safe diagnostic codes without leaking secrets', async () => {
  for(const code of ['EAUTH','ETIMEDOUT']) {
    const logs=[];let closed=false;
    const f=fixture({log:(...args)=>logs.push(args),createTransport:()=>({sendMail:async()=>{throw Object.assign(new Error(env.GMAIL_APP_PASSWORD),{code});},close:()=>{closed=true;}})});
    const r=await f.invoke();assert.equal(r.statusCode,502);assert.equal(r.body.code,code);
    assert(!JSON.stringify([r.body,logs]).includes(env.GMAIL_APP_PASSWORD));assert(closed);
  }
});
test('does not claim success when Gmail did not accept the recipient', async()=>{
  const f=fixture({createTransport:()=>({sendMail:async()=>({accepted:[],rejected:[env.EMAIL_TEST_TO]}),close(){}})});
  assert.equal((await f.invoke()).statusCode,502);
});
