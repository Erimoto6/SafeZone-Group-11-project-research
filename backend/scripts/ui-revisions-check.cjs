const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../../www');
const hook=`window.uiTest={setup(role){token='test';S.role=role;S.me={id:7,name:'Admin',phone:'09123456789',email:'admin@pup.edu.ph'};S.rooms=DEFAULT_ROOMS.map(cfg=>makeRoom({...cfg,id:cfg.name.split(' ')[1]}));S.roomId=S.rooms[0].id;S.archiveAvailable=true;S.accounts=[{id:1,role:'admin',username:'admin',isMainAdmin:true,name:'Admin',email:'admin@pup.edu.ph',phone:'09123456789'},{id:5,role:'admin',username:'helper',name:'Helper Admin',email:'helper@pup.edu.ph',phone:'09123456788'},{id:2,role:'viewer',kind:'student',email:'student@iskolarngbayan.pup.edu.ph',courseCode:'BSIT',section:'1-1',phone:'09123456780'},{id:3,role:'viewer',kind:'student',email:'another@iskolarngbayan.pup.edu.ph',courseCode:'BSIT',section:'2-1',phone:'09123456781'},{id:4,role:'viewer',kind:'student',email:'legacy@iskolarngbayan.pup.edu.ph',courseCode:null,section:null,phone:'09123456782'}];S.rooms.forEach((r,i)=>{r.devices=[{type:'exhaust_fan',label:'Exhaust fan',quantity:2,activeQuantity:0,wattsPerDevice:40,fanType:'wall'},{type:'esp8266',label:'NodeMCU V3 ESP8266',quantity:1,activeQuantity:0,wattsPerDevice:0,fanType:null}];r.observed=true;r.reading={temp:i===0?35:26,hum:55,co2:i===1?1600:500};r.buf={t:[Date.now()-2000,Date.now()],temp:[26,27],hum:[55,55],co2:[500,500]}});S.alerts=[{id:1,roomId:S.roomId,type:'warning',metric:'temp',value:30,title:'High temperature',body:'Warning: 29; limit: 32',ts:Date.now()}];S.screen='home';render();},async screen(v){closeSheet();S.screen=v;render();if(v==='analytics')await loadTemperatureAnalytics();},apiData(){const rooms=S.rooms.map(r=>({...r,updatedAt:Date.now(),wattsPerLight:r.lightWatts,ventMode:r.vent.mode,fanOn:r.vent.on}));return {'/rooms':{rooms},'/settings':{thresholds:S.limits,fanTrigger:S.fanTrigger,ventMode:'auto'},'/simulation':{rooms,thresholds:S.limits,fanTrigger:S.fanTrigger},'/alerts':{alerts:S.alerts,archiveAvailable:true},'/admin/users':{admins:S.accounts.filter(a=>a.role==='admin'),viewers:S.accounts.filter(a=>a.role==='viewer')},'/sms-recipients':{recipients:[]}}},auth(v){closeSheet();captureEnabled=false;formDrafts.clear();S.screen=v;S.authError='';S.reg={phone:''};render()},reading(values){cur().reading={temp:values[0],hum:values[1],co2:values[2]};cur().levels=Object.fromEntries(KEYS.map(k=>[k,levelOf(k,cur().reading[k])]));S.screen='home';render()},manual(value){cur().vent.mode=value?'manual':'auto';render()},history(){S.mon.view='history';render()},account(){return ACTS.account()},theme(v){S.theme=v;applyTheme();render()},mainAdmin(){S.me={...S.me,id:1,isMainAdmin:true};render()},edit(){S.screen='settings';return ACTS.editRoom(S.roomId)},inventory(){return readDeviceRows()},status(){return S.rooms.map(r=>overviewStatus(r,S.limits))}};`;
const server=http.createServer((req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';let data=fs.readFileSync(root+p);if(p.endsWith('app.js'))data=data.toString().replace('(async function init() {',hook+'\n(async function init() {').replace('setInterval(pollShared, 2000);','');res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html');res.end(data)}catch{res.writeHead(404);res.end()}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());let analyticsFail=false;await page.route('**/api/**',async r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/temperature-analytics')){if(analyticsFail)return r.fulfill({status:503,json:{error:'History temporarily unavailable'}});const range=url.searchParams.get('range');return r.fulfill({json:{range,generatedAt:Date.now(),totalAlerts:range==='30d'?0:12,rooms:range==='30d'?[]:[{roomId:'102',room:'Room 102',floor:1,alertCount:8,alertDays:3,lastAlertAt:Date.now()},{roomId:'101',room:'Room 101',floor:1,alertCount:4,alertDays:2,lastAlertAt:Date.now()}]}})}const fixtures=await page.evaluate(()=>uiTest.apiData());return r.fulfill({json:fixtures[url.pathname.replace('/api','')]||{profile:null}})});for(const width of [320,390,768,1280])for(const theme of ['light','dark'])for(const role of ['admin','student']){await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(role=>uiTest.setup(role),role);await page.evaluate(theme=>uiTest.theme(theme),theme);for(const screen of ['home','monitor','status','alerts','rooms','analytics','about',...(role==='admin'?['settings','users','students']:[])]){await page.evaluate(v=>uiTest.screen(v),screen);
if(['home','alerts','monitor','status','settings'].includes(screen)){
 assert.equal(await page.locator('.topbar .logo-themed').count(),1);
 assert.equal(await page.locator('.topbar [aria-label^="Back to"]').count(),0);
 assert(await page.locator('.topbar .logo-'+theme).isVisible());
 assert(!await page.locator('.topbar .logo-'+(theme==='light'?'dark':'light')).isVisible());
}
assert(!await page.locator('main').innerText().then(t=>/electricity|kWh/i.test(t)),screen+' energy hidden');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),screen+' page overflow '+width);const overflow=await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert(!overflow,screen+' main overflow '+width);assert.equal(await page.locator('.monitor-links').count(),screen==='monitor'?1:0);if(['rooms','analytics'].includes(screen)){await page.getByRole('button',{name:'Back to monitor',exact:true}).click();assert.equal(await page.locator('main').getAttribute('data-s'),'monitor');await page.evaluate(v=>uiTest.screen(v),screen);}if(screen==='rooms'){assert.equal(await page.locator('tbody tr').count(),43);assert.equal(await page.locator('.room-state-exceeded').count(),2);await page.selectOption('#overview-floor','4');assert.equal(await page.locator('tbody tr').count(),12);await page.selectOption('#overview-floor','all')}if(screen==='analytics'){
 assert.match(await page.locator('.temperature-rank').first().innerText(),/Room 102/);
 assert.equal(await page.locator('.temperature-rank .rank-reading b').first().innerText(),'8');
 await page.locator('[data-act=analyticsRange][data-v="30d"]').click();await page.getByText('No temperature limit alerts were recorded for this period.',{exact:true}).waitFor();
 await page.locator('[data-act=analyticsRange][data-v=all]').click();await page.locator('.temperature-rank').first().waitFor();assert.equal(await page.locator('.temperature-rank').count(),2);await page.locator('.temperature-rank').first().click();assert.equal(await page.locator('main').getAttribute('data-s'),'monitor');assert.match(await page.locator('.roompick').innerText(),/Room 102/);await page.evaluate(()=>uiTest.screen('analytics'));
}if(screen==='status'){assert.match(await page.locator('main').innerText(),/Microcontroller/);assert(!/NodeMCU V3 ESP8266/.test(await page.locator('main').innerText()));}if(screen==='monitor'){await checkMonitoring(page,role);assert(await page.locator('main').evaluate(el=>Boolean(el.querySelector('.chart').compareDocumentPosition(el.querySelector('.monitor-links'))&Node.DOCUMENT_POSITION_FOLLOWING)));}if(screen==='monitor'&&role==='admin'){
 assert(await page.locator('.fan-control-card').evaluate(el=>{const status=el.querySelector('.s-val').getBoundingClientRect(),toggle=el.querySelector('[role=switch]').getBoundingClientRect(),card=el.getBoundingClientRect();return toggle.left>status.right && toggle.right<=card.right;}));
} if(screen==='alerts'){
assert(await page.locator('.archive-button').evaluate(el=>{const button=el.getBoundingClientRect(),screen=el.closest('main').getBoundingClientRect();return button.left>=screen.left && button.right<=screen.right;}),'archive button remains fully visible');
assert(await page.locator('.alert-toolbar').evaluate(el=>{const archive=el.querySelector('.archive-button').getBoundingClientRect(),filters=el.querySelector('.chips').getBoundingClientRect();return archive.left>=filters.right && Math.abs(archive.top-filters.top)<=1;}),'Archive stays on the right of filters without wrapping');
assert(await page.locator('.alert-time-block').first().evaluate(el=>el.querySelector('.alert').getBoundingClientRect().top-el.querySelector('h4').getBoundingClientRect().bottom<=5),'alert timestamp sits close to its card');
if(width===390 && theme==='light' && role==='admin')await page.screenshot({path:'/tmp/safezone-alert-spacing.png'});
assert.equal(await page.getByRole('button',{name:'Archive alert',exact:true}).count(),1);const css=await page.locator('.alert.normal,.alert.warning').first().evaluate(el=>getComputedStyle(el).borderLeftWidth);assert.equal(css,'1px');assert.notEqual(await page.locator('h4 time').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)')}if(screen==='settings'){
 assert(await page.locator('.room-configuration').evaluate(el=>el.getBoundingClientRect().height<=240),'room configuration has compact spacing');
 assert(await page.locator('.room-config-actions button').evaluateAll(buttons=>buttons.every(el=>el.getBoundingClientRect().height>=44)),'room actions retain touch targets');
 if(width===390 && theme==='light')await page.screenshot({path:'/tmp/safezone-settings-compact.png'});
}
if(screen==='users'){
assert.equal(await page.locator('nav.nav').count(),0,'Manage Users hides bottom navigation');
await page.getByRole('button',{name:'Back to settings',exact:true}).click();
await page.locator('main[data-s=settings]').waitFor();
assert.equal(await page.locator('nav.nav').count(),1,'back restores main navigation');
await page.evaluate(()=>uiTest.screen('users'));
assert.equal(await page.locator('table').count(),0);assert(await page.locator('#rp').evaluate(el=>el.closest('.field').nextElementSibling.matches('.rules')));await page.locator('#admin-form [type=submit]').click();await page.getByText('Enter a full name from 2 to 100 characters.',{exact:true}).waitFor();}if(screen==='students'){
 assert.equal(await page.locator('.student-delete').count(),0);
 assert.equal(await page.locator('[data-act=studentCourse][data-v=BSIT]').count(),1);
 await page.locator('.student-browse-list [data-act=studentCourse][data-v=BSIT]').click();
 assert.equal(await page.locator('[data-act=studentSection]').count(),2);
 assert.equal(await page.locator('.account-card').count(),0);
 await page.locator('[data-act=studentSection][data-v="1-1"]').click();
 assert.equal(await page.locator('.student-delete').count(),1);
 assert.match(await page.locator('.account-card').innerText(),/student@/);
 assert(!await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1));
 const aligned=await page.locator('.account-card-heading').evaluate(el=>{const button=el.querySelector('button').getBoundingClientRect(),heading=el.getBoundingClientRect();return button.right<=heading.right+7 && button.top>=heading.top-7});assert(aligned);
 await page.getByRole('button',{name:'Back to sections',exact:true}).click();
 assert.equal(await page.locator('[data-act=studentSection]').count(),2);
 await page.getByRole('button',{name:'Back to courses',exact:true}).click();
 await page.locator('.student-browse-list [data-act=studentCourse][data-v=""]').click();
 await page.locator('[data-act=studentSection][data-v=""]').click();
 assert.match(await page.locator('.account-card').innerText(),/legacy@/);
 await page.locator('.student-breadcrumb [data-act=studentCourses]').click();
 assert.equal(await page.locator('.student-delete').count(),0);
} }await page.evaluate(()=>{uiTest.screen('monitor');uiTest.history()});await checkMonitoring(page,role);assert.match(await page.locator('main').innerText(),/browser session only/);assert(await page.locator('main').evaluate(el=>Boolean(el.querySelector('.chart').compareDocumentPosition(el.querySelector('.monitor-links'))&Node.DOCUMENT_POSITION_FOLLOWING)));await page.evaluate(()=>uiTest.account());assert(await page.locator('#cp').evaluate(el=>el.nextElementSibling.matches('.rules')));await page.locator('#np').fill('Abc123');assert.equal(await page.locator('#rules-np li.ok').count(),3)}await page.evaluate(()=>uiTest.setup('admin'));analyticsFail=true;await page.evaluate(()=>uiTest.screen('analytics'));assert.match(await page.locator('[role=alert]').innerText(),/history could not load/i);analyticsFail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.temperature-rank').first().waitFor();await checkQaReport(page);await checkAlertsArchive(page);await checkRoomConfiguration(page);await checkMainAdmin(page);await checkAdminPassword(page);await page.setViewportSize({width:390,height:844});await page.locator('[data-act=view][data-v=live]').click();assert(await page.locator('main').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'live Monitoring fits a typical phone screen');await page.evaluate(()=>uiTest.manual(true));assert(await page.locator('main').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'manual fan controls fit a typical phone screen');await page.screenshot({path:'/tmp/safezone-monitor-compact.png'});assert.deepEqual(errors,[]);console.log('PASS: admin/student screens in both themes at 320/390/768/1280; Monitoring order, menu links, placement in room configuration, controller preservation, theme logos, Manage Users navigation, password errors, removal dialogs and PDF QA scenarios');}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

