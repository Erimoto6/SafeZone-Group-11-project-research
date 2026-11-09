const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {COURSES,validateProfile}=require('../src/student-profile');
test('all seven full course names and free-text sections are validated',()=>{
 assert.equal(Object.keys(COURSES).length,7);assert.equal(COURSES.BSP,'Bachelor of Science in Psychology');assert.equal(COURSES.BSIE,'Bachelor of Science in Industrial Engineering');
 for(const course of Object.keys(COURSES))assert.deepEqual(validateProfile(course,'  1-a  '),{courseCode:course,section:'1-A'});
 for(const section of ['', ' '.repeat(8),'a'.repeat(41),'A\nB'])assert.throws(()=>validateProfile('BSIT',section));
 for(const code of ['OTHER','__proto__',null,['BSIT']])assert.throws(()=>validateProfile(code,'1-1'));
});
test('client course options match backend and alerts group only the selected room',()=>{
 const source=fs.readFileSync(require.resolve('../../www/js/app.js'),'utf8');
 const courses=vm.runInNewContext(source.slice(source.indexOf('const COURSES ='),source.indexOf('const courseName'))+'\nCOURSES');
 assert.deepEqual(JSON.parse(JSON.stringify(courses)),COURSES);
 const code=source.slice(source.indexOf('function groupRoomAlerts('),source.indexOf('function alertGroupCard('));
 const group=vm.runInNewContext(code+'\ngroupRoomAlerts');
 const alerts=[{id:1,ts:10,roomId:1,type:'warning',metric:'hum',title:'Humidity'},{id:2,ts:20,roomId:1,type:'warning',metric:'hum',title:'Humidity'},{id:3,ts:30,roomId:2,type:'warning',metric:'hum',title:'Humidity'}];
 const groups=group(alerts,'1');assert.equal(groups.length,1);assert.equal(groups[0].latest.id,2);assert.equal(groups[0].items.length,2);assert.equal(alerts.length,3);
});
test('student signup stores profile and existing students can update only their own profile',async()=>{
 const base=createRequire(require.resolve('../src/routes/auth')),out={exports:{}};let profile=null,created=null;
 const pool={query:async(sql,args)=>{if(sql.startsWith('SELECT course_code'))return [[...(profile?[profile]:[])]];if(sql.startsWith('INSERT INTO student_profiles')){assert.equal(args[0],7);profile={courseCode:args[1],section:args[2]};return [{}];}throw Error('Unexpected SQL');}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/auth'),'utf8'),{module:out,Buffer,process:{env:{RATE_LIMIT:'off'}},console,require(name){
  if(name==='../db')return{pool};
  if(name==='../auth')return{SECRET:'x'.repeat(40),publicUser:u=>u,requireAuth:(req,res,next)=>{req.user={id:7,role:req.headers['x-role']||'viewer',email_kind:'student'};next();}};
  if(name==='../users')return{createUser:async p=>{created=p;return 7;},getUser:async()=>({id:7})};
  return base(name);
 }});
 const express=base('express'),app=express();app.use(express.json());app.use(out.exports);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,method,body,role)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json',...(role?{'x-role':role}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 try{
  const account={email:'student@iskolarngbayan.pup.edu.ph',phone:'09123456789',password:'testpass1'};
  assert.equal((await call('/register','POST',account)).status,400);
  assert.equal((await call('/register','POST',{...account,courseCode:'BSIT',section:' 2-1 '})).status,201);
  assert.deepEqual(created.profile,{courseCode:'BSIT',section:'2-1'});
  assert.equal((await call('/me/student-profile','PUT',{courseCode:'BSP',section:'1-2'},'admin')).status,403);
  assert.equal((await call('/me/student-profile','PUT',{courseCode:'BSIE',section:'2-a',userId:99})).status,200);
  assert.deepEqual(profile,{courseCode:'BSIE',section:'2-A'});
 }finally{await new Promise(r=>server.close(r));}
});

test('alert descriptions use event time and historical value, not live readings',()=>{
 const source=fs.readFileSync(require.resolve('../../www/js/app.js'),'utf8');
 const code=source.slice(source.indexOf('function alertSentence('),source.indexOf('function alertGroupCard('));
 const sentence=vm.runInNewContext(code+'\nalertSentence',{withUnit:(k,v)=>v+(k==='temp'?' °C':'')});
 const alert={ts:Date.UTC(2026,10,9,13),type:'exceeded',metric:'temp',title:'Demo: High Temperature Level',value:32};
 assert.match(sentence(alert),/^At .+, the temperature was high \(32 °C\)\.$/);
 assert.match(sentence({...alert,type:'warning'}),/nearing its limit/);
 assert.match(sentence({...alert,type:'normal'}),/returned to normal/);
 assert.match(sentence({...alert,type:'ventilation',title:'Ventilation Stopped'}),/switched off/);
});
