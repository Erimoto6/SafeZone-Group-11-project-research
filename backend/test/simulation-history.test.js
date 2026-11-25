const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const HOUR=3600000,now=Date.UTC(2026,10,16,12);
function historyStore(seed=[]){
 let rows=seed.map(r=>({...r})),missing=false,failure=false;
 const queries=[];
 const query=async(sql,p=[])=>{
  queries.push({sql,p});
  if(sql.startsWith('SELECT id FROM rooms'))return [[...([1,2].includes(p[0])?[{id:p[0]}]:[])]];
  if(missing)throw Object.assign(Error('Missing table'),{code:'ER_NO_SUCH_TABLE'});
  if(failure)throw Error('Database failure');
  if(sql.startsWith('DELETE FROM simulation_history')){rows=rows.filter(r=>r.bucket_ms>=p[0]);return [{}];}
  if(sql.startsWith('INSERT INTO simulation_history')){
   const [room_id,bucket_ms,first_ms,last_ms]=p;
   let row=rows.find(r=>r.room_id===room_id&&r.bucket_ms===bucket_ms);
   if(!row){row={room_id,bucket_ms,first_ms,last_ms,samples:0};for(const k of ['temp','hum','co2'])Object.assign(row,{[k+'_sum']:0,[k+'_min']:Infinity,[k+'_max']:-Infinity});rows.push(row);}
   row.samples++;row.first_ms=Math.min(row.first_ms,first_ms);row.last_ms=Math.max(row.last_ms,last_ms);
   ['temp','hum','co2'].forEach((k,i)=>{const value=p[4+i*3];row[k+'_sum']+=value;row[k+'_min']=Math.min(row[k+'_min'],value);row[k+'_max']=Math.max(row[k+'_max'],value)});
   return [{}];
  }
  const metric=sql.match(/SUM\((temp|hum|co2)_sum\)/)?.[1];
  if(!metric)throw Error('Unexpected SQL: '+sql);
  const grouped=sql.startsWith('SELECT FLOOR'),[id,from,to]=grouped?p.slice(1):p;
  const matches=rows.filter(r=>r.room_id===id&&r.bucket_ms>=from&&r.bucket_ms<=to);
  const stats=list=>({samples:list.reduce((n,r)=>n+r.samples,0),firstAt:list.length?Math.min(...list.map(r=>r.first_ms)):null,lastAt:list.length?Math.max(...list.map(r=>r.last_ms)):null,lowest:list.length?Math.min(...list.map(r=>r[metric+'_min'])):null,highest:list.length?Math.max(...list.map(r=>r[metric+'_max'])):null,average:list.length?list.reduce((n,r)=>n+r[metric+'_sum'],0)/list.reduce((n,r)=>n+r.samples,0):null});
  if(!grouped)return [[stats(matches)]];
  const bins=new Map();for(const row of matches){const bucket=Math.floor(row.bucket_ms/p[0]);if(!bins.has(bucket))bins.set(bucket,[]);bins.get(bucket).push(row);}
  return [[...bins.entries()].sort(([a],[b])=>a-b).map(([bucket,list])=>{const s=stats(list);return {bucket,at:s.firstAt,value:s.average,lowest:s.lowest,highest:s.highest,samples:s.samples}})];
 };
 const out={exports:{}},native=createRequire(require.resolve('../src/simulation-history'));
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/simulation-history'),'utf8'),{module:out,console,require:name=>name==='./db'?{pool:{query}}:native(name)});
 return {api:out.exports,conn:{query},queries,rows:()=>rows,setMissing:value=>{missing=value},setFailure:value=>{failure=value}};
}
function row(room_id,age,value,samples=1){const time=now-age*HOUR;return {room_id,bucket_ms:time,first_ms:time,last_ms:time,samples,temp_sum:27*samples,temp_min:26,temp_max:28,hum_sum:55*samples,hum_min:50,hum_max:60,co2_sum:value*samples,co2_min:value-100,co2_max:value+100};}
test('6h, 24h and 7d use different saved windows, room isolation and weighted statistics',async()=>{
 const store=historyStore([row(1,2,1000,2),row(1,12,800),row(1,72,600),row(1,192,99),row(2,1,5000)]);
 for(const [range,count,average,points] of [['6h',2,1000,1],['24h',3,2800/3,2],['7d',4,850,3]]){
  const data=await store.api.read({roomId:'1',metric:'co2',range},now);
  assert.equal(data.count,count);assert.equal(data.points.length,points);assert.equal(data.stats.avg,average);
  assert.equal(data.stats.max,1100);assert(data.points.every(p=>p.at>=data.from&&p.at<=data.to));
 }
 assert.equal((await store.api.read({roomId:'1',metric:'co2',range:'7d'},now)).stats.min,500);
 assert.equal((await store.api.read({roomId:'1',metric:'temp',range:'6h'},now)).stats.avg,27);
 assert.equal((await store.api.read({roomId:'2',metric:'co2',range:'6h'},now)).stats.avg,5000);
});
test('stored history persists between readers and aggregates real ticks without inventing older points',async()=>{
 const store=historyStore(),state={room_id:1,temp:26,hum:55,co2:800};
 await store.api.record(store.conn,state,now);await store.api.record(store.conn,{...state,co2:1200},now+2000);
 assert.equal(store.rows().length,1);assert.equal(store.rows()[0].samples,2);
 const data=await store.api.read({roomId:'1',metric:'co2',range:'7d'},now+4000);
 assert.equal(data.count,2);assert.equal(data.points.length,1);assert.equal(data.stats.avg,1000);assert.equal(data.stats.min,800);assert.equal(data.stats.max,1200);
 assert.equal(data.firstAt,now);assert.equal(data.lastAt,now+2000);
 await store.api.record(store.conn,state,now+60000);assert.equal(store.rows().length,2);
});
test('empty history has no fabricated chart points or statistics',async()=>{
 const data=await historyStore().api.read({roomId:'1',metric:'hum',range:'24h'},now);
 assert.equal(data.count,0);assert.equal(data.points.length,0);assert.equal(data.stats.avg,null);assert.equal(data.firstAt,null);
});
test('invalid ranges and metrics are rejected before dynamic SQL, and unknown rooms return 404',async()=>{
 const store=historyStore();
 for(const query of [{roomId:'0',metric:'co2',range:'6h'},{roomId:'1',metric:'co2;DROP TABLE users',range:'6h'},{roomId:'1',metric:'co2',range:'__proto__'},{roomId:'1',metric:'co2',range:'30d'}])await assert.rejects(()=>store.api.read(query,now),e=>e.status===400);
 assert.equal(store.queries.length,0);
 await assert.rejects(()=>store.api.read({roomId:'999',metric:'co2',range:'6h'},now),e=>e.status===404);
});
test('missing migration produces a useful history error without breaking the live demo recorder',async()=>{
 const store=historyStore();store.setMissing(true);
 await assert.rejects(()=>store.api.read({roomId:'1',metric:'co2',range:'6h'},now),e=>e.status===503&&e.message.includes('11-simulation-history.sql'));
 await store.api.record(store.conn,{room_id:1,temp:26,hum:55,co2:800},now);
});
test('retention removes only summaries older than eight days',async()=>{
 const store=historyStore([row(1,9*24,1000),row(2,7*24,800)]);
 await store.api.record(store.conn,{room_id:1,temp:26,hum:55,co2:800},now);
 assert.equal(store.rows().length,2);assert(store.rows().some(r=>r.room_id===2));
 store.setFailure(true);await assert.rejects(()=>store.api.record(store.conn,{room_id:1,temp:26,hum:55,co2:800},now+60000),/Database failure/);
});
test('history endpoint requires login and allows both authenticated admins and viewers',async()=>{
 const native=createRequire(require.resolve('../src/routes/simulation')),store=historyStore([row(1,2,1000)]);
 const out={exports:{}};
 const auth=(req,res,next)=>{if(req.headers.authorization!=='Bearer test')return res.status(401).json({error:'Please log in.'});req.user={role:req.headers['x-test-role']||'viewer'};next()};
 const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Admins only.'});
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/simulation'),'utf8'),{module:out,require:name=>name==='../auth'?{requireAuth:auth,requireAdmin:[auth,admin]}:name==='../simulation-history'?{read:q=>store.api.read(q,now)}:name==='../simulation'?{read:async()=>({}),control:async()=>({})}:native(name)});
 const express=native('express'),app=express();app.use('/api/simulation',out.exports);app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/simulation/history?roomId=1&metric=co2&range=6h`;
 try{
  assert.equal((await fetch(url)).status,401);
  for(const role of ['admin','viewer']){
   const response=await fetch(url,{headers:{Authorization:'Bearer test','X-Test-Role':role}});
   assert.equal(response.status,200);assert.equal((await response.json()).count,1);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
