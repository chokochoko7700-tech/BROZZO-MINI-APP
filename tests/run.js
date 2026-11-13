const crypto=require('crypto'),fs=require('fs'),path=require('path');
// Ishga tushirish: node tests/run.js  (internet va paketlar shart emas — express/Supabase o'rnini bosuvchilar ishlatiladi)
const Module=require('module');const SH=path.join(__dirname,'shims');const MAP={express:'express.js',compression:'compression.js','@supabase/supabase-js':'supabase.js'};
const orig=Module._resolveFilename;Module._resolveFilename=function(r,...a){return MAP[r]?path.join(SH,MAP[r]):orig.call(this,r,...a)};
const APP=path.join(__dirname,'..');process.chdir(APP);
const TOKEN='123456:TEST_TOKEN';Object.assign(process.env,{BOT_TOKEN:TOKEN,SUPABASE_URL:'x',SUPABASE_SERVICE_KEY:'x',ADMIN_ID:'777',PORT:'8899',PUBLIC_URL:'https://brozzo.test',RENDER_GIT_COMMIT:'abcdef1234'});
const F=global.fetch, TG=[];
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
global.fetch=async(u,o={})=>{u=String(u);
 if(u.startsWith('http://127.0.0.1'))return F(u,o);
 if(u.includes('api.telegram.org')){TG.push({m:u.split('/').pop(),b:JSON.parse(o.body||'{}')});return J({ok:true,result:{}})}
 if(u.includes('iconify'))return J({icons:{}});
 throw new Error('network blocked: '+u)};
// boshlang'ich baza
const DB=require('@supabase/supabase-js')&&global.__DB;
DB.categories.push({id:1,name:'Chegirma',sort:1},{id:2,name:'Kurtka',sort:2});
DB.products.push({id:7,name:'Kurtka Demo',price:1000000,category_id:2,images:['https://x/a.jpg'],image:'https://x/a.jpg',sizes:['M','L'],active:true,draft:false,sold_out:false,source:'manual',created_at:'2026-01-01'},
 {id:8,name:'Sotilgan',price:5,images:[],sizes:[],active:true,draft:false,sold_out:true,source:'manual',created_at:'2026-01-01'});
require(APP+'/server.js');
const B='http://127.0.0.1:8899';
function initData(user,age=0,bad=false){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),query_id:'q',user:JSON.stringify(user)});
 const str=[...p.entries()].map(([k,v])=>`${k}=${v}`).sort().join('\n');const key=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
 p.set('hash',bad?'0'.repeat(64):crypto.createHmac('sha256',key).update(str).digest('hex'));return p.toString()}
