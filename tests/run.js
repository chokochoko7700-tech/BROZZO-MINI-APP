const crypto=require('crypto'),fs=require('fs'),path=require('path');
// Ishga tushirish: node tests/run.js  (internet va paketlar shart emas — express/Supabase o'rnini bosuvchilar ishlatiladi)
const Module=require('module');const SH=path.join(__dirname,'shims');const MAP={express:'express.js',compression:'compression.js','@supabase/supabase-js':'supabase.js'};
const orig=Module._resolveFilename;Module._resolveFilename=function(r,...a){return MAP[r]?path.join(SH,MAP[r]):orig.call(this,r,...a)};
const APP=path.join(__dirname,'..');process.chdir(APP);const DATA=path.join(__dirname,'data');
const TOKEN='123456:TEST_TOKEN';Object.assign(process.env,{BOT_TOKEN:TOKEN,SUPABASE_URL:'x',SUPABASE_SERVICE_KEY:'x',ADMIN_ID:'777',PORT:'8899',PUBLIC_URL:'https://brozzo.test',RENDER_GIT_COMMIT:'abcdef1234'});
const F=global.fetch, TG=[], BZ={calls:0,r429:1};
const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
// BILLZ hujjatidagi formatdagi namunaviy tovarlar (250 ta variant)
const BILLZ_PRODUCTS=[];for(let i=0;i<80;i++)for(const sz of ['48','50','52'])BILLZ_PRODUCTS.push({id:`v${i}-${sz}`,parent_id:`P${i}`,name:`Kurtka model ${i} ${sz}`,sku:`BZ-${i}`,barcode:`47800${i}${sz}`,categories:[{id:'c',name:i%2?'Kurtka':'Kostyum',parent_id:null}],
 shop_prices:[{shop_id:'s1',shop_name:'Brozzo',retail_price:1000000+i*1000,promo_price:i%5===0?800000:0},{shop_id:'s2',shop_name:'Ombor',retail_price:999,promo_price:0}],
 shop_measurement_values:[{shop_id:'s1',shop_name:'Brozzo',active_measurement_value:sz==='52'?0:2},{shop_id:'s2',shop_name:'Ombor',active_measurement_value:10}],
 product_attributes:[{attribute_id:'a',attribute_value_id:'b',attribute_name:'Размер',attribute_value:sz}],photos:i<3?[{photo_url:`https://cdn.billz.test/${i}.jpg`,sequence:1,is_main:true}]:[]});
