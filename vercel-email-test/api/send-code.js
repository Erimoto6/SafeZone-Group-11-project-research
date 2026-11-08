// Private Railway-to-Vercel relay. Only fixed SafeZone code templates are allowed.
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const hash = value => crypto.createHash('sha256').update(value).digest();
function createHandler({env=process.env,createTransport=nodemailer.createTransport,log=console.error}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST.'});}
    const secret=env.EMAIL_RELAY_SECRET || '',authorization=req.headers.authorization;
    if(secret.length<32)return res.status(503).json({error:'Relay configuration is incomplete.'});
    if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||!crypto.timingSafeEqual(hash(authorization.slice(7)),hash(secret)))return res.status(401).json({error:'Unauthorized.'});
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({error:'Use a JSON object.'});
    const check=body.action==='check';
    const to=typeof body.to==='string'?body.to.trim().toLowerCase():'';
    const gmail=/^[a-z0-9][a-z0-9._+\-]*@gmail\.com$/;
    if(!check&&(body.action!=='send'||!gmail.test(to)||to.length>254||typeof body.code!=='string'||!/^\d{6}$/.test(body.code)||!['reset','recovery'].includes(body.purpose)||body.minutes!==10))return res.status(400).json({error:'Invalid SafeZone verification request.'});
    const user=(env.GMAIL_USER||'').trim().toLowerCase(),pass=(env.GMAIL_APP_PASSWORD||'').replace(/\s/g,'');
    if(!gmail.test(user)||!pass)return res.status(503).json({error:'Sender configuration is incomplete.'});
    const transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000});
    try{
      if(check){await transport.verify();return res.status(200).json({ok:true});}
      const subject=body.purpose==='recovery'?'Verify your SafeZone recovery Gmail':'Your SafeZone password reset code';
      const sent=await transport.sendMail({from:{name:'SafeZone',address:user},to,subject,text:`${subject}\n\nYour verification code is ${body.code}.\nIt expires in 10 minutes. If you did not request it, ignore this email.`});
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
