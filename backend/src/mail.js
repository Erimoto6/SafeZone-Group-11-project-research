// Sends reset/recovery codes through the Vercel HTTPS relay when configured.
// Otherwise uses legacy SMTP or development-only terminal mode.
//  - SMTP_HOST filled in .env  -> a real email is sent (Brevo, SendGrid, Gmail SMTP, ...).
//  - SMTP_HOST empty           -> the code is printed in the terminal (for testing only).
const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

// HTTPS takes precedence over legacy SMTP; never fall back if relay configuration fails.
async function relayRequest(body) {
  const secret=process.env.EMAIL_RELAY_SECRET || '';
  let url;
  try { url=new URL(process.env.EMAIL_RELAY_URL); } catch { throw Object.assign(new Error('Configure EMAIL_RELAY_URL.'),{code:'RELAY_CONFIG'}); }
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/api/send-code'||secret.length<32)throw Object.assign(new Error('Invalid email relay configuration.'),{code:'RELAY_CONFIG'});
  let response;
  try {
    response=await fetch(url.href,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  } catch { throw Object.assign(new Error('Email relay could not be reached.'),{code:'RELAY_CONNECTION'}); }
  let result;
  try { result=await response.json(); } catch { throw Object.assign(new Error('Email relay did not return JSON; check deployment protection and URL.'),{code:'RELAY_RESPONSE'}); }
  if(!response.ok || result.ok!==true){
    const allowed=['EAUTH','ETIMEDOUT','EENVELOPE','ECONNECTION','ECONNREFUSED','ENOTFOUND','ESOCKET','EMESSAGE','SMTP_ERROR','RELAY_NOT_CONFIGURED','SENDER_NOT_CONFIGURED'];
    const code=response.status===401?'RELAY_AUTH':response.status===404?'RELAY_NOT_FOUND':response.status===403?'RELAY_FORBIDDEN':allowed.includes(result.code)?result.code:'RELAY_ERROR';
    throw Object.assign(new Error('Email relay rejected the request.'),{code,relayStatus:response.status});
  }
}
const usesRelay=()=>Boolean(process.env.EMAIL_RELAY_URL || process.env.EMAIL_RELAY_SECRET);

// Check configuration/connectivity before looking up an account. This returns the
// same outage response for registered and unregistered addresses.
let verifiedUntil = 0, verification = null;
async function ensureDeliveryAvailable() {
  if (usesRelay()) {
    if (Date.now() < verifiedUntil) return;
    if (!verification) verification=relayRequest({action:'check'}).then(()=>{verifiedUntil=Date.now()+60000;}).finally(()=>{verification=null;});
    await verification;
    return;
  }
  if (!transport) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured.');
    return;
  }
  if (!process.env.MAIL_FROM && !process.env.SMTP_USER) throw new Error('MAIL_FROM is required.');
  if (Date.now() < verifiedUntil) return;
  if (!verification) verification = transport.verify().then(() => {
    verifiedUntil = Date.now() + 60000;
  }).finally(() => { verification = null; });
  await verification;
}

// Remembers the last code per address, only while testing. Not kept in production.
const lastCodes = new Map();

async function sendResetCode(to, code, minutes, purpose = 'reset') {
  await ensureDeliveryAvailable();
  if (process.env.NODE_ENV !== 'production') lastCodes.set(to, code);

  if (usesRelay()) {
    try { await relayRequest({action:'send',to,code,minutes,purpose}); } catch(e) { verifiedUntil=0;throw e; }
    return {sent:true,testMode:false};
  }

  if (!transport) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not set up, so email cannot be sent.');
    console.log(`\n[TEST MODE] No SMTP set. Password reset code for ${to}: ${code}\n`);
    return { sent: false, testMode: true };
  }

  const title = purpose === 'recovery' ? 'Verify your SafeZone recovery Gmail' : 'Your SafeZone password reset code';
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: title,
    text: `${title}. Your SafeZone code is ${code}.\n\nIt works for ${minutes} minutes. If you did not ask to reset your password, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px">
      <h2 style="color:#7A1235;margin:0 0 8px">SafeZone</h2>
      <p>Your password reset code is:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:8px 0">${code}</p>
      <p>It works for ${minutes} minutes. If you did not ask to reset your password, you can ignore this email.</p></div>`
  });
  return { sent: true, testMode: false };
}

async function sendWebmailTest(to) {
  if(!usesRelay())throw Object.assign(new Error('Configure the email relay first.'),{code:'RELAY_CONFIG'});
  await ensureDeliveryAvailable();
  await relayRequest({action:'test',to});
  return {sent:true};
}

module.exports = { sendResetCode, lastCodes, ensureDeliveryAvailable, sendWebmailTest };
