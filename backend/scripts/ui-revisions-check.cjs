const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../../www');
const hook=`window.uiTest={setup(role){token='test';S.role=role;S.me={id:7,name:'Admin',phone:'09123456789',email:'admin@pup.edu.ph'};S.rooms=DEFAULT_ROOMS.map(cfg=>makeRoom({...cfg,id:cfg.name.split(' ')[1]}));S.roomId=S.rooms[0].id;S.archiveAvailable=true;S.accounts=[{id:1,role:'admin',name:'Admin',email:'admin@pup.edu.ph',phone:'09123456789'},{id:2,role:'viewer',kind:'student',email:'student@iskolarngbayan.pup.edu.ph',courseCode:'BSIT',section:'1-1',phone:'09123456780'},{id:3,role:'viewer',kind:'student',email:'another@iskolarngbayan.pup.edu.ph',courseCode:'BSIT',section:'2-1',phone:'09123456781'},{id:4,role:'viewer',kind:'student',email:'legacy@iskolarngbayan.pup.edu.ph',courseCode:null,section:null,phone:'09123456782'}];S.rooms.forEach((r,i)=>{r.devices=[{type:'exhaust_fan',label:'Exhaust fan',quantity:2,activeQuantity:0,wattsPerDevice:40,fanType:'wall'},{type:'esp8266',label:'NodeMCU V3 ESP8266',quantity:1,activeQuantity:0,wattsPerDevice:0,fanType:null}];r.observed=true;r.reading={temp:i===0?35:26,hum:55,co2:i===1?1600:500};r.buf={t:[Date.now()-2000,Date.now()],temp:[26,27],hum:[55,55],co2:[500,500]}});S.alerts=[{id:1,roomId:S.roomId,type:'warning',metric:'temp',value:30,title:'High temperature',body:'Warning: 29; limit: 32',ts:Date.now()}];S.screen='home';render();},async screen(v){closeSheet();S.screen=v;render();if(v==='analytics')await loadTemperatureAnalytics();},history(){S.mon.view='history';render()},account(){return ACTS.account()},theme(v){S.theme=v;applyTheme();render()},edit(){S.screen='settings';return ACTS.editRoom(S.roomId)},inventory(){return readDeviceRows()},status(){return S.rooms.map(r=>overviewStatus(r,S.limits))}};`;
const server=http.createServer((req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';let data=fs.readFileSync(root+p);if(p.endsWith('app.js'))data=data.toString().replace('(async function init() {',hook+'\n(async function init() {').replace('setInterval(pollShared, 2000);','');res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html');res.end(data)}catch{res.writeHead(404);res.end()}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());let analyticsFail=false;await page.route('**/api/**',r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/temperature-analytics')){if(analyticsFail)return r.fulfill({status:503,json:{error:'History temporarily unavailable'}});const range=url.searchParams.get('range');return r.fulfill({json:{range,generatedAt:Date.now(),totalAlerts:range==='30d'?0:12,rooms:range==='30d'?[]:[{roomId:'102',room:'Room 102',floor:1,alertCount:8,alertDays:3,lastAlertAt:Date.now()},{roomId:'101',room:'Room 101',floor:1,alertCount:4,alertDays:2,lastAlertAt:Date.now()}]}})}return r.fulfill({json:{profile:null}})});for(const width of [320,390,768,1280])for(const theme of ['light','dark'])for(const role of ['admin','student']){await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(role=>uiTest.setup(role),role);await page.evaluate(theme=>uiTest.theme(theme),theme);for(const screen of ['home','monitor','status','alerts','rooms','analytics',...(role==='admin'?['settings','users','students']:[])]){await page.evaluate(v=>uiTest.screen(v),screen);assert(!await page.locator('main').innerText().then(t=>/electricity|kWh/i.test(t)),screen+' energy hidden');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),screen+' page overflow '+width);const overflow=await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert(!overflow,screen+' main overflow '+width);assert.equal(await page.locator('.monitor-links').count(),screen==='monitor'?1:0);if(['rooms','analytics'].includes(screen)){await page.getByRole('button',{name:'Back to monitor',exact:true}).click();assert.equal(await page.locator('main').getAttribute('data-s'),'monitor');await page.evaluate(v=>uiTest.screen(v),screen);}if(screen==='rooms'){assert.equal(await page.locator('tbody tr').count(),43);assert.equal(await page.locator('.room-state-exceeded').count(),2);await page.selectOption('#overview-floor','4');assert.equal(await page.locator('tbody tr').count(),12);await page.selectOption('#overview-floor','all')}if(screen==='analytics'){
 assert.match(await page.locator('.temperature-rank').first().innerText(),/Room 102/);
 assert.equal(await page.locator('.temperature-rank .rank-reading b').first().innerText(),'8');
 await page.locator('[data-act=analyticsRange][data-v="30d"]').click();await page.getByText('No temperature limit alerts were recorded for this period.',{exact:true}).waitFor();
 await page.locator('[data-act=analyticsRange][data-v=all]').click();await page.locator('.temperature-rank').first().waitFor();assert.equal(await page.locator('.temperature-rank').count(),2);await page.locator('.temperature-rank').first().click();assert.equal(await page.locator('main').getAttribute('data-s'),'monitor');assert.match(await page.locator('.roompick').innerText(),/Room 102/);await page.evaluate(()=>uiTest.screen('analytics'));
}if(screen==='status'){assert.match(await page.locator('main').innerText(),/Microcontroller/);assert(!/NodeMCU V3 ESP8266/.test(await page.locator('main').innerText()));}if(screen==='monitor'){await checkMonitoring(page,role);assert(await page.locator('main').evaluate(el=>Boolean(el.querySelector('.chart').compareDocumentPosition(el.querySelector('.monitor-links'))&Node.DOCUMENT_POSITION_FOLLOWING)));}if(screen==='monitor'&&role==='admin'){
 assert(await page.locator('.fan-control-card').evaluate(el=>{const status=el.querySelector('.s-val').getBoundingClientRect(),toggle=el.querySelector('[role=switch]').getBoundingClientRect(),card=el.getBoundingClientRect();return toggle.left>status.right && toggle.right<=card.right;}));
 await page.getByRole('button',{name:'Installation type',exact:true}).click();await page.locator('#fan-installation-form').waitFor();assert(!await page.locator('.sheet').evaluate(el=>el.scrollWidth>el.clientWidth+1));assert.equal(await page.locator('[data-fan-placement]').inputValue(),'wall');await page.getByRole('button',{name:'Close',exact:true}).click();} if(screen==='alerts'){assert.equal(await page.getByRole('button',{name:'Archive alert',exact:true}).count(),1);const css=await page.locator('.alert.normal,.alert.warning').first().evaluate(el=>getComputedStyle(el).borderLeftWidth);assert.equal(css,'1px');assert.notEqual(await page.locator('h4 time').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)')}if(screen==='users'){assert.equal(await page.locator('table').count(),0);assert(await page.locator('#rp').evaluate(el=>el.closest('.field').nextElementSibling.matches('.rules')));await page.locator('#admin-form [type=submit]').click();await page.getByText('Enter a full name from 2 to 100 characters.',{exact:true}).waitFor();}if(screen==='students'){
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
} }await page.evaluate(()=>{uiTest.screen('monitor');uiTest.history()});await checkMonitoring(page,role);assert.match(await page.locator('main').innerText(),/browser session only/);assert(await page.locator('main').evaluate(el=>Boolean(el.querySelector('.chart').compareDocumentPosition(el.querySelector('.monitor-links'))&Node.DOCUMENT_POSITION_FOLLOWING)));await page.evaluate(()=>uiTest.account());assert(await page.locator('#np').evaluate(el=>el.nextElementSibling.matches('.rules')));await page.locator('#np').fill('Abc123');assert.equal(await page.locator('#rules-np li.ok').count(),3)}await page.evaluate(()=>uiTest.setup('admin'));analyticsFail=true;await page.evaluate(()=>uiTest.screen('analytics'));assert.match(await page.locator('[role=alert]').innerText(),/history could not load/i);analyticsFail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.temperature-rank').first().waitFor();await checkInstallationSave(page);await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/safezone-monitor-compact.png'});assert.deepEqual(errors,[]);console.log('PASS: admin/student screens in both themes at 320/390/768/1280; Monitoring order, menu links, placement save/retry, controller preservation and existing UI regressions');}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});

