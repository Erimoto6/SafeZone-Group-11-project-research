const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const requireBackend = createRequire(require.resolve('../src/routes/auth'));
function loadMail(env, smtp = {}) {
  const out = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/mail'), 'utf8'), {
    module:out, process:{env}, console:{log(){}},
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
