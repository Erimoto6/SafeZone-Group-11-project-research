const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/send-code');
const env={EMAIL_RELAY_SECRET:'relay-secret-at-least-32-characters-long',GMAIL_USER:'safezone.project0@gmail.com',GMAIL_APP_PASSWORD:'test-password'};
function setup(options={}){
 const messages=[];let checks=0,closed=0;
 const handler=createHandler({env,createTransport:()=>({verify:async()=>{checks++;},sendMail:async m=>{messages.push(m);return{accepted:[m.to]};},close(){closed++;}}),...options});
 return{messages,get checks(){return checks;},get closed(){return closed;},async call(body,authorization='Bearer '+env.EMAIL_RELAY_SECRET){const res={setHeader(){},status(s){this.statusCode=s;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization},body},res);return res;}};
}
test('relay refuses missing/wrong credentials before checking SMTP',async()=>{const f=setup();assert.equal((await f.call({action:'check'},'')).statusCode,401);assert.equal((await f.call({action:'check'},'Bearer wrong')).statusCode,401);assert.equal(f.checks,0);assert.equal(f.closed,0);});
test('authenticated readiness checks verify SMTP without sending',async()=>{const f=setup();assert.equal((await f.call({action:'check'})).statusCode,200);assert.equal(f.checks,1);assert.equal(f.messages.length,0);assert.equal(f.closed,1);});
test('relay sends fixed recovery and reset templates, never caller content',async()=>{const f=setup();for(const purpose of ['recovery','reset']){const r=await f.call({action:'send',to:'user@gmail.com',code:'123456',minutes:10,purpose,subject:'CUSTOM',text:'INJECTED',html:'<p>INJECTED_HTML</p>',from:'spoof@gmail.com'});assert.equal(r.statusCode,200);const m=f.messages.at(-1);assert.equal(m.from.address,env.GMAIL_USER);assert.match(m.text,/123456/);assert.match(m.html,/123456/);assert.match(m.html,/expires in 10 minutes/);assert(!m.text.includes('INJECTED'));assert(!m.html.includes('INJECTED'));assert.notEqual(m.subject,'CUSTOM');assert.equal(m.to,'user@gmail.com');}assert.equal(f.closed,2);});
test('malformed destinations, codes, durations and purposes cannot send mail',async()=>{const f=setup(),body={action:'send',to:'user@gmail.com',code:'123456',minutes:10,purpose:'reset'};for(const change of [{to:'a@gmail.com,b@gmail.com'},{to:'a@outlook.com'},{code:'<img>'},{code:123456},{purpose:'marketing'},{minutes:999},{action:'anything'}])assert.equal((await f.call({...body,...change})).statusCode,400);assert.equal(f.messages.length,0);});

test('missing Vercel variables return distinct safe diagnostic codes',async()=>{
 assert.equal((await setup({env:{...env,EMAIL_RELAY_SECRET:''}}).call({action:'check'})).body.code,'RELAY_NOT_CONFIGURED');
 assert.equal((await setup({env:{...env,GMAIL_APP_PASSWORD:''}}).call({action:'check'})).body.code,'SENDER_NOT_CONFIGURED');
});

test('relay supports both PUP webmail domains and rejects lookalikes',async()=>{
 const f=setup();
 for(const to of ['student@iskolarngbayan.pup.edu.ph','faculty@pup.edu.ph'])assert.equal((await f.call({action:'send',to,code:'123456',minutes:10,purpose:'reset'})).statusCode,200);
 for(const to of ['student@evil.pup.edu.ph','student@pup.edu.ph.evil.com','student@outlook.com'])assert.equal((await f.call({action:'test',to})).statusCode,400);
});
test('webmail test sends fixed content, not a real reset or caller-supplied code',async()=>{
 const f=setup();const r=await f.call({action:'test',to:'student@iskolarngbayan.pup.edu.ph',code:'123456',text:'INJECTED',subject:'INJECTED'});
 assert.equal(r.statusCode,200);const m=f.messages[0];assert.equal(m.subject,'SafeZone PUP webmail delivery test');assert.match(m.text,/not a verification or password-reset code/);assert(!m.text.includes('123456'));assert(!m.html.includes('123456'));assert.match(m.html,/not a verification or password-reset code/);assert(!m.text.includes('INJECTED'));
 assert.equal((await f.call({action:'test',to:'user@gmail.com'})).statusCode,400);
});

test('generated reset MIME includes readable plain text and HTML with the same code without contacting SMTP',async()=>{
 const nodemailer=require('nodemailer');let raw='';
 const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
 const f=setup({createTransport:()=>({sendMail:async message=>{const result=await stream.sendMail(message);raw=result.message.toString('utf8');return {accepted:[message.to]};},close(){stream.close();}})});
 const response=await f.call({action:'send',to:'student@iskolarngbayan.pup.edu.ph',code:'864209',minutes:10,purpose:'reset'});
 assert.equal(response.statusCode,200);
 assert.match(raw,/Content-Type: multipart\/alternative/i);
 assert.match(raw,/Content-Type: text\/plain; charset=utf-8/i);
 assert.match(raw,/Content-Type: text\/html; charset=utf-8/i);
 assert.match(raw,/Your verification code is 864209/);
 assert.match(raw,/\r?\n864209\r?\n/);
 assert.match(raw,/Subject: Your SafeZone password reset code/);
 assert(!/display:\s*none|visibility:\s*hidden/i.test(raw));
});