async function checkMonitoring(page,role){
 const selectors=['.roombar',...(role==='admin'?['.monitor-utilities']:[]),'.seg','.mini-chips','.chart','.monitor-links'];
 assert.equal(await page.locator('.monitor-utilities').count(),role==='admin'?1:0,'fan card appears only for admins in both Monitoring views');
 const positions=await page.locator('main').evaluate((el,selectors)=>selectors.map(s=>el.querySelector(s).getBoundingClientRect().top),selectors);
 assert(positions.every((top,i)=>i===0||top>positions[i-1]),'Monitoring order: room, fan, view, readings, graph, links');
 assert.equal(await page.getByRole('button',{name:'Installation type',exact:true}).count(),0);
 assert(await page.locator('.seg').evaluate(el=>el.getBoundingClientRect().height<=44),'view buttons have compact padding');
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 assert(!/All classrooms|Temperature analytics/.test(await page.locator('.sheet').innerText()));
 await page.getByRole('button',{name:'Close',exact:true}).click();
}
async function checkRoomConfiguration(page){
 await page.evaluate(()=>{uiTest.setup('admin');uiTest.screen('settings');uiTest.edit()});
 assert.equal(await page.locator('[data-device=label]').nth(1).inputValue(),'Microcontroller');
 assert.equal((await page.evaluate(()=>uiTest.inventory()))[1].label,'NodeMCU V3 ESP8266');
 assert.equal(await page.locator('[data-device=fanType]').first().inputValue(),'wall');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>uiTest.screen('monitor'));
}

