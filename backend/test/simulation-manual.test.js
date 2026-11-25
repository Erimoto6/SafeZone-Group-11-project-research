const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');

function simulator({metric='co2',mode='manual',trigger='exceeded'}={}) {
 const limits={temp:{warn:30,limit:32},hum:{warn:65,limit:75},co2:{warn:1000,limit:1200}};
 let now=0;
 const state={room_id:1,room_no:101,vent_mode:mode,temp:27.4,hum:58,co2:827,temp_level:'normal',hum_level:'normal',co2_level:'normal',fan_on:0,scenario:metric,last_step_at:new Date(0),fan_watts:40};
 state.start_value=state[metric];
 const events=[];
 const query=async(sql,p=[])=>{
  if(sql.startsWith('INSERT INTO simulation_history')||sql.startsWith('DELETE FROM simulation_history'))return [{}];
  if(sql.startsWith('INSERT IGNORE')||sql.startsWith('UPDATE electricity_usage'))return [{}];
  if(sql.startsWith('SELECT metric'))return [Object.entries(limits).map(([metric,t])=>({metric,warn_value:t.warn,limit_value:t.limit}))];
  if(sql.startsWith('SELECT setting_value'))return [[{setting_value:trigger}]];
  if(sql.startsWith('SELECT s.*'))return [[{...state}]];
  if(sql.startsWith('SELECT id FROM rooms'))return [[{id:1}]];
  if(sql.startsWith('UPDATE rooms SET vent_mode')){state.vent_mode='manual';return [{}];}
  if(sql.startsWith('UPDATE simulation_state SET fan_on')){state.fan_on=p[0]?1:0;return [{}];}
  if(sql.startsWith('INSERT INTO alerts')){events.push({type:p[1],metric:p[4],value:p[5]});return [{}];}
  if(sql.startsWith('UPDATE simulation_state SET temp=?')){
   if(sql.includes('scenario=NULL'))Object.assign(state,{temp:p[0],hum:p[1],co2:p[2],scenario:null,start_value:null,fan_on:0,temp_level:'normal',hum_level:'normal',co2_level:'normal',last_step_at:new Date(now)});
   else Object.assign(state,{temp:p[0],hum:p[1],co2:p[2],scenario:p[3],fan_on:p[4],temp_level:p[5],hum_level:p[6],co2_level:p[7],last_step_at:p[8]});
   return [{}];
  }
  throw Error('Unexpected query: '+sql);
 };
 const conn={query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
 const out={exports:{}},requireSource=createRequire(require.resolve('../src/simulation'));
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/simulation'),'utf8'),{module:out,console,require:name=>name==='./db'?{pool:{getConnection:async()=>conn}}:name==='./room-devices'?{load:async()=>new Map()}:requireSource(name)});
 return {state,events,limits,control:out.exports.control,async step(count=1){for(let i=0;i<count;i++){now+=2000;await out.exports.advance(now,0);}}};
}

for(const metric of ['temp','hum','co2'])test(`manual fan OFF holds the ${metric} demo at danger without false recovery`,async()=>{
 const sim=simulator({metric});await sim.step(40);
 assert.equal(sim.state[metric],sim.limits[metric].limit);
 assert.equal(sim.state[metric+'_level'],'exceeded');assert.equal(sim.state.scenario,metric);assert.equal(sim.state.fan_on,0);
 assert.equal(sim.events.filter(e=>e.type==='warning'&&e.metric===metric).length,1);
 assert.equal(sim.events.filter(e=>e.type==='exceeded'&&e.metric===metric).length,1);
 assert(!sim.events.some(e=>e.type==='normal'));
 await sim.control({metric:'fan',roomIds:[1],fanOn:true});await sim.step();
 assert(sim.state[metric]<sim.limits[metric].limit);
 await sim.control({metric:'fan',roomIds:[1],fanOn:false});await sim.step(15);
 assert.equal(sim.state[metric],sim.limits[metric].limit,'interrupted recovery must not clear the active source');
 await sim.control({metric:'fan',roomIds:[1],fanOn:true});await sim.step(30);
 assert.equal(sim.state[metric+'_level'],'normal');assert.equal(sim.state.scenario,null);assert.equal(sim.state.fan_on,1);
 assert.equal(sim.events.filter(e=>e.type==='normal').length,1);
 await sim.control({metric:'fan',roomIds:[1],fanOn:false});await sim.step(30);
 assert.equal(sim.state[metric+'_level'],'normal','completed demo does not restart when the fan is stopped');
});
for(const trigger of ['warning','exceeded'])test(`automatic ventilation still starts at ${trigger} and clears the demo`,async()=>{
 const sim=simulator({mode:'auto',trigger});
 for(let i=0;i<(trigger==='warning'?6:12);i++)await sim.step();
 assert.equal(sim.state.fan_on,1);assert.equal(sim.state.co2_level,trigger);
 await sim.step(30);assert.equal(sim.state.co2_level,'normal');assert.equal(sim.state.scenario,null);assert.equal(sim.state.fan_on,0);
 if(trigger==='warning')assert(!sim.events.some(e=>e.type==='exceeded'));
});
test('Reset explicitly clears an elevated fan-off demo',async()=>{
 const sim=simulator();await sim.step(30);await sim.control({metric:'reset',roomIds:[1]});
 assert.equal(sim.state.scenario,null);assert.equal(sim.state.co2,827);assert.equal(sim.state.fan_on,0);
 await sim.step(30);assert.equal(sim.state.co2,827);assert.equal(sim.state.co2_level,'normal');
});