async function checkMonitoring(page,role){
 const selectors=['.roombar','.monitor-utilities','.seg','.mini-chips','.chart','.monitor-links'];
 const positions=await page.locator('main').evaluate((el,selectors)=>selectors.map(s=>el.querySelector(s).getBoundingClientRect().top),selectors);
 assert(positions.every((top,i)=>i===0||top>positions[i-1]),'Monitoring order: room, fan, view, readings, graph, links');
 assert.equal(await page.locator('[data-act=fanInstallation]').count(),role==='admin'?1:0);
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 assert(!/All classrooms|Temperature analytics/.test(await page.locator('.sheet').innerText()));
 await page.getByRole('button',{name:'Close',exact:true}).click();
}
async function checkInstallationSave(page){
 await page.evaluate(()=>{uiTest.setup('admin');uiTest.screen('monitor')});
 const original=[{type:'exhaust_fan',label:'Exhaust fan',quantity:2,activeQuantity:0,wattsPerDevice:40,fanType:'wall'},{type:'esp8266',label:'NodeMCU V3 ESP8266',quantity:1,activeQuantity:0,wattsPerDevice:0,fanType:null}];
 await page.evaluate(()=>uiTest.edit());
 assert.equal(await page.locator('[data-device=label]').nth(1).inputValue(),'Microcontroller');
 assert.deepEqual(await page.evaluate(()=>uiTest.inventory()),[original[0],{...original[1],fanType:'unspecified'}],'display label preserves controller configuration');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>uiTest.screen('monitor'));
 let saved,fail=true;
 const thresholds={temp:{warn:30,limit:32},hum:{warn:65,limit:75},co2:{warn:1000,limit:1200}};
 const room=()=>({id:'101',name:'Room 101',floor:1,lights:0,wattsPerLight:18,fanWatts:80,ventMode:'auto',fanOn:false,updatedAt:Date.now(),reading:{temp:26,hum:55,co2:500},levels:{temp:'normal',hum:'normal',co2:'normal'},devices:saved||original});
 await page.route('**/api/**',r=>{
  const path=new URL(r.request().url()).pathname.replace('/api','');
  if(r.request().method()==='PATCH'){
   saved=r.request().postDataJSON().devices;
   return r.fulfill(fail?{status:503,json:{error:'Try saving again'}}:{json:{room:room()}});
  }
  const responses={'/rooms':{rooms:[room()]},'/settings':{thresholds,fanTrigger:'exceeded',ventMode:'auto'},'/simulation':{thresholds,fanTrigger:'exceeded',rooms:[room()]},'/alerts':{alerts:[],archiveAvailable:true},'/admin/users':{admins:[],viewers:[]},'/sms-recipients':{recipients:[]}};
  return r.fulfill({json:responses[path]||{}});
 });
 await page.getByRole('button',{name:'Installation type',exact:true}).click();
 for(const value of ['window','ceiling','wall'])await page.selectOption('[data-fan-placement]',value);
 await page.selectOption('[data-fan-placement]','ceiling');
 await page.getByRole('button',{name:'Save installation type',exact:true}).click();
 await page.getByText('Try saving again',{exact:true}).waitFor();
 assert.deepEqual(saved,[{...original[0],fanType:'ceiling'},original[1]],'placement update preserves other inventory fields');
 assert.equal(await page.locator('[data-fan-placement]').inputValue(),'ceiling','failed save retains selection');
 fail=false;
 await page.getByRole('button',{name:'Save installation type',exact:true}).click();
 await page.locator('#fan-installation-form').waitFor({state:'detached'});
 await page.getByRole('button',{name:'Installation type',exact:true}).click();
 assert.equal(await page.locator('[data-fan-placement]').inputValue(),'ceiling','saved placement reloads');
 await page.getByRole('button',{name:'Close',exact:true}).click();
}
