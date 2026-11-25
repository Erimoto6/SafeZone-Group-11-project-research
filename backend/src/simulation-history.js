// Minute summaries of actual demo ticks, separate from future hardware data.
const {pool}=require('./db');
const {HttpError}=require('./http');
const MINUTE=60000,DAY=24*60*MINUTE;
const RANGES={'6h':{hours:6,step:MINUTE},'24h':{hours:24,step:5*MINUTE},'7d':{hours:168,step:30*MINUTE}};
let unavailableUntil=0,lastPrune=0;
async function record(conn,state,now){
 if(now<unavailableUntil)return;
 const values=['temp','hum','co2'].flatMap(k=>[state[k],state[k],state[k]]);
 try {
  await conn.query(`INSERT INTO simulation_history (room_id,bucket_ms,first_ms,last_ms,samples,
   temp_sum,temp_min,temp_max,hum_sum,hum_min,hum_max,co2_sum,co2_min,co2_max)
   VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
   first_ms=LEAST(first_ms,VALUES(first_ms)),last_ms=GREATEST(last_ms,VALUES(last_ms)),samples=samples+1,
   temp_sum=temp_sum+VALUES(temp_sum),temp_min=LEAST(temp_min,VALUES(temp_min)),temp_max=GREATEST(temp_max,VALUES(temp_max)),
   hum_sum=hum_sum+VALUES(hum_sum),hum_min=LEAST(hum_min,VALUES(hum_min)),hum_max=GREATEST(hum_max,VALUES(hum_max)),
   co2_sum=co2_sum+VALUES(co2_sum),co2_min=LEAST(co2_min,VALUES(co2_min)),co2_max=GREATEST(co2_max,VALUES(co2_max))`,
   [state.room_id,Math.floor(now/MINUTE)*MINUTE,now,now,...values]);
  if(!lastPrune||now-lastPrune>=60*MINUTE){
   await conn.query('DELETE FROM simulation_history WHERE bucket_ms < ?',[Math.floor((now-8*DAY)/MINUTE)*MINUTE]);lastPrune=now;
  }
 }catch(error){
  if(error.code!=='ER_NO_SUCH_TABLE')throw error;
  // Existing deployments keep running demos until migration 11 is installed.
  unavailableUntil=now+MINUTE;
 }
}
async function read({roomId,metric,range},now=Date.now()){
 const id=Number(roomId),config=typeof range==='string'&&Object.hasOwn(RANGES,range)?RANGES[range]:null;
 if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'Choose a valid room.');
 if(!['temp','hum','co2'].includes(metric))throw new HttpError(400,'Choose temperature, humidity or CO₂.');
 if(!config)throw new HttpError(400,'Choose Last 6 hours, Last 24 hours or Last 7 days.');
 const [[room]]=await pool.query('SELECT id FROM rooms WHERE id=? AND room_no NOT IN (108,205,210,307,309)',[id]);
 if(!room)throw new HttpError(404,'Room not found.');
 const from=now-config.hours*3600000;
 // Summaries have minute resolution; include the minute containing the window start.
 const cutoff=Math.floor(from/MINUTE)*MINUTE;
 try {
  const [points]=await pool.query(`SELECT FLOOR(bucket_ms/?) AS bucket,
   MIN(first_ms) AS at,SUM(${metric}_sum)/SUM(samples) AS value,
   MIN(${metric}_min) AS lowest,MAX(${metric}_max) AS highest,SUM(samples) AS samples
   FROM simulation_history WHERE room_id=? AND bucket_ms>=? AND bucket_ms<=?
   GROUP BY bucket ORDER BY bucket`,[config.step,id,cutoff,now]);
  const [[stats]]=await pool.query(`SELECT SUM(samples) AS samples,MIN(first_ms) AS firstAt,MAX(last_ms) AS lastAt,
   MIN(${metric}_min) AS lowest,MAX(${metric}_max) AS highest,SUM(${metric}_sum)/SUM(samples) AS average
   FROM simulation_history WHERE room_id=? AND bucket_ms>=? AND bucket_ms<=?`,[id,cutoff,now]);
  return {source:'simulation',roomId:String(id),metric,range,from,to:now,resolutionMs:config.step,
   points:points.map(p=>({at:Math.min(now,Math.max(from,Number(p.at))),value:Number(p.value)})),
   count:Number(stats.samples||0),firstAt:stats.firstAt==null?null:Number(stats.firstAt),lastAt:stats.lastAt==null?null:Number(stats.lastAt),
   stats:{min:stats.lowest==null?null:Number(stats.lowest),max:stats.highest==null?null:Number(stats.highest),avg:stats.average==null?null:Number(stats.average)}};
 }catch(error){
  if(error.code==='ER_NO_SUCH_TABLE')throw new HttpError(503,'Saved history needs database migration 11-simulation-history.sql. Ask your administrator to install it.');
  throw error;
 }
}
module.exports={record,read};