const ADMIN=initData({id:777,first_name:'Owner'}),USER=initData({id:555,first_name:'Ali',username:'ali'}),USER2=initData({id:556,first_name:'Vali'});
const call=async(m,p,body,id=ADMIN,h={})=>{const r=await F(B+p,{method:m,headers:{'content-type':'application/json',...(id?{'x-init-data':id}:{}),...h},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {s:r.status,j,h:r.headers}};
let pass=0,fail=0;const ok=(c,n,extra='')=>{if(c){pass++;console.log('  ✅',n)}else{fail++;console.log('  ❌',n,extra)}};
const one=async(m,p,body,h={})=>{const r=await F(B+p,{method:m,headers:h,body});return {s:r.status,t:await r.text(),h:r.headers}};
(async()=>{await new Promise(r=>setTimeout(r,400));
console.log('\n== 1. XAVFSIZLIK ==');
ok((await call('GET','/api/admin/orders',null,null)).s===401,'Kirishsiz admin API → 401');
ok((await call('GET','/api/admin/orders',null,initData({id:777},0,true))).s===401,'Soxta imzo (hash) → 401');
ok((await call('GET','/api/admin/orders',null,initData({id:777},90000))).s===401,'Muddati o\'tgan sessiya (25 soat) → 401');
for(const p of ['/api/admin/orders','/api/admin/settings','/api/admin/stats','/api/admin/broadcasts'])ok((await call('GET',p,null,USER)).s===403,`Oddiy mijoz ${p} → 403`);
ok((await call('POST','/api/admin/broadcast',{text:'spam'},USER)).s===403,'Mijoz rassilka yubora olmaydi → 403');
ok((await call('DELETE','/api/admin/products/7',null,USER)).s===403,"Mijoz mahsulot o'chira olmaydi → 403");
let r=await call('POST','/api/admin/upload',{data:'data:image/svg+xml;base64,PHN2Zy8+'});ok(r.s===400,'SVG (XSS xavfi) rasm sifatida qabul qilinmaydi');
r=await call('POST','/api/admin/upload',{data:'data:text/html;base64,PGh0bWw+'});ok(r.s===400,'HTML fayl yuklab bo\'lmaydi');
const png='data:image/webp;base64,'+Buffer.from('RIFF0000WEBPVP8 ').toString('base64');
r=await call('POST','/api/admin/upload',{data:png,thumb:png});ok(r.s===200&&/-x\.webp$/.test(r.j.url)&&Object.keys(global.__FILES).some(k=>k.endsWith('-x_t.webp')),'Rasm yuklanganda kichik nusxa (480px) ham saqlanadi — trafik tejaladi',JSON.stringify(r.j));
ok((await one('GET','/..%2fserver.js')).s===404,'Server kodini o\'qib bo\'lmaydi (path traversal)');
ok((await one('GET','/lib/sync.js')).s===404,'lib/ fayllari ochiq emas');
r=await one('GET','/health');ok(r.h.get('x-content-type-options')==='nosniff','Xavfsizlik sarlavhalari bor');
const SECRET=crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0,32);
ok((await one('POST','/webhook/wrong','{}',{'content-type':'application/json'})).s===404,"Noto'g'ri webhook manzili → 404");
ok((await one('POST','/webhook/'+SECRET,'{}',{'content-type':'application/json'})).s===403,"Webhook maxfiy kalitsiz → 403 (soxta Telegram xabari)");
ok((await one('POST','/webhook/'+SECRET,'{}',{'content-type':'application/json','x-telegram-bot-api-secret-token':SECRET})).s===200,'Haqiqiy Telegram webhook → 200');

console.log('\n== 2. BUYURTMA HIMOYASI ==');
r=await call('POST','/api/orders',{name:'Ali',phone:'+998901234567',delivery:'pickup',agree:true,items:[{id:7,qty:1,size:'M',price:1}]},USER);
ok(r.s===200&&r.j.total===1000000,'Narxni soxtalashtirib bo\'lmaydi (server o\'zi hisoblaydi)',JSON.stringify(r.j));
r=await call('POST','/api/orders',{name:'Ali',phone:'+998901234567',delivery:'pickup',agree:true,items:[{id:8,qty:1}]},USER);ok(r.s===400,'Sotuvda yo\'q tovarni buyurtma qilib bo\'lmaydi');
r=await call('POST','/api/orders',{name:'Ali',phone:'+998901234567',delivery:'pickup',agree:false,items:[{id:7,qty:1}]},USER);ok(r.s===400,'Rozilik belgilanmasa buyurtma qabul qilinmaydi');
r=await call('POST','/api/orders',{name:'Ali',phone:'<script>',delivery:'pickup',agree:true,items:[{id:7,qty:1}]},USER);ok(r.s===400,"Noto'g'ri telefon rad etiladi");
r=await call('POST','/api/orders',{name:'Ali',phone:'+998901234567',delivery:'delivery',agree:true,items:[{id:7,qty:1}]},USER);ok(r.s===400,'Yetkazishda manzilsiz buyurtma rad etiladi');
let codes=[];for(let i=0;i<7;i++)codes.push((await call('POST','/api/orders',{name:'Spam',phone:'+998901112233',delivery:'pickup',agree:true,items:[{id:7,qty:1}]},USER2)).s);
ok(codes.slice(0,6).every(c=>c===200)&&codes[6]===429,'Spam himoyasi: 10 daqiqada 6 tadan ortiq buyurtma → 429',codes.join(','));
const tgOrder=TG.find(x=>x.m==='sendMessage'&&String(x.b.text).includes('Yangi buyurtma'));ok(tgOrder&&!tgOrder.b.parse_mode,'Adminga Telegram xabari keldi (HTML in\'ektsiyasiz, oddiy matn)');

console.log('\n== 3. QOLDIQ VA BEKOR QILISH ==');
DB.products.push({id:60,name:'Shim klassik',price:450000,images:['https://x/s.jpg'],image:'https://x/s.jpg',sizes:['48'],stock:{'48':5,'50':0},qty:5,active:true,draft:false,sold_out:false,source:'manual',created_at:'2026-01-02'});const shim={id:60};
const U3=initData({id:901,first_name:'K'});
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:6,size:'48'}]},U3);ok(r.s===409&&/5 ta qoldi/.test(r.j.error),'Qoldiqdan ko\'p so\'ralsa: "faqat 5 ta qoldi"',JSON.stringify(r.j));
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:1,size:'50'}]},U3);ok(r.s===409&&/tugab/.test(r.j.error),'Tugagan o\'lcham: "tugab qoldi"');
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:5,size:'48'}]},U3);const oid=r.j.id;await new Promise(r=>setTimeout(r,100));
let sp=DB.products.find(p=>p.id===shim.id);ok(sp.qty===0&&sp.sold_out===true,'Oxirgi 5 tasi sotildi → avtomatik "Sotuvda yo\'q"');
await call('PATCH','/api/admin/orders/'+oid,{status:'cancel'});await new Promise(r=>setTimeout(r,100));
sp=DB.products.find(p=>p.id===shim.id);ok(sp.qty===5&&sp.sold_out===false&&sp.sizes.includes('48'),'Buyurtma bekor qilindi → qoldiq qaytdi, yana sotuvda');
ok(TG.some(x=>x.b.chat_id===901&&/bekor/.test(x.b.text||'')),'Mijozga "bekor qilindi" xabari ketdi');

ok((await one('GET','/health')).s===200,'Server ishlashda davom etmoqda');

console.log(`\nNATIJA: ${pass} ta o'tdi, ${fail} ta xato`);process.exit(fail?1:0);
})().catch(e=>{console.error('TEST YIQILDI',e);process.exit(2)});
