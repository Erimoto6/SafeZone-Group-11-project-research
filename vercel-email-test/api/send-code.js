// Private Railway-to-Vercel relay. Only fixed SafeZone code templates are allowed.
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const hash = value => crypto.createHash('sha256').update(value).digest();
function createHandler({env=process.env,createTransport=nodemailer.createTransport,log=console.error}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST.'});}
    const secret=env.EMAIL_RELAY_SECRET || '',authorization=req.headers.authorization;
    if(secret.length<32)return res.status(503).json({error:'Relay configuration is incomplete.',code:'RELAY_NOT_CONFIGURED'});
    if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||!crypto.timingSafeEqual(hash(authorization.slice(7)),hash(secret)))return res.status(401).json({error:'Unauthorized.'});
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({error:'Use a JSON object.'});
    const check=body.action==='check',test=body.action==='test';
    const to=typeof body.to==='string'?body.to.trim().toLowerCase():'';
    const gmail=/^[a-z0-9][a-z0-9._+\-]*@gmail\.com$/;
    const pup=/^[a-z0-9][a-z0-9._\-]*@(iskolarngbayan\.pup\.edu\.ph|pup\.edu\.ph)$/;
    const recipient=(gmail.test(to)||pup.test(to))&&to.length<=254;
    if(!check&&(!recipient||(test?!pup.test(to):(body.action!=='send'||typeof body.code!=='string'||!/^\d{6}$/.test(body.code)||!['reset','recovery'].includes(body.purpose)||body.minutes!==10))))return res.status(400).json({error:'Invalid SafeZone verification request.'});
    const user=(env.GMAIL_USER||'').trim().toLowerCase(),pass=(env.GMAIL_APP_PASSWORD||'').replace(/\s/g,'');
    if(!gmail.test(user)||!pass)return res.status(503).json({error:'Sender configuration is incomplete.',code:'SENDER_NOT_CONFIGURED'});
    const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000});
    try{
      if(check){await transport.verify();return res.status(200).json({ok:true});}
      const subject=test?'SafeZone PUP webmail delivery test':body.purpose==='recovery'?'Verify your SafeZone recovery email':'Your SafeZone password reset code';
      const text=test
        ? 'This test message was requested from the Account Settings of your SafeZone account. Receiving it confirms that SafeZone can deliver email to this PUP webmail inbox. This is not a verification or password-reset code. Your current recovery settings have not been changed.'
        : `${subject}\n\nYour verification code is ${body.code}.\nIt expires in 10 minutes. If you did not request it, ignore this email.`;
      // Include both MIME alternatives. Some institutional mail systems insert an HTML
      // warning banner; a complete HTML body keeps the code readable in that view too.
      // Subject and test content are fixed; code is validated as six digits above.
      const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head>
        <body style="margin:0;padding:24px;background-color:#ffffff;color:#241519;font-family:Arial,Helvetica,sans-serif;">
        <div style="max-width:480px;margin:0 auto;">
          <p style="color:#7a1235;font-size:20px;font-weight:bold;">SafeZone</p>
          <h1 style="font-size:22px;line-height:1.4;color:#241519;">${subject}</h1>
          ${test?`<p style="font-size:16px;line-height:1.6;color:#241519;">${text}</p>`:`
          <p style="font-size:16px;line-height:1.6;color:#241519;">Your verification code is:</p>
          <p style="font-size:32px;line-height:1.5;font-weight:bold;letter-spacing:4px;color:#7a1235;">
${body.code}
          </p>
          <p style="font-size:16px;line-height:1.6;color:#241519;">This code expires in 10 minutes. Enter it in SafeZone to continue.</p>
          <p style="font-size:14px;line-height:1.6;color:#55404a;">If you did not request this code, you can ignore this email. Do not share the code with anyone.</p>`}
        </div></body></html>`;
      const sent=await transport.sendMail({from:{name:'SafeZone',address:user},to,subject,text,html});
      if(!sent.accepted?.some(address=>String(address).toLowerCase()===to))return res.status(502).json({error:'Recipient not accepted.',code:'EENVELOPE'});
      return res.status(200).json({ok:true});
    }catch(e){
      const code=['EAUTH','ETIMEDOUT','ECONNECTION','ECONNREFUSED','ENOTFOUND','ESOCKET','EENVELOPE','EMESSAGE'].includes(e.code)?e.code:'SMTP_ERROR';
      log('SafeZone email relay failed:',code);
      return res.status(502).json({error:'Email delivery failed.',code});
    }finally{transport.close();}
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
