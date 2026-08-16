import fs from 'node:fs';
const files=['artifacts/evaluation/smoke.log','artifacts/evaluation/adjudication.log'];
const rows=[];
for(const f of files){
  if(!fs.existsSync(f)) continue;
  for(const line of fs.readFileSync(f,'utf8').split('\n')){
    if(!line.startsWith('{"level"')) continue;
    let o; try{o=JSON.parse(line)}catch{continue}
    if(o.event!=='request.completed'||!o.modelName) continue;
    rows.push({model:o.modelName,endpoint:o.providerEndpoint??'(none)',role:o.role,
      prompt:o.promptTokenCount??0,out:o.candidatesTokenCount??0});
  }
}
const mini=rows.filter(r=>r.model.includes('minimax'));
console.log('MiniMax calls logged:',mini.length,'of',rows.length,'total');
const empty=r=>r.out<=5;
const byEnd={};
for(const r of mini){
  const e=byEnd[r.endpoint] ??= {n:0,empty:0,promptSum:0,emptyPromptSum:0};
  e.n++; e.promptSum+=r.prompt;
  if(empty(r)){e.empty++; e.emptyPromptSum+=r.prompt;}
}
console.log('\nendpoint          calls   empty{}   rate   mean prompt tok');
for(const [k,v] of Object.entries(byEnd).sort((a,b)=>b[1].n-a[1].n)){
  console.log(k.padEnd(18),String(v.n).padStart(5),String(v.empty).padStart(9),
    ((100*v.empty/v.n).toFixed(1)+'%').padStart(7), Math.round(v.promptSum/v.n).toString().padStart(12));
}
const em=mini.filter(empty), ok=mini.filter(r=>!empty(r));
const mean=a=>a.length?Math.round(a.reduce((s,x)=>s+x.prompt,0)/a.length):0;
console.log('\nprompt tokens: empty-response calls mean',mean(em),'| successful calls mean',mean(ok));
console.log('empty by role:',JSON.stringify(em.reduce((o,r)=>{o[r.role]=(o[r.role]||0)+1;return o},{})));
// other models for contrast
for(const m of [...new Set(rows.map(r=>r.model))].filter(m=>!m.includes('minimax'))){
  const s=rows.filter(r=>r.model===m);
  console.log(m.padEnd(24),'calls',String(s.length).padStart(4),'empty',s.filter(empty).length);
}
