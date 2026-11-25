const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {HttpError} = require('../src/http');

test('only the existing Main Admin removes admins; protected accounts and revoked sessions are enforced on the server', async () => {
  const users = new Map([
    [1, {id:1,role:'admin',username:'admin',is_active:1,token_version:0}],
    [2, {id:2,role:'admin',username:'other',is_active:1,token_version:0}],
    [3, {id:3,role:'viewer',username:null,email_kind:'student',is_active:1,token_version:0}]
  ]);
  let snapshot, failDelete=false, rolledBack=false;
  const query = async (sql, params) => {
    const user = users.get(Number(params?.[0]));
    if (sql.startsWith('SELECT * FROM users WHERE id')) return [[...(user?.is_active ? [user] : [])]];
    if (sql.startsWith('SELECT id,role')) return [[...(user ? [user] : [])]];
    if (sql.startsWith('DELETE FROM sms_recipients')) return [{}];
    if (sql.startsWith('DELETE FROM users')) {
      if (failDelete) throw Error('Database failure');
      users.delete(Number(params[0])); return [{}];
    }
    throw Error('Unexpected SQL: '+sql);
  };
  const pool = {query, getConnection:async()=>({query,
    beginTransaction:async()=>{snapshot=new Map(users);},commit:async()=>{},
    rollback:async()=>{rolledBack=true;users.clear();for(const [id,u] of snapshot)users.set(id,u);},release(){}
  })};
  const authModule={exports:{}};
  const authRequire=createRequire(require.resolve('../src/auth'));
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/auth'),'utf8'),{
    module:authModule,process:{env:{JWT_SECRET:'test-secret-'.repeat(5)}},console,
    require:name=>name==='./db'?{pool}:authRequire(name)
  });
  const auth=authModule.exports;
  assert.equal(auth.publicUser(users.get(1)).isMainAdmin,true);
  assert.equal(auth.publicUser(users.get(2)).isMainAdmin,false);
  assert.equal(auth.isMainAdmin({...users.get(3),username:'admin'}),false);
  const routeModule={exports:{}},routeRequire=createRequire(require.resolve('../src/routes/admin'));
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/admin'),'utf8'),{
    module:routeModule,require:name=>name==='../db'?{pool}:name==='../auth'?auth:name==='../users'?{}:routeRequire(name)
  });
  const express=routeRequire('express'),app=express();app.use(express.json());
  app.use('/admin',routeModule.exports);app.get('/private',auth.requireAuth,(req,res)=>res.json({ok:true}));
  app.use((e,req,res,next)=>res.status(e instanceof HttpError?e.status:500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const call=(path,token,method='DELETE')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:token?{Authorization:'Bearer '+token}:{}});
  const owner=auth.sign(users.get(1)),other=auth.sign(users.get(2)),viewer=auth.sign(users.get(3));
  try {
    assert.equal((await call('/admin/admins/2')).status,401);
    assert.equal((await call('/admin/admins/2',viewer)).status,403);
    assert.equal((await call('/admin/admins/1',other)).status,403);
    assert.equal((await call('/admin/admins/2',other)).status,403);
    assert.equal((await call('/admin/admins/1',owner)).status,403);
    assert.equal((await call('/admin/users/1',owner)).status,400,'student route cannot delete the Main Admin');
    assert.equal((await call('/admin/admins/3',owner)).status,400);
    assert.equal((await call('/admin/admins/999',owner)).status,404);
    assert.equal((await call('/admin/admins/invalid',owner)).status,400);
    failDelete=true;
    assert.equal((await call('/admin/admins/2',owner)).status,500);
    assert(rolledBack);assert(users.has(2));
    failDelete=false;
    assert.equal((await call('/private',other,'GET')).status,200);
    assert.equal((await call('/admin/admins/2',owner)).status,200);
    assert(!users.has(2));assert(users.has(1));
    assert.equal((await call('/private',other,'GET')).status,401,'deleted admin session is rejected');
    assert.equal((await call('/private',owner,'GET')).status,200);
  } finally {await new Promise(r=>server.close(r));}
});
