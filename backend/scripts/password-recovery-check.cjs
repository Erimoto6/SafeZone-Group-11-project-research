// Mocked browser checks: no real codes or emails are sent.
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../www');
const server=http.createServer((req,res)=>{
 try{
  let name=decodeURIComponent(req.url.split('?')[0]);if(name==='/')name='/index.html';
  const data=fs.readFileSync(path.join(root,name));
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html');res.end(data);
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[],requests=[];let failForgot=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.**',r=>r.abort());
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();requests.push({path:url.pathname,body});
   if(url.pathname.endsWith('/forgot')){
    assert.equal(typeof body.identifier,'string');assert.equal(body.email,undefined);
    await new Promise(r=>setTimeout(r,40));
    return route.fulfill({status:failForgot?503:200,json:failForgot?{error:'Email temporarily unavailable'}:{ok:true,message:'If registered, a code was requested'}});
   }
   if(url.pathname.endsWith('/verify-code')){assert.equal(body.code,'123456');assert(body.identifier);return route.fulfill({json:{resetToken:'mock-reset-grant'}});}
   if(url.pathname.endsWith('/reset')){assert.equal(body.resetToken,'mock-reset-grant');assert.equal(body.newPassword,'Changed123');return route.fulfill({json:{ok:true}});}
   throw Error('Unexpected API '+url.pathname);
  });
  for(const width of [320,390,768,1280])for(const side of ['admin','viewer']){
   await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port);
   await page.locator('[data-act=role][data-v='+ (side==='admin'?'admin':'student')+']').click();
   if(side==='viewer')await page.getByRole('button',{name:'I already have an account',exact:true}).click();
   const input=side==='admin'?'#u':'#phone',identifier=side==='admin'?'admin.test':'09123456789';
   const before=requests.length;
   await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
   await page.locator('#err').getByText(/Enter your .* first/).waitFor();assert.equal(requests.length,before);assert(await page.locator(input).evaluate(el=>document.activeElement===el));
   await page.locator(input).fill(identifier);
   failForgot=true;await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
   await page.locator('#err').getByText('Email temporarily unavailable',{exact:true}).waitFor();assert.equal(await page.locator(input).inputValue(),identifier);
   failForgot=false;
   const start=requests.length;
   await page.getByRole('button',{name:'Forgot password?',exact:true}).evaluate(el=>{el.click();el.click()});
   await page.locator('#fpc').waitFor();assert.equal(requests.length,start+1,'one click flow requests exactly one code');assert.equal(requests.at(-1).body.identifier,identifier);
   assert.equal(await page.locator('#fpe').count(),0);assert.match(await page.locator('.tag-line').innerText(),/saved PUP webmail/);
   await page.getByRole('button',{name:'Send a new code',exact:true}).click();
   await page.locator('#toast').getByText('If registered, a new code was requested',{exact:true}).waitFor();assert.equal(requests.at(-1).body.identifier,identifier);
   await page.locator('#fpc').fill('123456');await page.getByRole('button',{name:'Verify code',exact:true}).click();
   await page.locator('#rp').fill('Changed123');await page.locator('#rc').fill('Changed123');
   await page.getByRole('button',{name:'Update password',exact:true}).click();
   await page.getByRole('heading',{name:'Password Updated',exact:true}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);console.log('PASS: direct admin/mobile recovery, empty identifier, service error/retry, duplicate-click prevention, resend and complete reset at 320/390/768/1280');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