for(let i=0;i<10;i++)BILLZ_PRODUCTS.push({id:`n${i}`,parent_id:null,name:`Atir ${i}`,sku:`AT-${i}`,categories:[{name:'Atirlar'}],shop_prices:[{shop_id:'s1',retail_price:300000}],shop_measurement_values:[{shop_id:'s1',active_measurement_value:i}],product_attributes:[]});
global.fetch=async(u,o={})=>{u=String(u);
 if(u.startsWith('http://127.0.0.1'))return F(u,o);
 if(u.includes('api.telegram.org')){TG.push({m:u.split('/').pop(),b:JSON.parse(o.body||'{}')});return J({ok:true,result:{}})}
 if(u.includes('iconify'))return J({icons:{}});
 if(u.includes('api-admin.billz.ai')){BZ.calls++;
   if(o.headers?.['platform-id']!=='7d4a4c38-dd84-4902-b744-0488b80a4c01')return J({error:'platform'},403);
   if(u.endsWith('/v1/auth/login')){const b=JSON.parse(o.body);return b.secret_token==='good-secret'?J({code:200,data:{access_token:'AT1',refresh_token:'r',expires_in:'3600'}}):J({code:403,error:'bad'},403)}
   if(o.headers?.Authorization!=='Bearer AT1')return J({},401);
   if(u.includes('/v1/shop'))return J({shops:[{id:'s1',name:'Brozzo Shahrisabz'},{id:'s2',name:'Ombor'}]});
   if(u.includes('/v2/products')){if(BZ.r429-->0)return J({},429);const q=new URL(u).searchParams;const lim=+q.get('limit'),pg=+q.get('page');return J({count:BILLZ_PRODUCTS.length,products:BILLZ_PRODUCTS.slice((pg-1)*lim,pg*lim)})}
 }
 if(u==='https://api.yespos.test/v1/products'){if(o.headers?.Authorization!=='Bearer ys-key')return J({},401);
   return J({success:true,data:[{id:1,name:'Shim klassik',barcode:'111',price:450000,count:5,category:{name:'Shim'},image_url:'https://img.yespos.test/1.jpg',size:'48'},{id:2,name:'Shim klassik',barcode:'112',price:450000,count:0,category:{name:'Shim'},size:'50'},{id:3,name:"Ko'ylak Slim",price:'280000',count:'3',category:{name:"Ko'ylak"}}]})}
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
const basic='Basic '+Buffer.from('brozzo:secret-pass').toString('base64');
(async()=>{await new Promise(r=>setTimeout(r,400));
console.log('\n== 1. XAVFSIZLIK ==');
ok((await call('GET','/api/admin/orders',null,null)).s===401,'Kirishsiz admin API → 401');
ok((await call('GET','/api/admin/orders',null,initData({id:777},0,true))).s===401,'Soxta imzo (hash) → 401');
ok((await call('GET','/api/admin/orders',null,initData({id:777},90000))).s===401,'Muddati o\'tgan sessiya (25 soat) → 401');
for(const p of ['/api/admin/orders','/api/admin/settings','/api/admin/integration','/api/admin/stats','/api/admin/drafts'])ok((await call('GET',p,null,USER)).s===403,`Oddiy mijoz ${p} → 403`);
ok((await call('POST','/api/admin/broadcast',{text:'spam'},USER)).s===403,'Mijoz rassilka yubora olmaydi → 403');
ok((await call('DELETE','/api/admin/products/7',null,USER)).s===403,"Mijoz mahsulot o'chira olmaydi → 403");
ok((await call('POST','/api/admin/import',{data:'eA=='},USER)).s===403,'Mijoz Excel yuklay olmaydi → 403');
let r=await call('POST','/api/admin/upload',{data:'data:image/svg+xml;base64,PHN2Zy8+'});ok(r.s===400,'SVG (XSS xavfi) rasm sifatida qabul qilinmaydi');
r=await call('POST','/api/admin/upload',{data:'data:text/html;base64,PGh0bWw+'});ok(r.s===400,'HTML fayl yuklab bo\'lmaydi');
const png='data:image/webp;base64,'+Buffer.from('RIFF0000WEBPVP8 ').toString('base64');
r=await call('POST','/api/admin/upload',{data:png,thumb:png});ok(r.s===200&&/-x\.webp$/.test(r.j.url)&&Object.keys(global.__FILES).some(k=>k.endsWith('-x_t.webp')),'Rasm yuklanganda kichik nusxa (480px) ham saqlanadi — trafik tejaladi',JSON.stringify(r.j));
for(let i=1;i<=400;i++)DB.sync_log.push({id:i,source:'x',ok:true});
for(let i=0;i<50;i++)await call('POST','/api/admin/import',{data:Buffer.from('Nomi;Narx;Qoldiq\nTest;1000;1').toString('base64'),name:'t.csv',dry:false});
await new Promise(r=>setTimeout(r,100));DB.products=DB.products.filter(p=>p.name!=='Test');global.__DB.products=DB.products;
ok(DB.sync_log.length<=350,'Sinxronlash tarixi cheksiz o\'smaydi (eski yozuvlar tozalanadi): '+DB.sync_log.length);
ok((await one('GET','/..%2fserver.js')).s===404,'Server kodini o\'qib bo\'lmaydi (path traversal)');
ok((await one('GET','/lib/integration.js')).s===404,'lib/ fayllari ochiq emas');
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

console.log('\n== 3. EXCEL IMPORT (BILLZ/1C ruscha eksport fayli) ==');
await call('PUT','/api/admin/integration',{type:'excel'});
const xb=fs.readFileSync(DATA+'/billz_export.xlsx').toString('base64');
r=await call('POST','/api/admin/import',{data:'data:application/octet-stream;base64,'+xb,name:'billz_export.xlsx',dry:true});
ok(r.s===200&&r.j.added===3&&r.j.skipped===1,'Oldindan ko\'rish: 3 yangi, 1 o\'tkazildi (qoldiq 0)',JSON.stringify(r.j));
ok(DB.products.length===2,'Oldindan ko\'rishda baza o\'zgarmadi');
r=await call('POST','/api/admin/import',{data:xb,name:'billz_export.xlsx'});
const ks=DB.products.find(p=>p.sku==='KS-01');
ok(ks&&ks.qty===3&&JSON.stringify(ks.stock)==='{"48":2,"50":1}'&&ks.draft===true,'Kostyum: 2 o\'lcham bitta tovarga birlashdi, qoldiq 3, rasm kutmoqda',JSON.stringify(ks));
ok(DB.products.find(p=>p.sku==='TF-03')?.price===890000,'"890 000" ko\'rinishidagi narx to\'g\'ri o\'qildi');
ok(DB.categories.some(c=>c.name==='Костюмы'),'Yangi kategoriya yaratildi');
let cat=(await call('GET','/api/catalog',null,null)).j;ok(!cat.products.some(p=>p.sku==='KS-01'),'Rasmsiz yangi tovar mijozlarga ko\'rinmaydi');
ok(!cat.products.some(p=>'external_id' in p),'Katalogda ichki ID\'lar oshkor qilinmaydi');
r=await call('POST','/api/admin/import',{data:Buffer.from('foo;bar\n1;2').toString('base64'),name:'x.csv'});ok(r.s===400&&/Sarlavha/.test(r.j.error),'Noto\'g\'ri fayl → tushunarli xato');
r=await call('POST','/api/admin/import',{data:Buffer.from('xx').toString('base64'),name:'old.xls'});ok(r.s===400&&/xlsx/.test(r.j.error),'Eski .xls → "xlsx qilib saqlang" degan xabar');
const csv=Buffer.from(new TextEncoder().encode('')); // cp1251 CSV
const cp=Buffer.from([...'Наименование;Цена;Остаток;Размер\nРубашка белая;250000;2;S\n'].map(ch=>{const c=ch.charCodeAt(0);return c>=0x410&&c<=0x44f?c-0x350:c}));
r=await call('POST','/api/admin/import',{data:cp.toString('base64'),name:'kassa.csv'});ok(r.s===200&&DB.products.some(p=>p.name==='Рубашка белая'),'Windows-1251 kodirovkali CSV (eski kassa dasturlari) o\'qildi',JSON.stringify(r.j));

console.log('\n== 4. 1C (CommerceML 2.08, УТ 11 namunasi) ==');
ok(/failure/.test((await one('GET','/1c_exchange?type=catalog&mode=checkauth',null,{authorization:basic})).t),'1C o\'chiq bo\'lsa ulanish rad etiladi');
await call('PUT','/api/admin/integration',{type:'onec',onec_login:'brozzo',onec_password:'secret-pass'});
const ig=(await call('GET','/api/admin/integration')).j;ok(ig.onec_url==='https://brozzo.test/1c_exchange','Admin panelda 1C manzili ko\'rsatiladi');
r=await one('GET','/1c_exchange?type=catalog&mode=checkauth',null,{authorization:'Basic '+Buffer.from('brozzo:wrong').toString('base64')});ok(/^failure/.test(r.t),"Noto'g'ri parol → failure");
codes=[];for(let i=0;i<11;i++)codes.push((await one('GET','/1c_exchange?type=catalog&mode=checkauth',null,{authorization:'Basic '+Buffer.from('hacker:'+i).toString('base64'),'x-forwarded-for':'6.6.6.6'})).s);
ok(codes[10]===429,'Parol tanlash (brute-force) 10 urinishdan keyin bloklanadi',codes.join(','));
r=await one('GET','/1c_exchange?type=catalog&mode=checkauth',null,{authorization:basic});const L=r.t.split('\n');
ok(L[0]==='success'&&L[1]==='brozzo1c'&&L[2].length===32,'checkauth → success + cookie',r.t);
const ck={cookie:`${L[1]}=${L[2]}`};
r=await one('GET','/1c_exchange?type=catalog&mode=init',null,ck);ok(/zip=no/.test(r.t)&&/file_limit=/.test(r.t),'init → zip=no, file_limit');
ok(/success/.test((await one('POST','/1c_exchange?type=catalog&mode=file&filename=import_files/7f/7f1c0a2e-1111_img.jpg',fs.readFileSync(DATA+'/img.jpg'),{...ck,'content-type':'application/octet-stream'})).t),'Rasm fayli qabul qilindi');
const imp=fs.readFileSync(DATA+'/import.xml');
ok(/success/.test((await one('POST','/1c_exchange?type=catalog&mode=file&filename=import.xml',imp.subarray(0,1000),ck)).t)&&/success/.test((await one('POST','/1c_exchange?type=catalog&mode=file&filename=import.xml',imp.subarray(1000),ck)).t),'import.xml 2 bo\'lakda yuborildi');
r=await one('GET','/1c_exchange?type=catalog&mode=import&filename=import.xml',null,ck);ok(/^success/.test(r.t),'import.xml qayta ishlandi',r.t);
ok((await one('POST','/1c_exchange?type=catalog&mode=file&filename=offers.xml',fs.readFileSync(DATA+'/offers.xml'),ck)).s===200,'offers.xml yuborildi');
r=await one('GET','/1c_exchange?type=catalog&mode=import&filename=offers.xml',null,ck);ok(/^success/.test(r.t),'offers.xml qayta ishlandi',r.t);
const pf=DB.products.find(p=>p.external_id==='7f1c0a2e-1111-11ee-8a00-005056b1');
ok(pf&&pf.price===1250000,'Chakana narx ("Розничная") tanlandi, zakupka emas',pf&&pf.price);
ok(pf&&JSON.stringify(pf.stock)==='{"48":3,"50":0,"52":2}'&&pf.qty===5&&JSON.stringify(pf.sizes)==='["48","52"]','O\'lchamlar va qoldiqlar: 48→3, 50→0 (yashirin), 52→2',JSON.stringify(pf&&{stock:pf.stock,sizes:pf.sizes}));
ok(pf&&pf.sku==='BRZ-PF-01','1C\'dagi tovar Excel\'dan kelgan shu artikulli tovar bilan birlashdi (dublikat yo\'q)',pf&&pf.source);
const sh=DB.products.find(p=>p.external_id==='8a2d1b3f-2222-11ee-8a00-005056b1');
ok(sh&&sh.price===320000&&sh.qty===4&&sh.barcode==='4780012345678','Ko\'ylak: "320000,00" narx, Остатки/Склад qoldig\'i, shtrix-kod',JSON.stringify(sh&&{p:sh.price,q:sh.qty}));
ok(DB.categories.some(c=>c.name==='Сорочки'),'1C guruhi (windows-1251) to\'g\'ri o\'qildi: "Сорочки"');
ok(Object.keys(global.__FILES||{}).some(k=>k.startsWith('1c/')),'1C rasmi saytga yuklandi');
// buyurtma 1C ga
r=await one('GET','/1c_exchange?type=sale&mode=checkauth',null,{authorization:basic});const ck2={cookie:'brozzo1c='+r.t.split('\n')[2]};
await one('GET','/1c_exchange?type=sale&mode=init',null,ck2);
pf.draft=false;pf.images=['https://x/p.jpg'];global.__DB=DB;
await call('PATCH','/api/admin/products/'+pf.id,{name:pf.name,price:pf.price,images:['https://x/p.jpg'],sizes:pf.sizes,publish:true,sku:pf.sku});
r=await call('POST','/api/orders',{name:'Jasur & <Co>',phone:'+998 90 111 22 33',delivery:'delivery',address:'Shahrisabz, Ipak yo\'li 5',agree:true,items:[{id:pf.id,qty:1,size:'48'}]},initData({id:900,first_name:'J'}));
ok(r.s===200,'1C tovaridan buyurtma berildi',JSON.stringify(r.j));
r=await one('GET','/1c_exchange?type=sale&mode=query',null,ck2);
ok(r.t.includes('<Ид>7f1c0a2e-1111-11ee-8a00-005056b1#c-48</Ид>'),'Buyurtma 1C\'ga to\'g\'ri xarakteristika (o\'lcham 48) ID bilan ketdi');
ok(r.t.includes('Jasur &amp; &lt;Co&gt;'),'XML in\'ektsiyadan himoya (maxsus belgilar ekranlanadi)');
ok((await one('GET','/1c_exchange?type=sale&mode=success',null,ck2)).t.startsWith('success'),'success → buyurtmalar "yuborildi" deb belgilandi');
r=await one('GET','/1c_exchange?type=sale&mode=query',null,ck2);ok(!r.t.includes('<Документ>'),'Ikkinchi marta bir xil buyurtma yuborilmaydi');
ok(pf&&DB.products.find(p=>p.id===pf.id).stock['48']===2,'Buyurtmadan keyin 48-o\'lcham qoldig\'i 3→2');

console.log('\n== 5. BILLZ API ==');
await call('PUT','/api/admin/integration',{type:'billz',billz_token:'wrong'});
TG.length=0;r=await call('POST','/api/admin/integration/run');ok(r.s===400&&/BILLZ/.test(r.j.error),'Noto\'g\'ri BILLZ kaliti → tushunarli xato',JSON.stringify(r.j));
ok(TG.some(x=>/Integratsiya xatosi/.test(x.b.text||'')),'Xato bo\'lsa adminga Telegram\'da ogohlantirish keldi');
await call('PUT','/api/admin/integration',{type:'billz',billz_token:'good-secret'});
let g=(await call('GET','/api/admin/integration')).j;ok(g.cfg.billz_token==='••••cret','BILLZ kaliti admin panelda ham yashirilgan ('+g.cfg.billz_token+')');
await call('PUT','/api/admin/integration',{...g.cfg});g=(await call('GET','/api/admin/integration')).j;
r=await call('POST','/api/admin/integration/test');ok(r.s===200&&r.j.shops?.length===2,'Ulanishni tekshirish: 2 ta do\'kon topildi (yashirin kalit o\'zgarmadi)',JSON.stringify(r.j));
await call('PUT','/api/admin/integration',{...g.cfg,billz_shop_id:'s1'});
const t0=Date.now();r=await call('POST','/api/admin/integration/run');
ok(r.s===200&&r.j.added===89&&r.j.skipped===1,`250 ta variant → 90 guruh: 89 qo'shildi, 1 tasi qoldig'i 0 (o'tkazildi) (sahifalash, 429 qayta urinish) — ${Date.now()-t0}ms`,JSON.stringify(r.j));
const b0=DB.products.find(p=>p.external_id==='P0');
ok(b0&&b0.name==='Kurtka model 0'&&JSON.stringify(b0.stock)==='{"48":2,"50":2,"52":0}'&&b0.qty===4,'Variantlar o\'lcham bo\'yicha birlashdi, nomdan o\'lcham olib tashlandi',JSON.stringify(b0&&{n:b0.name,s:b0.stock}));
ok(b0&&b0.price===800000&&b0.old_price===1000000,'BILLZ aksiyasi: 800 000 (eski narx 1 000 000)');
ok(b0&&b0.draft===true&&DB.products.find(p=>p.external_id==='P1').draft===true,'auto_publish o\'chiq: yangi tovarlar rasm kutmoqda');
ok(!DB.products.some(p=>p.external_id==='n0'),'Qoldig\'i 0 bo\'lgan yangi tovar (Atir 0) qo\'shilmadi');
ok(DB.products.find(p=>p.external_id==='n5')?.qty===5,'Faqat tanlangan filial qoldig\'i olindi (ombor 10 ta qo\'shilmadi)');
BILLZ_PRODUCTS.splice(0,3);r=await call('POST','/api/admin/integration/run');
ok(DB.products.find(p=>p.external_id==='P0').sold_out===true,'BILLZ\'dan o\'chirilgan tovar → "Sotuvda yo\'q"',JSON.stringify(r.j));

console.log('\n== 6. YesPOS (API rejimi) ==');
await call('PUT','/api/admin/integration',{type:'yespos',yespos_mode:'api',api_url:'http://evil.test',api_token:'ys-key'}).then(x=>ok(x.s===400,'https bo\'lmagan API manzili rad etiladi'));
await call('PUT','/api/admin/integration',{type:'yespos',yespos_mode:'api',api_url:'https://api.yespos.test/v1/products',api_token:'ys-key',auto_publish:true});
r=await call('POST','/api/admin/integration/run');ok(r.s===200&&r.j.added===2,'YesPOS JSON: 2 ta tovar (shim 2 o\'lchamda birlashdi)',JSON.stringify(r.j));
const shim=DB.products.find(p=>p.source==='yespos'&&p.name==='Shim klassik');
ok(shim&&shim.draft===false&&shim.image==='https://img.yespos.test/1.jpg'&&JSON.stringify(shim.stock)==='{"48":5,"50":0}','Rasmi bor tovar darhol chiqdi (auto_publish), o\'lchamlar to\'g\'ri',JSON.stringify(shim&&{d:shim.draft,s:shim.stock}));
cat=(await call('GET','/api/catalog',null,null)).j;ok(cat.products.some(p=>p.name==='Shim klassik'),'Mijoz katalogida darhol ko\'rindi (kesh yangilandi)');

console.log('\n== 7. QOLDIQ VA BEKOR QILISH ==');
const U3=initData({id:901,first_name:'K'});
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:6,size:'48'}]},U3);ok(r.s===409&&/5 ta qoldi/.test(r.j.error),'Qoldiqdan ko\'p so\'ralsa: "faqat 5 ta qoldi"',JSON.stringify(r.j));
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:1,size:'50'}]},U3);ok(r.s===409&&/tugab/.test(r.j.error),'Tugagan o\'lcham: "tugab qoldi"');
r=await call('POST','/api/orders',{name:'K',phone:'+998901234500',delivery:'pickup',agree:true,items:[{id:shim.id,qty:5,size:'48'}]},U3);const oid=r.j.id;await new Promise(r=>setTimeout(r,100));
let sp=DB.products.find(p=>p.id===shim.id);ok(sp.qty===0&&sp.sold_out===true,'Oxirgi 5 tasi sotildi → avtomatik "Sotuvda yo\'q"');
await call('PATCH','/api/admin/orders/'+oid,{status:'cancel'});await new Promise(r=>setTimeout(r,100));
sp=DB.products.find(p=>p.id===shim.id);ok(sp.qty===5&&sp.sold_out===false&&sp.sizes.includes('48'),'Buyurtma bekor qilindi → qoldiq qaytdi, yana sotuvda');
ok(TG.some(x=>x.b.chat_id===901&&/bekor/.test(x.b.text||'')),'Mijozga "bekor qilindi" xabari ketdi');

