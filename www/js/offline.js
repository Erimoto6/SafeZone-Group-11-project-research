// Device-only data adapter. No request in this module contacts a server.
(() => {
'use strict';
const KEY = 'safezone.offline.v1';
const BASE = { temp:27.4, hum:58, co2:827 };
const METRICS = ['temp','hum','co2'];
const RANK = {normal:0,warning:1,exceeded:2};
const NAMES = {temp:'Temperature',hum:'Humidity',co2:'CO₂'};
const TYPES = ['light','exhaust_fan','esp32','temp_sensor','hum_sensor','co2_sensor','wifi','sms_module','power_meter'];
const copy = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const email = value => String(value||'').trim().toLowerCase();
const phone = value => String(value||'').replace(/[\s()-]/g,'').replace(/^\+63/,'0');
const level = (value,t) => value>=t.limit?'exceeded':value>=t.warn?'warning':'normal';
let db, tick = Date.now();
function defaults() {
  return [{type:'light',label:'Lights',quantity:8,activeQuantity:6,wattsPerDevice:18,fanType:null},
    {type:'exhaust_fan',label:'Exhaust fan',quantity:1,activeQuantity:0,wattsPerDevice:40,fanType:'unspecified'},
    ...['esp32','temp_sensor','hum_sensor','co2_sensor','wifi','sms_module','power_meter'].map((type,i)=>({type,label:['ESP32','Temperature sensor','Humidity sensor','CO₂ sensor','Wi-Fi','SMS module','Power meter'][i],quantity:1,activeQuantity:0,wattsPerDevice:0,fanType:null}))];
}
function room(id,floor,roomNo,devices=defaults()) {
  return {id,floor,roomNo,name:'Room '+roomNo,ventMode:'auto',devices,reading:{...BASE},
    levels:{temp:'normal',hum:'normal',co2:'normal'},fanOn:false,scenario:null,startValue:null,
    electricity:{lightsKwh:0,fanKwh:0,totalKwh:0,operatingMs:0},updatedAt:Date.now()};
}
function load() {
  if(db)return db;
  try {
    const raw=localStorage.getItem(KEY);
    db=raw?JSON.parse(raw):{version:1,users:[],sessions:{},rooms:Array.from({length:10},(_,i)=>room(i+1,1,101+i)),
      thresholds:{temp:{warn:30,limit:32},hum:{warn:65,limit:75},co2:{warn:1000,limit:1200}},fanTrigger:'exceeded',alerts:[],recipients:[],nextUser:1,nextRoom:11,nextAlert:1,nextRecipient:1};
    if(db.version!==1||!Array.isArray(db.rooms)||!db.rooms.length||!Array.isArray(db.users)||!db.sessions)fail('Offline data could not be read. Keep the app data and contact your administrator.');
  } catch(e) { db=null;fail('Cannot read offline app data. '+e.message); }
  return db;
}
function save() {
  try {localStorage.setItem(KEY,JSON.stringify(db));}
  catch {db=null;fail('Cannot save on this device. Check available storage and allow app storage before continuing.');}
}
function publicUser(u) { const {passwordHash,salt,...safe}=u;return copy(safe); }
function totals(r) {
  let lights=0,lightsOn=0,lightWatts=0,activeWatts=0,fanWatts=0;
  for(const d of r.devices){if(d.type==='light'){lights+=d.quantity;lightsOn+=d.activeQuantity;lightWatts+=d.quantity*d.wattsPerDevice;activeWatts+=d.activeQuantity*d.wattsPerDevice;}if(d.type==='exhaust_fan')fanWatts+=d.quantity*d.wattsPerDevice;}
  return {lights,lightsOn,wattsPerLight:lights?lightWatts/lights:18,activeWatts,fanWatts};
}
function snapshot(r){return {...copy(r),...totals(r)};}
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
function random(){return hex(crypto.getRandomValues(new Uint8Array(24)));}
async function hash(password,salt){
  if(!crypto.subtle)fail('Secure device storage requires the installed Android app or a localhost browser.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
function passwordRule(value){if(typeof value!=='string'||value.length<8||value.length>128||!/[a-z]/.test(value)||!/[A-Z]/.test(value)||!/\d/.test(value))fail('Use 8–128 characters with uppercase, lowercase and a number.');}
function auth(token,admin=false){
  const session=db.sessions[token],u=session&&db.users.find(u=>u.id===session.userId);
  if(!u||session.expires<Date.now()){const e=new Error('Your offline session has expired. Please log in again.');e.status=401;throw e;}
  if(admin&&u.role!=='admin')fail('Admin access is required.');
  return u;
}
function session(u){const token=random();db.sessions[token]={userId:u.id,expires:Date.now()+86400000};return {token,user:publicUser(u)};}
async function addUser(body,admin){
  passwordRule(body.password);
  const e=email(body.email),p=phone(body.phone),username=String(body.username||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))fail('Enter a valid email address.');
  if(!/^09\d{9}$/.test(p))fail('Enter a valid Philippine mobile number.');
  const kind=e.endsWith('@iskolarngbayan.pup.edu.ph')?'student':'faculty';
  if(!admin&&!e.endsWith('@iskolarngbayan.pup.edu.ph')&&!e.endsWith('@pup.edu.ph'))fail('Use your PUP web mail.');
  if(admin&&(!/^[a-z0-9._-]{3,20}$/.test(username)||String(body.fullName||'').trim().length<2))fail('Enter your full name and a username of 3–20 letters, numbers, dots, dashes or underscores.');
  if(db.users.some(u=>u.email===e||u.phone===p||(admin&&u.username===username)))fail('That email, mobile number or username is already registered on this device.');
  const salt=random(),passwordHash=await hash(body.password,salt);
  const u={id:db.nextUser++,role:admin?'admin':'viewer',kind,email:e,phone:p,username:admin?username:null,fullName:admin?String(body.fullName).trim():null,salt,passwordHash};
  db.users.push(u);return {user:publicUser(u)};
}
function devices(value){
  if(!Array.isArray(value)||value.length>50)fail('Use at most 50 device groups.');
  return value.map(d=>{
    if(!d||!TYPES.includes(d.type))fail('Choose a valid device.');
    const quantity=Number(d.quantity),activeQuantity=Number(d.activeQuantity??quantity),watts=Number(d.wattsPerDevice??0),powered=['light','exhaust_fan'].includes(d.type),label=String(d.label||'').trim();
    if(!label||label.length>100||!Number.isInteger(quantity)||quantity<1||quantity>100)fail('Enter a device name and quantity from 1 to 100.');
    if(!Number.isInteger(activeQuantity)||activeQuantity<0||activeQuantity>quantity)fail('Lights on must be between zero and the quantity.');
    if(powered&&(!Number.isFinite(watts)||watts<=0||watts>2000))fail('Watts each must be greater than zero and at most 2000.');
    if(d.type==='exhaust_fan'&&!['unspecified','wall','window','ceiling','inline'].includes(d.fanType||'unspecified'))fail('Choose a valid exhaust fan type.');
    return {type:d.type,label,quantity,activeQuantity:d.type==='light'?activeQuantity:0,wattsPerDevice:powered?watts:0,fanType:d.type==='exhaust_fan'?(d.fanType||'unspecified'):null};
  });
}
function event(r,type,title,body,metric=null){
  db.alerts.unshift({id:db.nextAlert++,roomId:r.id,room:r.name,type,title:'Demo: '+title,body,metric,value:metric?r.reading[metric]:null,sms:false,smsSent:0,cats:type==='exceeded'?['exceeded','message']:type==='warning'?['message']:['system'],ts:Date.now()});
  db.alerts=db.alerts.slice(0,200);
}
function advance(){
  const now=Date.now();if(now-tick<2000)return;
  const elapsed=Math.min(now-tick,2000);tick=now;
  for(const r of db.rooms){
    const t=totals(r),oldFan=r.fanOn,previous=Math.max(...Object.values(r.levels).map(l=>RANK[l]));
    r.electricity.lightsKwh+=t.activeWatts*elapsed/3600000000;
    r.electricity.fanKwh+=(oldFan?t.fanWatts:0)*elapsed/3600000000;
    r.electricity.totalKwh=r.electricity.lightsKwh+r.electricity.fanKwh;r.electricity.operatingMs+=elapsed;
    for(const k of METRICS){
      const threshold=db.thresholds[k];
      if(r.scenario===k&&!r.fanOn){
        const normal=r.reading[k]<threshold.warn,ceiling=normal?threshold.warn:threshold.limit;
        const step=(normal?Math.max(threshold.warn-r.startValue,threshold.limit-threshold.warn):threshold.limit-threshold.warn)/6;
        r.reading[k]=Math.min(ceiling,r.reading[k]+step+Number.EPSILON*Math.abs(ceiling)*16);
        if(r.reading[k]>=threshold.limit)r.scenario=null;
      }else{
        const target=r.fanOn?Math.min(({temp:26,hum:54,co2:600})[k],threshold.warn-(threshold.limit-threshold.warn)/2):BASE[k];
        r.reading[k]+=(target-r.reading[k])*0.18;
      }
      const next=level(r.reading[k],threshold);
      if(RANK[next]>RANK[r.levels[k]])event(r,next,next==='warning'?NAMES[k]+' Near Limit':'High '+NAMES[k]+' Level',NAMES[k]+' reached '+r.reading[k].toFixed(k==='temp'?1:0)+'. Offline simulation; no SMS was sent.',k);
      r.levels[k]=next;
    }
    const worst=Math.max(...Object.values(r.levels).map(l=>RANK[l]));
    if(r.ventMode==='auto'){
      if(worst>=(db.fanTrigger==='warning'?1:2))r.fanOn=true;
      else if(worst===0){r.fanOn=false;if(oldFan)r.scenario=null;}
    }
    if(r.fanOn!==oldFan)event(r,'ventilation',r.fanOn?'Ventilation Activated':'Ventilation Stopped','Offline simulated exhaust fan changed.');
    if(worst===0&&previous>0)event(r,'normal','System Normal','Readings are back within the configured limits.');
    r.updatedAt=now;
  }
  save();
}
async function route(path,method,body,token){
  load();body=body||{};
  if(path==='/auth/register-admin'&&method==='POST'){
    // Only first-run setup is public; subsequent admins must be added by an existing admin.
    if(db.users.some(u=>u.role==='admin'))fail('An admin already exists on this device. Log in and use Manage Users to add another.');
    return addUser(body,true);
  }
  if(path==='/auth/register'&&method==='POST')return addUser(body,false);
  if(path==='/auth/login'&&method==='POST'){
    const identifier=String(body.identifier||'').trim().toLowerCase();
    const u=db.users.find(u=>[u.username,u.email,u.phone].includes(identifier)||u.phone===phone(identifier));
    if(!u||((body.as==='admin'||body.as==='viewer')&&u.role!==body.as)||await hash(String(body.password||''),u.salt)!==u.passwordHash)fail('Incorrect account or password. Use an account created on this device.');
    return session(u);
  }
  if(['/auth/forgot','/auth/verify-code','/auth/reset'].includes(path))fail('Email password recovery is unavailable offline. If you can log in, change your password in Account Settings.');
  const u=auth(token);
  if(path==='/local/logout'&&method==='POST'){delete db.sessions[token];return {ok:true};}
  if(path==='/auth/me')return {user:publicUser(u)};
  if(path==='/auth/change-password'&&method==='POST'){
    if(await hash(String(body.currentPassword||''),u.salt)!==u.passwordHash)fail('Current password is incorrect.');
    passwordRule(body.newPassword);u.salt=random();u.passwordHash=await hash(body.newPassword,u.salt);
    for(const [key,s] of Object.entries(db.sessions))if(s.userId===u.id)delete db.sessions[key];
    return session(u);
  }
  if(path==='/auth/me/email'&&method==='PUT'){
    const e=email(body.email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))fail('Enter a valid email address.');
    if(db.users.some(other=>other.id!==u.id&&other.email===e))fail('Email already registered.');u.email=e;return {user:publicUser(u)};
  }
  if(path==='/rooms'&&method==='GET')return {rooms:db.rooms.slice().sort((a,b)=>a.roomNo-b.roomNo).map(snapshot)};
  if(path==='/settings'&&method==='GET')return {thresholds:copy(db.thresholds),fanTrigger:db.fanTrigger,ventMode:db.rooms.every(r=>r.ventMode==='auto')?'auto':'manual'};
  if(path==='/alerts'&&method==='GET')return {alerts:copy(db.alerts)};
  if(path==='/simulation'&&method==='GET'){advance();return {source:'offline',rooms:db.rooms.map(snapshot),thresholds:copy(db.thresholds),fanTrigger:db.fanTrigger};}
  auth(token,true);
  if(path==='/admin/users'){
    if(method==='POST')return addUser(body,true);
    return {admins:db.users.filter(u=>u.role==='admin').map(publicUser),viewers:db.users.filter(u=>u.role==='viewer').map(publicUser)};
  }
  if(path==='/settings'&&method==='PUT'){
    if(body.thresholds)for(const k of METRICS){const t=body.thresholds[k];if(!t||!Number.isFinite(Number(t.warn))||!Number.isFinite(Number(t.limit))||Number(t.warn)>=Number(t.limit))fail('Warning must be lower than the limit for every metric.');}
    if(body.fanTrigger&&!['warning','exceeded'].includes(body.fanTrigger))fail('Choose a valid fan trigger.');
    if(body.ventMode&&!['auto','manual'].includes(body.ventMode))fail('Choose automatic or manual mode.');
    if(body.thresholds)for(const k of METRICS)db.thresholds[k]={warn:Number(body.thresholds[k].warn),limit:Number(body.thresholds[k].limit)};
    if(body.fanTrigger)db.fanTrigger=body.fanTrigger;if(body.ventMode)db.rooms.forEach(r=>r.ventMode=body.ventMode);return {ok:true};
  }
  if(path==='/simulation'&&method==='POST'){
    if(!['temp','hum','co2','reset','fan'].includes(body.metric))fail('Choose a valid simulation.');
    const ids=body.allRooms?db.rooms.map(r=>r.id):body.roomIds;
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>!db.rooms.some(r=>r.id===id)))fail('Select at least one valid room.');
    if(body.metric==='fan'&&typeof body.fanOn!=='boolean')fail('Choose a valid fan state.');
    for(const r of db.rooms.filter(r=>ids.includes(r.id))){
      if(body.metric==='reset'){r.reading={...BASE};r.levels=Object.fromEntries(METRICS.map(k=>[k,level(BASE[k],db.thresholds[k])]));r.scenario=null;r.fanOn=false;}
      else if(body.metric==='fan'){r.ventMode='manual';r.fanOn=body.fanOn;}
      else {r.scenario=body.metric;r.startValue=r.reading[body.metric];}
      r.updatedAt=Date.now();
    }
    tick=Date.now();return {ok:true,affectedRoomIds:[...new Set(ids)]};
  }
  if(path==='/rooms'||/^\/rooms\/\d+$/.test(path)){
    let r=path==='/rooms'?null:db.rooms.find(r=>r.id===Number(path.split('/').pop()));
    if(path!=='/rooms'&&!r)fail('Room not found.');
    if(method==='DELETE'){
      if(db.rooms.length<2)fail('Keep at least one room.');db.rooms=db.rooms.filter(other=>other!==r);
      db.alerts.forEach(a=>{if(a.roomId===r.id){a.roomId=null;a.room=null;}});return {ok:true};
    }
    if(!['POST','PATCH'].includes(method))fail('Unsupported room action.');
    const floor=Number(body.floor??r?.floor),roomNo=Number(body.roomNo??r?.roomNo);
    if(!Number.isInteger(floor)||floor<1||floor>4||!Number.isInteger(roomNo)||roomNo<floor*100+1||roomNo>floor*100+99)fail('Choose a room number matching its floor.');
    if(db.rooms.some(other=>other!==r&&other.roomNo===roomNo))fail('That room number already exists.');
    const groups=body.devices===undefined?(r?.devices||defaults()):devices(body.devices);
    if(body.ventMode&&!['auto','manual'].includes(body.ventMode))fail('Choose a valid fan mode.');
    if(!r){r=room(db.nextRoom++,floor,roomNo,groups);db.rooms.push(r);}
    else Object.assign(r,{floor,roomNo,name:'Room '+roomNo,devices:groups});
    if(body.ventMode)r.ventMode=body.ventMode;
    return {room:snapshot(r)};
  }
  if(path==='/sms-recipients'||/^\/sms-recipients\/\d+$/.test(path)){
    if(method==='GET')return {recipients:copy(db.recipients)};
    const id=Number(path.split('/').pop()),r=db.recipients.find(r=>r.id===id);
    if(method==='DELETE'){if(!r)fail('Recipient not found.');db.recipients=db.recipients.filter(other=>other!==r);return {ok:true};}
    if(method==='PATCH'&&!r)fail('Recipient not found.');
    if(body.name!==undefined&&(!String(body.name).trim()||String(body.name).length>100))fail('Enter a recipient name.');
    if(body.phone!==undefined&&!/^09\d{9}$/.test(phone(body.phone)))fail('Enter a valid mobile number.');
    const fields={};for(const key of ['name','role','smsEnabled'])if(body[key]!==undefined)fields[key]=body[key];if(body.phone!==undefined)fields.phone=phone(body.phone);
    if(r)Object.assign(r,fields);else{if(!fields.name||!fields.phone||!fields.role)fail('Enter name, role and mobile number.');db.recipients.push({id:db.nextRecipient++,smsEnabled:true,...fields});}return {ok:true};
  }
  fail('This action is unavailable offline.');
}
// Serialize async password operations and writes so concurrent calls cannot lose local changes.
let queue=Promise.resolve();
window.SafeZoneOffline={
  request(path,method='GET',body,token){
    const next=queue.then(async()=>{const result=await route(path,method,body,token);if(method!=='GET')save();return result;});
    queue=next.catch(()=>{db=null;});return next;
  },
  logout(token){return this.request('/local/logout','POST',{},token).catch(()=>{});}
};
})();
