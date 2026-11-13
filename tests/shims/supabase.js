// Xotiradagi (in-memory) Supabase o'rnini bosuvchi — PostgREST so'rovlari semantikasi
const DB=global.__DB={categories:[],products:[],banners:[],stories:[],reviews:[],orders:[],users:[],settings:[],broadcasts:[],integration:[],sync_log:[]};
const PK={users:'tg_id',settings:'key',integration:'key'};let seq=1000;
const DEF={products:{active:true,draft:false,sold_out:false,source:'manual',images:[],sizes:[],old_price:null,stock:null,qty:null,external_id:null,sku:null,barcode:null,category_id:null,description:null},orders:{status:'new'},banners:{active:true,sort:0},stories:{active:true,sort:0},broadcasts:{status:'running',sent:0,failed:0,total:0},sync_log:{ok:true}};
function q(t){const st={t,f:[],op:'select',ord:[],lim:null,rng:null,one:false,maybe:false,head:false,count:false,sel:'*'};
const o={select(s,opt){if(st.op==='select'){st.sel=s||'*';if(opt?.head)st.head=true;if(opt?.count)st.count=true}else st.ret=true;return o},
eq(k,v){st.f.push(r=>r[k]===v||String(r[k])===String(v)&&v!=null);return o},neq(k,v){st.f.push(r=>r[k]!==v);return o},gt(k,v){st.f.push(r=>r[k]>v);return o},gte(k,v){st.f.push(r=>r[k]>=v);return o},in(k,v){st.f.push(r=>v.includes(r[k]));return o},
order(k,op={}){st.ord.push([k,op.ascending!==false]);return o},limit(n){st.lim=n;return o},range(a,b){st.rng=[a,b];return o},single(){st.one=true;return o},maybeSingle(){st.one=true;st.maybe=true;return o},
insert(r){st.op='insert';st.rows=[].concat(r);return o},upsert(r,op){st.op='upsert';st.rows=[].concat(r);st.oc=op?.onConflict||PK[t]||'id';return o},update(r){st.op='update';st.row=r;return o},delete(){st.op='delete';return o},
then(res,rej){return Promise.resolve().then(()=>run(st)).then(res,rej)}};return o}
function pick(r,sel){if(sel==='*')return {...r};const o={};sel.split(',').forEach(k=>o[k.trim()]=r[k.trim()]);return o}
function run(st){const T=DB[st.t]||(DB[st.t]=[]);const now=new Date().toISOString();
 for(const r of st.rows||[]){if(st.t==='products'||st.t==='categories'||st.t==='orders'){for(const[k,v] of Object.entries(r))if(v===undefined)delete r[k]}}
 if(st.op==='insert'){const ins=st.rows.map(r=>{const x={...(DEF[st.t]||{}),created_at:now,...r};if(!PK[st.t]&&x.id==null)x.id=++seq;
   if(st.t==='products'&&(x.name==null||x.price==null))throw Object.assign(new Error('not null'),{});T.push(x);return x});return out(st,ins)}
 if(st.op==='upsert'){const res=[];for(const r of st.rows){const k=st.oc;const i=T.findIndex(x=>x[k]===r[k]);if(i>=0){T[i]={...T[i],...r};res.push(T[i])}else{const x={...(DEF[st.t]||{}),created_at:now,...r};if(!PK[st.t]&&x.id==null)x.id=++seq;T.push(x);res.push(x)}}return {data:res,error:null}}
 let rows=T.filter(r=>st.f.every(f=>f(r)));
 if(st.op==='update'){rows.forEach(r=>Object.assign(r,st.row));return out(st,rows)}
 if(st.op==='delete'){DB[st.t]=T.filter(r=>!rows.includes(r));return {data:null,error:null}}
 for(const[k,asc] of [...st.ord].reverse())rows=[...rows].sort((a,b)=>(a[k]>b[k]?1:a[k]<b[k]?-1:0)*(asc?1:-1));
 const count=rows.length;if(st.rng)rows=rows.slice(st.rng[0],st.rng[1]+1);if(st.lim)rows=rows.slice(0,st.lim);
 if(st.head)return {data:null,count,error:null};
 return out(st,rows.map(r=>pick(r,st.sel)),count)}
function out(st,rows,count){rows=JSON.parse(JSON.stringify(rows));if(st.one){if(!rows.length)return st.maybe?{data:null,error:null}:{data:null,error:{message:'no rows'}};return {data:rows[0],error:null}}return {data:rows,count,error:null}}
const storage={from:b=>({upload:async(p,buf)=>{(global.__FILES||(global.__FILES={}))[p]=buf.length;return {error:null}},getPublicUrl:p=>({data:{publicUrl:'https://cdn.test/'+p}})})};
module.exports={createClient:()=>({from:q,storage})};