console.log('\n== 8. 1C ga noto\'g\'ri/zararli fayllar ==');
await call('PUT','/api/admin/integration',{type:'onec',onec_login:'brozzo',onec_password:'secret-pass'});
r=await one('GET','/1c_exchange?type=catalog&mode=checkauth',null,{authorization:basic});const ck3={cookie:'brozzo1c='+r.t.split('\n')[2]};
await one('POST','/1c_exchange?type=catalog&mode=file&filename=import.xml','<<<buzuq xml &&&',ck3);
r=await one('GET','/1c_exchange?type=catalog&mode=import&filename=import.xml',null,ck3);ok(r.s===200&&!/Server xatosi/.test(r.t),'Buzuq XML server\'ni yiqitmaydi',r.t.slice(0,80));
await one('POST','/1c_exchange?type=catalog&mode=file&filename=../../etc/passwd','x',ck3);ok(!fs.existsSync('/etc/passwdx'),'Fayl nomi orqali diskka yozib bo\'lmaydi (fayllar faqat xotirada)');
ok((await one('GET','/health')).s===200,'Server ishlashda davom etmoqda');

console.log(`\nNATIJA: ${pass} ta o'tdi, ${fail} ta xato`);process.exit(fail?1:0);
})().catch(e=>{console.error('TEST YIQILDI',e);process.exit(2)});
