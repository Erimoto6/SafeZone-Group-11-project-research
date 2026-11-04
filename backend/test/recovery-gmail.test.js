const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const reqBackend=createRequire(require.resolve('../src/routes/auth'));
const bcrypt=reqBackend('bcryptjs'),{HttpError}=require('../src/http');

test('verified recovery Gmail: authentication, proof, limits, replacement and fixed reset recipient',async()=>{
 const user={id:7,email:'student@iskolarngbayan.pup.edu.ph',password_hash:await bcrypt.hash('original1',4)};
 let row=null,resets=[],sent=[],hashes=[];
 const query=async(sql,p=[])=>{
  const q=sql.replace(/\s+/g,' ');
  if(q.startsWith('INSERT IGNORE INTO account_recovery')){row??={email:null,pending_email:null,requested_at:null,attempts:0};return [{}];}
  if(q.startsWith('SELECT TIMESTAMPDIFF'))return [[{elapsed:row.requested_at==null?null:(Date.now()-row.requested_at)/1000}]];
  if(q.startsWith('UPDATE account_recovery SET pending_email=?')){Object.assign(row,{pending_email:p[0],code_hash:p[1],attempts:0,requested_at:Date.now(),expires_at:Date.now()+600000});hashes.push(p[1]);return [{}];}
  if(q.startsWith('SELECT *,expires_at'))return [[{...row,valid:row.expires_at>Date.now()}]];
  if(q.startsWith('UPDATE account_recovery SET attempts')){row.attempts++;return [{}];}
  if(q.startsWith('UPDATE account_recovery SET email=pending_email')){Object.assign(row,{email:row.pending_email,pending_email:null,code_hash:null,expires_at:null,attempts:0});return [{}];}
  if(q.startsWith('SELECT email,pending_email'))return [[row?{...row,valid:row.expires_at>Date.now()}:undefined].filter(Boolean)];
  if(q.startsWith('SELECT u.id,r.email'))return [[...(p[0]===user.email&&row?.email?[{id:user.id,recovery_email:row.email}]:[])]];
  if(q.startsWith('DELETE FROM password_resets')){resets=[];return [{}];}
  if(q.startsWith('INSERT INTO password_resets')){resets.push({user_id:p[0],code_hash:p[1]});return [{}];}
  if(q.startsWith('INSERT INTO notification_log'))return [{}];
  throw Error('Unhandled SQL: '+q);
 };
 const pool={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})};
 const mail={ensureDeliveryAvailable:async()=>{},sendResetCode:async(to,code,minutes,purpose)=>{sent.push({to,code,purpose});return {sent:true};}};
 const auth={SECRET:'test-secret-'.repeat(5),requireAuth:(req,res,next)=>{if(req.headers.authorization!=='Bearer test')return next(new HttpError(401,'Please log in.'));req.user=user;next();}};
 function load(path){const out={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve(path),'utf8'),{module:out,process:{env:{RATE_LIMIT:'off'}},Buffer,console,require(name){if(name==='../db')return{pool};if(name==='../mail')return mail;if(name==='../auth')return auth;if(name==='../users')return{};return reqBackend(name);}});return out.exports;}
 const express=reqBackend('express'),app=express();app.use(express.json());app.use('/recovery',load('../src/routes/recovery'));app.use('/auth',load('../src/routes/auth'));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,body,loggedIn=true)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(loggedIn?{Authorization:'Bearer test'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()};};
 try{
  assert.equal((await call('/recovery')).body.email,null);
  assert.equal((await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'original1'},false)).status,401);
  assert.equal((await call('/recovery/request',{email:'mine@outlook.com',currentPassword:'original1'})).status,400);
  assert.equal((await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'wrong1'})).status,400);
  assert.equal((await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'original1'})).status,200);
  const first=sent.at(-1);assert.equal(first.to,'mine@gmail.com');assert.equal(first.purpose,'recovery');assert.notEqual(hashes[0],first.code);
  assert.equal(row.email,null,'requesting a code does not trust the address');
  assert.equal((await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'original1'})).status,429);
  const wrong=first.code==='111111'?'222222':'111111';
  for(let i=0;i<5;i++)assert.equal((await call('/recovery/verify',{code:wrong})).status,400);
  assert.equal((await call('/recovery/verify',{code:first.code})).status,400,'five guesses lock verification');
  row.requested_at-=31000;
  await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'original1'});
  const valid=sent.at(-1).code;
  row.expires_at=Date.now()-1;
  assert.equal((await call('/recovery/verify',{code:valid})).status,400,'expired code rejected');
  row.requested_at-=31000;
  await call('/recovery/request',{email:'mine@gmail.com',currentPassword:'original1'});
  assert.equal((await call('/recovery/verify',{code:sent.at(-1).code})).status,200);
  assert.equal(row.email,'mine@gmail.com');
  assert.equal((await call('/recovery/verify',{code:valid})).status,400,'cannot reuse a verified code');
  row.requested_at-=31000;
  await call('/recovery/request',{email:'replacement@gmail.com',currentPassword:'original1'});
  const replacementCode=sent.at(-1).code;
  assert.equal(row.email,'mine@gmail.com','pending replacement preserves verified Gmail');
  const forgot=await call('/auth/forgot',{email:user.email,recoveryEmail:'attacker@gmail.com'},false);
  assert.equal(forgot.status,200);assert.equal(sent.at(-1).to,'mine@gmail.com','reset ignores caller-supplied recipient');assert.equal(resets.length,1);
  const unknown=await call('/auth/forgot',{email:'unknown@pup.edu.ph'},false);
  assert.deepEqual(unknown.body,forgot.body,'no account or recovery address enumeration');
  assert.equal((await call('/recovery/verify',{code:replacementCode})).status,200);
  assert.equal(row.email,'replacement@gmail.com');assert.equal(resets.length,0,'replacement invalidates old reset codes');
  assert.equal(user.email,'student@iskolarngbayan.pup.edu.ph','PUP identity stays unchanged');
 }finally{await new Promise(r=>server.close(r));}
});
