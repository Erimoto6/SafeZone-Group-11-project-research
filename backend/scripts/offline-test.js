// No MySQL or backend required: serve only the bundled assets, then disconnect the browser.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'../../www');
let server,browser;
(async()=>{
 try {
  server=await new Promise(resolve=>{const s=http.createServer(async(req,res)=>{
   try {const relative=decodeURIComponent(req.url.split('?')[0]);const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));if(!file.startsWith(root+path.sep))throw Error();
    const data=await fs.readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);
   }catch{res.statusCode=404;res.end('Not found');}
  }).listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:360,height:800},colorScheme:'dark'});
  await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
  let apiCalls=0;await context.route('**/api/**',r=>{apiCalls++;return r.abort();});
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();await page.goto(base);await page.waitForFunction(()=>!!window.SafeZoneOffline);
  await context.setOffline(true);
  const act=async(name,v)=>page.locator(`[data-act="${name}"]${v===undefined?'':`[data-v="${v}"]`}`).first().click();
  const fill=async(id,value)=>page.locator('#'+id).fill(String(value));
  const submit=async id=>page.locator('#'+id+' button[type="submit"]').click();
  const go=async screen=>{await act('go',screen);await page.locator(`[data-s="${screen}"]`).waitFor();};
  const local=async(p,m='GET',body)=>page.evaluate(({p,m,body})=>window.SafeZoneOffline.request(p,m,body,sessionStorage.getItem('safezone.offline.token')),{p,m,body});
  const logout=async()=>{await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Log out',exact:true}).click();};
  const password='OfflineTest123';
  await act('role','admin');await act('to','fReg');assert.equal(await page.locator('#fcode').count(),0);
  for(const [id,value] of Object.entries({fname:'Local Admin',fuser:'elaine',femail:'elaine@example.com',fphone:'09171234567',rp:password,rc:password}))await fill(id,value);
  await submit('f-reg-form');await page.getByRole('heading',{name:'Admin Login',exact:true}).waitFor();
  await fill('u','elaine');await fill('pw','wrong');await submit('login-form');await page.getByText(/Incorrect account or password/).waitFor();
  await fill('pw',password);await submit('login-form');await page.locator('[data-s="home"]').waitFor();
  assert.equal((await local('/rooms')).rooms.length,10);assert.equal((await local('/rooms')).rooms[0].devices.length,9);
  const stored=await page.evaluate(()=>localStorage.getItem('safezone.offline.v1'));assert(!stored.includes(password));assert(JSON.parse(stored).users[0].passwordHash.length===64);
  console.log('PASS: offline first-admin setup without an access code, wrong-password rejection, salted password storage, default rooms/devices and login with network disconnected');
  await go('settings');await act('draftAuto');await act('save');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Changes saved on this device');
  await page.locator('#sim-scope').selectOption('current');await act('sim','co2');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Offline simulation started'));
  const original=(await local('/simulation')).rooms[0];assert.equal(original.reading.co2,827);
  for(let i=0;i<13;i++){await page.clock.fastForward(2000);await local('/simulation');}
  let snapshot=await local('/simulation'),r=snapshot.rooms[0];assert(r.reading.co2<1200&&r.reading.co2>827);assert.equal(r.scenario,null);
  assert.equal(snapshot.rooms[1].reading.co2,827);
  const alerts=(await local('/alerts')).alerts;assert(alerts.some(a=>a.metric==='co2'&&a.type==='warning'));assert(alerts.some(a=>a.metric==='co2'&&a.type==='exceeded'));
  assert(r.electricity.lightsKwh>0);const usage=r.electricity.lightsKwh;
  await act('sim','reset');await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Offline readings reset'));
  r=(await local('/simulation')).rooms[0];assert.equal(r.reading.co2,827);assert.equal(r.electricity.lightsKwh,usage);
  await go('alerts');await page.getByText('Demo: High CO₂ Level',{exact:true}).waitFor();
  console.log('PASS: gradual local simulation, warning/danger alerts, recovery, unaffected other rooms and persistent estimated kWh after reset');
  for(const metric of ['temp','hum']){
    await local('/simulation','POST',{metric:'reset',allRooms:true});
    await local('/simulation','POST',{metric,roomIds:[2,3]});
    for(let i=0;i<13;i++){await page.clock.fastForward(2000);await local('/simulation');}
    const states=(await local('/simulation')).rooms;
    assert.equal(states[0].scenario,null);assert((await local('/alerts')).alerts.some(a=>a.roomId===2&&a.metric===metric&&a.type==='exceeded'));
  }
  await local('/simulation','POST',{metric:'reset',allRooms:true});
  await local('/settings','PUT',{ventMode:'auto',fanTrigger:'warning'});
  await local('/simulation','POST',{metric:'temp',roomIds:[1]});
  for(let i=0;i<6;i++){await page.clock.fastForward(2000);await local('/simulation');}
  assert((await local('/simulation')).rooms[0].fanOn);
  await page.clock.fastForward(2000);assert((await local('/simulation')).rooms[0].electricity.fanKwh>0);
  await local('/sms-recipients','POST',{name:'Local recipient',role:'Faculty',phone:'09191234567'});
  const recipient=(await local('/sms-recipients')).recipients[0];await local('/sms-recipients/'+recipient.id,'PATCH',{smsEnabled:false});assert.equal((await local('/sms-recipients')).recipients[0].smsEnabled,false);
  await local('/sms-recipients/'+recipient.id,'DELETE');assert.equal((await local('/sms-recipients')).recipients.length,0);
  console.log('PASS: temperature/humidity, selected rooms, automatic warning-triggered cooling, fan energy and local recipient management');

  await go('settings');await act('account');await fill('current-pw',password);await fill('np','NewOffline123');await fill('cp','NewOffline123');await submit('pw-form');await page.getByRole('dialog').waitFor({state:'hidden'});
  await logout();await act('role','admin');await fill('u','elaine');await fill('pw','NewOffline123');await submit('login-form');await page.locator('[data-s="home"]').waitFor();
  await go('monitor');await act('addRoom');await act('floor','2');await fill('rn','201');await submit('room-form');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Room added');
  await go('settings');await page.locator('#config-room').selectOption('11');await act('editRoom','11');await fill('rn','202');await submit('room-form');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Room updated');
  assert((await local('/rooms')).rooms.some(r=>r.name==='Room 202'));
  const bad=await local('/rooms/11','PATCH',{devices:[{type:'light',label:'Bad',quantity:0}]}).then(()=>false,()=>true);assert(bad);
  await act('roomDel','11');await act('cancelRoomDel');assert.equal((await local('/rooms')).rooms.length,11);
  await act('roomDel','11');await act('confirmRoomDel','11');await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Room removed');assert.equal((await local('/rooms')).rooms.length,10);
  console.log('PASS: local password changes, room creation/editing, invalid device rejection and deletion confirmation');
  // Simulate an app restart: assets load from the local asset host, then disconnect again.
  await context.setOffline(false);await page.reload();await page.locator('[data-s="home"]').waitFor();await context.setOffline(true);
  assert((await local('/alerts')).alerts.some(a=>a.type==='exceeded'));assert((await local('/simulation')).rooms[0].electricity.lightsKwh>=usage);
  await logout();await act('role','student');await act('to','vReg1');await fill('email','local@iskolarngbayan.pup.edu.ph');await fill('phone','09181234567');await submit('v-reg1-form');await fill('rp',password);await fill('rc',password);await submit('v-reg2-form');await page.getByRole('button',{name:'Go to Login',exact:true}).click();await fill('phone','09181234567');await fill('pw',password);await submit('v-login-form');await page.locator('[data-s="home"]').waitFor();
  const denied=await local('/simulation','POST',{metric:'temp',allRooms:true}).then(()=>false,()=>true);assert(denied);
  assert.equal(await page.locator('[data-v="settings"]').count(),0);
  const fresh=await browser.newContext();await fresh.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());const other=await fresh.newPage();await other.goto(base);
  const isolated=await other.evaluate(()=>localStorage.getItem('safezone.offline.v1'));assert.equal(isolated,null);await fresh.close();
  assert.equal(apiCalls,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/safezone-offline-home.png'});
  console.log('PASS: data survives restart, offline student login, admin authorization and isolated device data; zero HTTP API requests');
  console.log('ALL OFFLINE CHECKS PASSED');
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
