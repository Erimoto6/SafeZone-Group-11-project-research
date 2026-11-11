const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const base=createRequire(require.resolve('../src/routes/auth')),baseAuth=createRequire(require.resolve('../src/auth'));
const bcrypt=base('bcryptjs'),jwt=base('jsonwebtoken'),crypto=require('node:crypto');
const SECRET='pup-reset-test-secret-'.repeat(3);
async function fixture(role){
 let clock=Date.now(),rows=new Map(),nextId=1,snapshot=null;
 const user={id:7,role,username:role==='admin'?'admin':null,email:role==='admin'?'admin@pup.edu.ph':'student@iskolarngbayan.pup.edu.ph',email_kind:role==='admin'?'faculty':'student',phone:'09123456789',is_active:1,token_version:0,password_hash:await bcrypt.hash('Original1',4)};
 const sent=[];
 const query=async(sql,args=[])=>{
  const q=sql.replace(/\s+/g,' ');
  if(q.startsWith('SELECT id,email FROM users'))return [[...(user.email===args[0]&&user.is_active?[{id:user.id,email:user.email}]:[])]];
  if(q.startsWith('SELECT email FROM users WHERE id'))return [[...(user.id===args[0]&&user.is_active?[{email:user.email}]:[])]];
  if(q.startsWith('SELECT * FROM users WHERE id'))return [[...(user.id===Number(args[0])&&user.is_active?[{...user}]:[])]];
  if(q.startsWith('SELECT * FROM users WHERE email'))return [[...(user.email===args[0]&&user.is_active?[{...user}]:[])]];
  if(q.startsWith('DELETE FROM password_resets')){for(const [id,r]of rows)if(r.user_id===args[0]&&!r.used_at)rows.delete(id);return [{}];}
  if(q.startsWith('INSERT INTO password_resets')){const id=nextId++;rows.set(id,{id,user_id:args[0],code_hash:args[1],expires_at:clock+args[2]*60000,attempts:0,verified_at:null,used_at:null});return [{insertId:id}];}
  if(q.startsWith('INSERT INTO notification_log')||q.startsWith('UPDATE users SET last_login_at'))return [{}];
  if(q.startsWith('SELECT r.id, r.code_hash')){const matches=[...rows.values()].filter(r=>user.email===args[0]&&user.is_active&&!r.used_at&&!r.verified_at&&r.expires_at>clock).sort((a,b)=>b.id-a.id);return [matches.slice(0,1).map(r=>({...r}))];}
  if(q.startsWith('UPDATE password_resets SET attempts')){const r=rows.get(args[0]);if(!r||r.attempts>=args[1])return [{affectedRows:0}];r.attempts++;return [{affectedRows:1}];}
  if(q.startsWith('UPDATE password_resets SET verified_at')){rows.get(args[0]).verified_at=clock;return [{affectedRows:1}];}
  if(q.startsWith('UPDATE password_resets SET used_at')){const r=rows.get(args[0]);if(!r||r.user_id!==args[1]||!r.verified_at||r.used_at||r.verified_at<=clock-args[2]*60000)return [{affectedRows:0}];r.used_at=clock;return [{affectedRows:1}];}
  if(q.startsWith('UPDATE users SET password_hash')){assert.equal(args[1],user.id);user.password_hash=args[0];user.token_version++;return [{affectedRows:1}];}
  throw Error('Unexpected SQL (recovery Gmail must not be queried): '+q);
 };
 const pool={query,getConnection:async()=>({query,beginTransaction:async()=>{snapshot={user:{...user},rows:structuredClone(rows)};},commit:async()=>{snapshot=null;},rollback:async()=>{if(snapshot){Object.assign(user,snapshot.user);rows=snapshot.rows;snapshot=null;}},release(){}})};
 const authOut={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/auth'),'utf8'),{module:authOut,process:{env:{JWT_SECRET:SECRET}},console,require:name=>name==='./db'?{pool}:baseAuth(name)});
 const auth=authOut.exports,out={exports:{}};
 class Clock extends Date{static now(){return clock;}}
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/auth'),'utf8'),{module:out,Buffer,Date:Clock,process:{env:{RATE_LIMIT:'off'}},console,require(name){if(name==='../db')return{pool};if(name==='../auth')return auth;if(name==='../users')return{getUser:async()=>user};if(name==='../mail')return{ensureDeliveryAvailable:async()=>{},sendResetCode:async(to,code)=>{sent.push({to,code});return{sent:true};}};return base(name);}});
 const express=base('express'),app=express();app.use(express.json());app.use(out.exports);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.status?e.message:'Unexpected test error: '+e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,body,token)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};};
 return{user,sent,auth,call,latest:()=>[...rows.values()].at(-1),advance:()=>{clock+=31000;},close:()=>new Promise(r=>server.close(r))};
}
for(const role of ['admin','viewer'])test(`${role} can reset via registered PUP email without recovery Gmail, revoking old password and sessions`,async()=>{
 const f=await fixture(role);try{
  const session=f.auth.sign(f.user);
  const forgot=await f.call('/forgot',{email:f.user.email,recoveryEmail:'attacker@gmail.com'});
  assert.equal(forgot.status,200);assert.equal(f.sent.at(-1).to,f.user.email);
  assert.equal((await f.call('/forgot',{email:f.user.email})).status,429);
  const unknown=await f.call('/forgot',{email:'unknown@pup.edu.ph'});assert.deepEqual(unknown.body,forgot.body);assert.equal(f.sent.length,1);
  assert.notEqual(f.latest().code_hash,f.sent[0].code);
  const verified=await f.call('/verify-code',{email:f.user.email,code:f.sent[0].code});assert.equal(verified.status,200);
  const grant=verified.body.resetToken;assert.equal(jwt.verify(grant,SECRET).channel,'pup-webmail');
  assert.equal((await f.call('/me',undefined,grant)).status,401,'reset grant is not a login');
  assert.equal((await f.call('/reset',{resetToken:grant,newPassword:'short'})).status,400);
  assert.equal((await f.call('/reset',{resetToken:grant,newPassword:'Newpass2'})).status,200);
  assert.equal((await f.call('/reset',{resetToken:grant,newPassword:'Another3'})).status,400);
  assert.equal((await f.call('/login',{identifier:f.user.email,password:'Original1'})).status,401);
  assert.equal((await f.call('/login',{identifier:f.user.email,password:'Newpass2'})).status,200);
  assert.equal((await f.call('/me',undefined,session)).status,401);
 }finally{await f.close();}
});
test('PUP reset rejects old Gmail codes/grants, expired codes, excess guesses and email changes',async()=>{
 const f=await fixture('viewer');try{
  await f.call('/forgot',{email:f.user.email});let code=f.sent.at(-1).code;
  f.latest().code_hash=crypto.createHmac('sha256',SECRET).update(code).digest('hex');
  assert.equal((await f.call('/verify-code',{email:f.user.email,code})).status,400,'pre-switch hash is invalid');
  const legacy=jwt.sign({purpose:'reset',rid:f.latest().id,sub:f.user.id},SECRET,{expiresIn:'10m'});
  assert.equal((await f.call('/reset',{resetToken:legacy,newPassword:'Newpass2'})).status,400);
  f.advance();await f.call('/forgot',{email:f.user.email});code=f.sent.at(-1).code;f.latest().expires_at=0;
  assert.equal((await f.call('/verify-code',{email:f.user.email,code})).status,400);
  f.advance();await f.call('/forgot',{email:f.user.email});code=f.sent.at(-1).code;
  for(let i=0;i<5;i++)assert.equal((await f.call('/verify-code',{email:f.user.email,code:'000000'})).status,400);
  assert.equal((await f.call('/verify-code',{email:f.user.email,code})).status,400);
  f.advance();await f.call('/forgot',{email:f.user.email});code=f.sent.at(-1).code;
  const grant=(await f.call('/verify-code',{email:f.user.email,code})).body.resetToken;
  f.user.email='changed@iskolarngbayan.pup.edu.ph';
  assert.equal((await f.call('/reset',{resetToken:grant,newPassword:'Newpass2'})).status,400);
 }finally{await f.close();}
});
