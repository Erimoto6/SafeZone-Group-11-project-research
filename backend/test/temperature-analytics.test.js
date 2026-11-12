const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const backendRequire=createRequire(require.resolve('../src/routes/alerts')),{HttpError}=require('../src/http');
test('temperature analytics uses all stored limit alerts, inclusive of archives, with validated periods and numeric totals',async()=>{
 const calls=[];
 const pool={query:async(sql,params)=>{
  calls.push({sql,params});
  assert.match(sql,/a.metric='temp' AND a.type='exceeded'/);
  assert.match(sql,/LEFT JOIN alerts/);assert.match(sql,/NOT IN \(108,205,210,307,309\)/);
  assert.match(sql,/ORDER BY alert_count DESC,last_alert_at DESC,r.room_no ASC/);
  assert(!/alert_archives|LIMIT|reading_value\s*[><=]/i.test(sql),'archives and changing thresholds do not alter history; no latest-200 cap');
  return [[{id:2,room_no:102,floor_no:1,alert_count:'350',alert_days:'6',last_alert_at:'1794500000000'},
   {id:1,room_no:101,floor_no:1,alert_count:'2',alert_days:'1',last_alert_at:'1794400000000'},
   {id:3,room_no:103,floor_no:1,alert_count:'0',alert_days:'0',last_alert_at:null}]];
 }};
 const out={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/alerts'),'utf8'),{module:out,Buffer,process:{env:{}},require:name=>name==='../db'?{pool}:name==='../auth'?{requireAuth:(req,res,next)=>req.headers.authorization?(req.user={id:7},next()):res.sendStatus(401)}:name==='../poll-limit'?(req,res,next)=>next():backendRequire(name)});
 const express=backendRequire('express'),app=express();app.use('/alerts',out.exports);app.use((e,req,res,next)=>res.status(e instanceof HttpError?e.status:500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=(suffix='',auth=true)=>fetch('http://127.0.0.1:'+server.address().port+'/alerts/temperature-analytics'+suffix,{headers:auth?{Authorization:'Bearer test'}:{}});
 try{
  assert.equal((await call('',false)).status,401);assert.equal(calls.length,0);
  for(const value of ['invalid','7','all%27%20OR%201=1',''])assert.equal((await call('?range='+value)).status,400);
  assert.equal(calls.length,0);
  for(const range of ['7d','30d','all']){
   const response=await call('?range='+range);assert.equal(response.status,200);const data=await response.json();
   assert.equal(data.range,range);assert.equal(data.totalAlerts,352);assert.equal(data.rooms[0].alertCount,350);
   assert.equal(data.rooms[0].alertDays,6);assert.equal(data.rooms[0].lastAlertAt,1794500000000);
   assert.equal(data.rooms[2].lastAlertAt,null);assert.equal(data.rooms[2].alertCount,0);
   const {sql,params}=calls.at(-1);assert.deepEqual(Array.from(params),range==='all'?[]:[range==='7d'?7:30]);
   assert.equal(sql.includes('DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)'),range!=='all');
  }
  assert.equal((await (await call()).json()).range,'7d');
 }finally{await new Promise(r=>server.close(r))}
});