async function checkMainAdmin(page){
 await page.evaluate(()=>{uiTest.setup('admin');uiTest.screen('users')});
 assert.equal(await page.locator('[data-act=adminRemove]').count(),0,'regular admins have no admin removal control');
 assert.match(await page.locator('main').innerText(),/admin · Main Admin/);
 await page.evaluate(()=>uiTest.mainAdmin());
 assert.equal(await page.locator('[data-act=adminRemove]').count(),1,'only other admins can be removed');
 assert.equal(await page.locator('[data-act=adminRemove]').getAttribute('data-v'),'5');
 for(const theme of ['light','dark'])for(const width of [320,390]){
  await page.evaluate(theme=>uiTest.theme(theme),theme);
  await page.setViewportSize({width,height:844});
  assert(!await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  await page.getByRole('button',{name:'Remove admin helper',exact:true}).click();
  await page.getByRole('dialog',{name:'Remove admin?',exact:true}).waitFor();
  assert.equal(await page.locator('[data-act=confirmAdminRemove]').getAttribute('data-v'),'5');
  assert(await page.locator('.admin-remove-confirm').evaluate(el=>{const note=el.querySelector('.note').getBoundingClientRect(),actions=el.querySelector('.confirm-actions').getBoundingClientRect();return actions.top>=note.bottom+12;}),'dialog explanation has space before buttons');
  assert(!await page.locator('.sheet').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  if(width===390 && theme==='light')await page.screenshot({path:'/tmp/safezone-remove-admin.png'});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
 }
 await page.evaluate(()=>uiTest.screen('monitor'));
}

async function checkAdminPassword(page){
 await page.evaluate(()=>{uiTest.setup('admin');uiTest.screen('users')});
 let creates=0;const track=request=>{if(request.method()==='POST' && new URL(request.url()).pathname==='/api/admin/users')creates++};
 page.on('request',track);
 await page.locator('#rp').fill('eagdgfrvfr');
 await page.locator('#admin-form [type=submit]').click();
 await page.getByText('Password: include a letter and a number.',{exact:true}).waitFor();
 assert.equal(await page.locator('#rp').getAttribute('aria-invalid'),'true');
 assert.equal(await page.locator('#an').getAttribute('aria-invalid'),'true');
 await page.locator('#an').fill('New Admin');await page.locator('#au').fill('newadmin');
 await page.locator('#aem').fill('newadmin@pup.edu.ph');await page.locator('#ap').fill('09123456789');
 await page.locator('#admin-form [type=submit]').click();
 assert.equal(await page.locator('#admin-errors li').count(),1);
 assert.equal(await page.locator('#admin-errors').innerText(),'Password: include a letter and a number.');
 assert.equal(creates,0,'invalid passwords never submit account creation');
 await page.locator('#rp').fill('eagdgfrvfr1');
 assert.equal(await page.locator('#admin-errors li').count(),0,'correcting fields clears stale errors');
 assert.equal(await page.locator('#rp').getAttribute('aria-invalid'),'false');
 assert.equal(await page.locator('#rules li.ok').count(),3);
 await page.locator('#rp').fill('abc123 ');
 assert.equal(await page.locator('#admin-errors').innerText(),'Password cannot contain spaces.');
 page.off('request',track);
 await page.evaluate(()=>uiTest.screen('monitor'));
}

async function checkAlertsArchive(page){
 await page.evaluate(()=>{uiTest.setup('admin');uiTest.screen('alerts')});
 assert(!/Simulated readings · SMS delivery is not connected/.test(await page.locator('main').innerText()));
 assert.equal(await page.locator('.archive-tabs').count(),0);
 await Promise.all([
  page.waitForResponse(response=>response.url().includes('/api/alerts?') && new URL(response.url()).searchParams.get('archived')==='1'),
  page.getByRole('button',{name:'Archive',exact:true}).click()
 ]);
 await page.getByRole('button',{name:'Current alerts',exact:true}).waitFor();
 assert.equal(await page.locator('.alert-list-actions').count(),0);
 assert.equal(await page.locator('.alert-toolbar>[data-act=alertView]').count(),1);
 await Promise.all([
  page.waitForResponse(response=>response.url().includes('/api/alerts?') && new URL(response.url()).searchParams.get('archived')==='0'),
  page.getByRole('button',{name:'Current alerts',exact:true}).click()
 ]);
 await page.getByRole('button',{name:'Archive',exact:true}).waitFor();
}

async function checkQaReport(page){
 let emailSaves=0,registration;
 const saveEmail=route=>{emailSaves++;const email=route.request().postDataJSON().email;return route.fulfill({json:{user:{id:7,role:'admin',username:'admin',fullName:'QA Admin',email,phone:'09123456789'}}})};
 await page.route('**/api/auth/me/email',saveEmail);
 const register=route=>{registration=route.request().postDataJSON();return route.fulfill({status:201,json:{user:{id:9}}})};
 await page.route('**/api/auth/register',register);
 const login=route=>route.fulfill({json:{token:'qa-login',user:{id:9,role:'viewer',email:'student@iskolarngbayan.pup.edu.ph',kind:'student',phone:route.request().postDataJSON().identifier}}});
 await page.route('**/api/auth/login',login);
 for(const width of [320,390,768,1280])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:844});await page.evaluate(theme=>uiTest.theme(theme),theme);
  await page.evaluate(()=>uiTest.auth('vReg1'));
  const submit=()=>page.locator('#v-reg1-form [type=submit]').click();
  await page.locator('#phone').fill('09123456789');
  for(const email of ['student@gmail.com','name@','name..extra@pup.edu.ph','name.@pup.edu.ph','name@pup.edu.ph.evil']){
   await page.locator('#email').fill(email);await submit();assert.equal(await page.locator('#v-reg1-form').count(),1);assert(await page.locator('#err').innerText());
  }
  await page.locator('#email').fill('student@iskolarngbayan.pup.edu.ph');
  await page.locator('.course-picker summary').click();
  assert.equal(await page.locator('.course-options button').count(),7);
  assert(!await page.locator('.course-picker').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  if(width===390&&theme==='light')await page.screenshot({path:'/tmp/safezone-qa-courses.png'});
  await page.locator('[data-act=chooseCourse][data-v="BSBA-HRM"]').click();
  assert.match(await page.locator('.course-picker summary').innerText(),/Bachelor of Science in Business Administration major in Human Resource Management/);
  assert(!await page.locator('.course-picker summary').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  for(const section of ['4-','43','4-33','4-a','4_3']){await page.locator('#reg-section').fill(section);await submit();assert.match(await page.locator('#err').innerText(),/valid year-section/);}
  await page.locator('#reg-section').fill('4-3');await submit();await page.locator('#v-reg2-form').waitFor();
  assert(await page.locator('#rc').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.rules'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.locator('#rp').fill('abcdef');assert.equal(await page.locator('#rules li.ok').count(),2);
  assert(!await page.locator('.splash').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  if(width===390&&theme==='light'){
   await page.screenshot({path:'/tmp/safezone-qa-password.png'});
   await page.locator('#rp').fill('qaPassword1');await page.locator('#rc').fill('different1');
   await page.locator('#v-reg2-form [type=submit]').click();assert.match(await page.locator('#err').innerText(),/do not match/);
   await page.locator('#rc').fill('qaPassword1');await page.locator('#v-reg2-form [type=submit]').click();
   await page.getByRole('heading',{name:'Account Created!',exact:true}).waitFor();
   assert.equal(registration.courseCode,'BSBA-HRM');assert.equal(registration.section,'4-3');assert.equal(registration.phone,'09123456789');
  }
  await page.evaluate(()=>uiTest.auth('vLogin'));
  const loginLogo=page.locator('.logo-'+theme);assert(await loginLogo.isVisible());
  assert((await loginLogo.getAttribute('src')).startsWith('images/'+theme+'%20mode.png?'));
  assert(await loginLogo.evaluate(img=>img.complete && img.naturalWidth>0),'supplied logo loads');
  await page.locator('#v-login-form [type=submit]').click();assert.equal(await page.locator('#err').innerText(),'Mobile number is required.');
  await page.locator('#phone').fill('09abc123');assert.equal(await page.locator('#phone').inputValue(),'09123');
  await page.locator('#v-login-form [type=submit]').click();assert.match(await page.locator('#err').innerText(),/11-digit/);
  await page.locator('#phone').fill('091234567899999');assert.equal(await page.locator('#phone').inputValue(),'09123456789');
  await page.locator('#pw').fill('qaPassword1');await page.locator('#v-login-form [type=submit]').click();await page.locator('main[data-s=home]').waitFor();
  await page.evaluate(()=>uiTest.setup('admin'));
  for(const [values,status,label] of [[[26,55,600],'normal','Normal'],[[30,65,1000],'warning','Warning'],[[32,75,1200],'exceeded','Danger']]){
   await page.evaluate(values=>uiTest.reading(values),values);
   const chips=page.locator('.grid2 .sensor').filter({has:page.locator('.chip.'+status)});
   assert(await chips.count()>=3,'all readings use the expected status color');
   assert((await page.locator('.grid2 .sensor .chip').allTextContents()).filter(text=>text===label).length>=3);
   assert(!await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1));
  }
  await page.evaluate(()=>uiTest.screen('about'));
  const overview=page.locator('details').filter({has:page.getByText('System Overview',{exact:true})});
  assert.equal(await overview.getAttribute('open'),null);
  await overview.locator('summary').click();assert.equal(await overview.getAttribute('open'),'');
  await overview.locator('summary').click();assert.equal(await overview.getAttribute('open'),null);
  await page.evaluate(()=>uiTest.account());
  assert.match(await page.locator('#email-form').innerText(),/PUP webmail is for registration, login, and password recovery. Reset codes will be sent to your PUP email./);
  const before=emailSaves;
  for(const [email,message] of [['','required'],['me@gmail.com','Use a PUP'],['broken@','valid email'],['name..extra@pup.edu.ph','valid email']]){
   await page.locator('#ae').fill(email);await page.locator('#email-form [type=submit]').click();assert.match(await page.locator('#email-form [data-form-error]').innerText(),new RegExp(message));
  }
  assert.equal(emailSaves,before,'invalid webmail is blocked before reaching the API');
  await page.locator('#ae').fill('valid@pup.edu.ph');await page.locator('#email-form [type=submit]').click();
  await page.getByText('Web mail saved',{exact:true}).waitFor();assert.equal(emailSaves,before+1);
  assert.equal(await page.locator('#email-form [data-form-error]').innerText(),'');
  await page.getByRole('button',{name:'Close',exact:true}).click();
 }
 await page.unroute('**/api/auth/me/email',saveEmail);await page.unroute('**/api/auth/register',register);await page.unroute('**/api/auth/login',login);
}
