const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const requireBackend = createRequire(require.resolve('../src/routes/auth'));
function loadMail(env, smtp = {}, extra = {}) {
  const out = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/mail'), 'utf8'), {
    module:out, process:{env}, console:{log(){}}, URL, AbortSignal, fetch:extra.fetch,
    require(name) { assert.equal(name,'nodemailer'); return {createTransport: options => { smtp.options = options; return smtp; }}; }
  });
  return out.exports;
}
const env = {NODE_ENV:'production',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_USER:'sender@example.com',SMTP_PASS:'test-only',MAIL_FROM:'SafeZone <sender@example.com>'};

test('production cannot silently use terminal-only reset codes', async () => {
  const mail = loadMail({NODE_ENV:'production'});
  await assert.rejects(mail.ensureDeliveryAvailable(), /not configured/);
  await assert.rejects(mail.sendResetCode('recipient@example.com','123456',10), /not configured/);
  assert.equal(mail.lastCodes.size,0);
});

test('SMTP auth failures fail preflight and can be retried', async () => {
  let broken = true, calls = 0;
  const mail = loadMail(env, {verify:async()=>{calls++;if(broken)throw new Error('Authentication failed');}});
  await assert.rejects(mail.ensureDeliveryAvailable(),/Authentication failed/);
  broken = false;
  await mail.ensureDeliveryAvailable();
  await mail.ensureDeliveryAvailable();
  assert.equal(calls,2);
});

test('Gmail transport sends code to recipient using bounded timeouts without exposing production codes', async () => {
  let message;
  const smtp={verify:async()=>true,sendMail:async m=>{message=m;}};
  const mail=loadMail(env,smtp);
  const result=await mail.sendResetCode('student@iskolarngbayan.pup.edu.ph','654321',10);
  assert.equal(result.sent,true);
  assert.equal(message.to,'student@iskolarngbayan.pup.edu.ph');
  assert.equal(message.from,env.MAIL_FROM);
  assert.match(message.text,/654321/);
  assert.equal(smtp.options.auth.user,env.SMTP_USER);
  assert.equal(smtp.options.secure,false);
  assert(smtp.options.connectionTimeout<15000);
  assert(smtp.options.socketTimeout<15000);
  assert.equal(mail.lastCodes.size,0);
});

test('email outages return the same 503 before account lookup for every address', async () => {
  const express=requireBackend('express');
  const out={exports:{}};let lookups=0;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/auth'),'utf8'),{
    module:out,process:{env:{RATE_LIMIT:'off'}},console:{error(){}},
    require(name){
      if(name==='../mail')return {ensureDeliveryAvailable:async()=>{throw new Error('SMTP unreachable');}};
      if(name==='../db')return {pool:{query:async()=>{lookups++;return [[]];}}};
      if(name==='../auth')return {SECRET:'x'.repeat(32),requireAuth:(req,res,next)=>next()};
      if(name==='../users')return {};
      return requireBackend(name);
    }
  });
  const app=express();app.use(express.json());app.use(out.exports);
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    let previous;
    for(const email of ['known@pup.edu.ph','unknown@pup.edu.ph']){
      const response=await fetch(`http://127.0.0.1:${server.address().port}/forgot`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
      assert.equal(response.status,503);const body=await response.json();
      assert.match(body.error,/temporarily unavailable/);
      if(previous)assert.deepEqual(body,previous);previous=body;
    }
    assert.equal(lookups,0);
  }finally{await new Promise(r=>server.close(r));}
});


test('Railway uses HTTPS relay for recovery and reset without opening SMTP',async()=>{
  const {createHandler}=require('../../vercel-email-test/api/send-code');
  const secret='relay-secret-at-least-32-characters-long',messages=[],requests=[];
  const relay=createHandler({env:{EMAIL_RELAY_SECRET:secret,GMAIL_USER:'sender@gmail.com',GMAIL_APP_PASSWORD:'test'},createTransport:()=>({verify:async()=>{},sendMail:async m=>{messages.push(m);return {accepted:[m.to]};},close(){}})});
  const fetch=async(url,options)=>{
    assert.equal(url,'https://example.vercel.app/api/send-code');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);requests.push(body);
    const res={setHeader(){},status(s){this.statusCode=s;return this;},json(body){this.body=body;}};
    await relay({method:options.method,headers:{authorization:options.headers.Authorization},body},res);
    return{ok:res.statusCode===200,status:res.statusCode,json:async()=>res.body};
  };
  const mail=loadMail({...env,EMAIL_RELAY_URL:'https://example.vercel.app/api/send-code',EMAIL_RELAY_SECRET:secret},{verify:async()=>{throw Error('Railway SMTP must not be used');}}, {fetch});
  for(const purpose of ['recovery','reset'])assert.equal((await mail.sendResetCode('user@gmail.com','654321',10,purpose)).sent,true);
  assert.equal(messages.length,2);assert(requests.some(r=>r.action==='check'));assert.equal(requests.filter(r=>r.action==='check').length,1);
  assert.match(messages[0].subject,/recovery email/);assert.match(messages[1].subject,/password reset/);
  assert.equal(mail.lastCodes.size,0);
});

test('invalid relay configuration fails closed instead of falling back to SMTP',async()=>{
  const mail=loadMail({...env,EMAIL_RELAY_URL:'http://example.com/api/send-code',EMAIL_RELAY_SECRET:'x'.repeat(40)});
  await assert.rejects(mail.ensureDeliveryAvailable(),/Invalid email relay/);
});

test('relay authentication and connection errors are reported safely',async()=>{
  const config={NODE_ENV:'production',EMAIL_RELAY_URL:'https://example.vercel.app/api/send-code',EMAIL_RELAY_SECRET:'x'.repeat(40)};
  const denied=loadMail(config,{}, {fetch:async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})})});
  await assert.rejects(denied.ensureDeliveryAvailable(),e=>e.code==='RELAY_AUTH');
  const timeout=loadMail(config,{}, {fetch:async()=>{throw new Error('private detail');}});
  await assert.rejects(timeout.ensureDeliveryAvailable(),e=>e.code==='RELAY_CONNECTION'&&!e.message.includes('private detail'));
});

test('Vercel setup failures preserve safe reason and HTTP status for diagnosis',async()=>{
 const config={NODE_ENV:'production',EMAIL_RELAY_URL:'https://example.vercel.app/api/send-code',EMAIL_RELAY_SECRET:'x'.repeat(40)};
 for(const code of ['RELAY_NOT_CONFIGURED','SENDER_NOT_CONFIGURED']){
  const mail=loadMail(config,{}, {fetch:async()=>({ok:false,status:503,json:async()=>({code})})});
  await assert.rejects(mail.ensureDeliveryAvailable(),e=>e.code===code&&e.relayStatus===503);
 }
});

test('webmail delivery test uses HTTPS without creating recovery codes',async()=>{
 const requests=[];
 const mail=loadMail({NODE_ENV:'production',EMAIL_RELAY_URL:'https://example.vercel.app/api/send-code',EMAIL_RELAY_SECRET:'x'.repeat(40)}, {}, {fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({ok:true})};}});
 assert.equal((await mail.sendWebmailTest('student@iskolarngbayan.pup.edu.ph')).sent,true);
 assert.deepEqual(requests.at(-1),{action:'test',to:'student@iskolarngbayan.pup.edu.ph'});
 assert.equal(mail.lastCodes.size,0);
});
