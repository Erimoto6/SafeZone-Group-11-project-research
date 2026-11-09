const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const reqBackend=createRequire(require.resolve('../src/routes/admin'));
const {HttpError}=require('../src/http');
test('every admin can permanently delete active/inactive students; sessions and related records are revoked',async()=>{
 const student=()=>({id:42,role:'viewer',email_kind:'student',is_active:1,token_version:0});
 const users=new Map([[7,{id:7,role:'admin',is_active:1,token_version:0}],[8,{id:8,role:'admin',is_active:1,token_version:0}],[42,student()],[43,{id:43,role:'viewer',email_kind:'faculty',is_active:1,token_version:0}]]);
 let sms=true,resets=1,recovery=true,snapshot,failDelete=false,rolledBack=false;
 const query=async(sql,p)=>{
  if(sql.startsWith('SELECT * FROM users WHERE id')){const u=users.get(Number(p[0]));return [[...(u?.is_active?[u]:[])]];}
  if(sql.startsWith('SELECT user_id,course_code'))return [[]];
  if(sql.startsWith('SELECT id,role'))return [[...(users.has(p[0])?[{...users.get(p[0])}]:[])]];
  if(sql.startsWith('DELETE FROM sms_recipients')){sms=false;return [{}];}
  if(sql.startsWith('DELETE FROM users')){if(failDelete)throw Error('simulated database failure');users.delete(p[0]);resets=0;recovery=false;return [{}];}
  if(sql.startsWith('SELECT * FROM users WHERE is_active'))return [[...users.values()].filter(u=>u.is_active || (u.role==='viewer' && u.email_kind==='student'))];
  throw Error('Unexpected SQL '+sql);
 };
 const pool={query,getConnection:async()=>({query,beginTransaction:async()=>{snapshot={student:{...users.get(42)},sms,resets,recovery};},commit:async()=>{snapshot=null;},rollback:async()=>{rolledBack=true;if(snapshot){users.set(42,snapshot.student);sms=snapshot.sms;resets=snapshot.resets;recovery=snapshot.recovery;snapshot=null;}},release(){}})};
 const authModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/auth'),'utf8'),{module:authModule,process:{env:{JWT_SECRET:'test-secret-'.repeat(5)}},console,require:name=>name==='./db'?{pool}:createRequire(require.resolve('../src/auth'))(name)});
 const auth=authModule.exports,out={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/admin'),'utf8'),{module:out,require:name=>name==='../db'?{pool}:name==='../auth'?auth:name==='../users'?{}:reqBackend(name)});
 const express=reqBackend('express'),app=express();app.use(express.json());app.use('/admin',out.exports);app.get('/private',auth.requireAuth,(req,res)=>res.json({ok:true}));app.use((e,req,res,next)=>res.status(e instanceof HttpError?e.status:500).json({error:e.status?e.message:'Server error'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,token,method='DELETE')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:token?{Authorization:'Bearer '+token}:{}});
 try{
  const studentToken=auth.sign(users.get(42)),adminToken=auth.sign(users.get(7));
  assert.equal((await call('/admin/users/42')).status,401);
  assert.equal((await call('/admin/users/42',studentToken)).status,403);
  assert.equal((await call('/admin/users/7',adminToken)).status,400);
  assert.equal((await call('/admin/users/43',adminToken)).status,400);
  assert.equal((await call('/admin/users/999',adminToken)).status,404);
  assert.equal((await call('/admin/users/invalid',adminToken)).status,400);
  for(const id of [7,8]){
   users.set(42,student());sms=true;resets=1;recovery=true;
   const session=auth.sign(users.get(42));
   assert.equal((await call('/private',session,'GET')).status,200);
   assert.equal((await call('/admin/users/42',auth.sign(users.get(id)))).status,200);
   assert.equal(users.has(42),false);assert.equal(sms,false);assert.equal(resets,0);assert.equal(recovery,false);
   assert.equal((await call('/private',session,'GET')).status,401);
  }
  users.set(42,{...student(),is_active:0});
  const listed=await (await call('/admin/users',adminToken,'GET')).json();
  assert(listed.viewers.some(u=>u.id===42 && u.active===false),'previously removed student is listed for permanent deletion');
  assert.equal((await call('/admin/users/42',adminToken)).status,200);assert(!users.has(42));
  users.set(42,student());sms=true;resets=1;recovery=true;failDelete=true;rolledBack=false;
  assert.equal((await call('/admin/users/42',adminToken)).status,500);
  assert.equal(users.get(42).is_active,1);assert.equal(sms,true);assert.equal(resets,1);assert(rolledBack);
 }finally{await new Promise(r=>server.close(r));}
});
