const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const base=createRequire(require.resolve('../src/routes/auth'));
test('PUP test requires login and sends only to the registered address',async()=>{
 const sent=[],out={exports:{}};let available=true;
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/auth'),'utf8'),{module:out,Buffer,console:{error(){}},process:{env:{RATE_LIMIT:'off'}},require(name){
  if(name==='../db')return {pool:{query:async()=>{throw Error('Delivery test must not change database records');}}};
  if(name==='../mail')return{sendWebmailTest:async to=>{if(!available)throw Error('Unavailable');sent.push(to);}};
  if(name==='../users')return {};
  if(name==='../auth')return{SECRET:'x'.repeat(40),requireAuth:(req,res,next)=>{if(req.headers.authorization!=='Bearer session')return res.status(401).json({error:'Please log in.'});req.user={id:7,email:'admin@pup.edu.ph',role:'admin'};next();}};
  return base(name);
 }});
 const express=base('express'),app=express();app.use(express.json());app.use(out.exports);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function call(auth){return fetch(`http://127.0.0.1:${server.address().port}/me/test-webmail`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer session'}:{})},body:JSON.stringify({to:'attacker@gmail.com',email:'other@pup.edu.ph'})});}
 try{
  assert.equal((await call(false)).status,401);assert.equal(sent.length,0);
  assert.equal((await call(true)).status,200);assert.deepEqual(sent,['admin@pup.edu.ph']);
  available=false;assert.equal((await call(true)).status,503);
 }finally{await new Promise(r=>server.close(r));}
});
