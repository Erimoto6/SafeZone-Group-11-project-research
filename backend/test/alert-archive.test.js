const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const backendRequire=createRequire(require.resolve('../src/routes/alerts'));
const {HttpError}=require('../src/http');
test('archiving is reversible and private to each account without deleting alerts; missing migration keeps Current usable',async()=>{
 const records=[{id:1,room_id:10,room_no:101,type:'warning',title:'Temperature',body:'Warning: 29',ts:123},{id:2,room_id:11,room_no:102,type:'exceeded',title:'CO2',body:'limit: 1000',ts:124}];
 const bookmarks=new Set();let missing=false,failWrite=false,rolledBack=false,snapshot;
 const query=async(sql,p)=>{
  if(sql.startsWith('SELECT id FROM alerts'))return [records.filter(r=>p[0].includes(r.id))];
  if(sql.includes('alert_archives')&&missing)throw Object.assign(Error('Missing table'),{code:'ER_NO_SUCH_TABLE'});
  if(sql.startsWith('INSERT IGNORE')){if(failWrite)throw Error('write failure');p[0].forEach(([user,id])=>bookmarks.add(user+':'+id));return [{}]}
  if(sql.startsWith('DELETE FROM alert_archives')){p[1].forEach(id=>bookmarks.delete(p[0]+':'+id));return [{}]}
  if(sql.includes('FROM alerts a')){
   const joined=sql.includes('LEFT JOIN alert_archives'),[user,room]=joined?p:[null,p[0]], archived=sql.includes('IS NOT NULL');
   return [records.filter(r=>(room===null||r.room_id===room)&&(!joined||bookmarks.has(user+':'+r.id)===archived)).map(r=>({...r,archived_at:joined&&bookmarks.has(user+':'+r.id)?'2026-11-12':null}))];
  }
  throw Error('Unexpected SQL '+sql);
 };
 const pool={query,getConnection:async()=>({query,beginTransaction:async()=>{snapshot=new Set(bookmarks)},commit:async()=>{},rollback:async()=>{rolledBack=true;bookmarks.clear();snapshot.forEach(x=>bookmarks.add(x))},release(){}})};
 const out={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/alerts'),'utf8'),{module:out,Buffer,process:{env:{}},require:name=>name==='../db'?{pool}:name==='../auth'?{requireAuth:(req,res,next)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.user={id:Number(req.headers['x-user'])};next()}}:name==='../poll-limit'?(req,res,next)=>next():backendRequire(name)});
 const express=backendRequire('express'),app=express();app.use(express.json());app.use('/alerts',out.exports);app.use((e,req,res,next)=>res.status(e instanceof HttpError?e.status:500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=(path,user=7,body)=>fetch('http://127.0.0.1:'+server.address().port+path,{method:body?'PUT':'GET',headers:{...(user?{'x-user':String(user)}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const list=async(user,archived=false)=>(await (await call('/alerts?roomId=10&archived='+Number(archived),user)).json());
 try{
  assert.equal((await call('/alerts',null)).status,401);
  assert.equal((await call('/alerts/archive',null,{ids:[1],archived:true})).status,401);
  assert.equal((await list(7)).alerts.length,1);
  for(const body of [{ids:[],archived:true},{ids:[-1],archived:true},{ids:[1],archived:'true'},{ids:['1'],archived:true}])assert.equal((await call('/alerts/archive',7,body)).status,400);
  assert.equal((await call('/alerts/archive',7,{ids:[999],archived:true})).status,404);
  assert.equal((await call('/alerts/archive',7,{ids:[1,1],archived:true})).status,200);
  assert.equal((await list(7)).alerts.length,0);assert.equal((await list(7,true)).alerts[0].archived,true);
  assert.equal((await list(8)).alerts.length,1);assert.equal((await list(8,true)).alerts.length,0);
  assert.equal((await call('/alerts/archive',8,{ids:[1],archived:false})).status,200);assert.equal((await list(7,true)).alerts.length,1);
  assert.equal((await call('/alerts/archive',7,{ids:[1],archived:false})).status,200);assert.equal((await list(7)).alerts.length,1);
  failWrite=true;assert.equal((await call('/alerts/archive',7,{ids:[1],archived:true})).status,500);assert(rolledBack);assert.equal((await list(7)).alerts.length,1);failWrite=false;
  missing=true;assert.equal((await list(7)).archiveAvailable,false);assert.equal((await list(7)).alerts.length,1);assert.deepEqual((await list(7,true)).alerts,[]);
  assert.equal((await call('/alerts/archive',7,{ids:[1],archived:true})).status,503);
  assert.equal(records.length,2,'original records retained');
 }finally{await new Promise(r=>server.close(r))}
});
