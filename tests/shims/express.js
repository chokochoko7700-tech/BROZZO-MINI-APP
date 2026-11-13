// Minimal express-ga mos test shimi (faqat server.js ishlatadigan qismlar)
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
function readBody(req){return new Promise(r=>{if(req._body!==undefined)return r(req._body);const c=[];req.on('data',d=>c.push(d));req.on('end',()=>{req._body=Buffer.concat(c);r(req._body)})})}
function parseSize(s){if(typeof s==='number')return s;const m=/^(\d+)(kb|mb)?$/i.exec(s||'100kb');return +m[1]*(m[2]?.toLowerCase()==='mb'?1048576:1024)}
function express(){
  const stack=[];
  const app=(req,res)=>handle(req,res);
  const add=(method,p,fns)=>{fns=fns.flat(Infinity);const paths=[].concat(p);stack.push({method,paths,fns})};
  app.use=(...a)=>{if(typeof a[0]==='string')add('USE',a[0],a.slice(1));else add('USE',null,a)};
  for(const m of ['get','post','put','patch','delete','all'])app[m]=(p,...f)=>add(m.toUpperCase(),p,f);
  function match(pattern,pathname){if(pattern==null)return {};const keys=[];const re=new RegExp('^'+pattern.replace(/:(\w+)/g,(_,k)=>{keys.push(k);return '([^/]+)'})+'$');const m=re.exec(pathname);if(!m)return null;const o={};keys.forEach((k,i)=>o[k]=decodeURIComponent(m[i+1]));return o}
  async function handle(req,res){
    const u=url.parse(req.url,true);req.path=u.pathname;req.query=u.query;req.get=h=>req.headers[h.toLowerCase()];
    res.status=c=>{res.statusCode=c;return res};res.json=o=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(o))};
    res.type=t=>{res.setHeader('Content-Type',t.includes('/')?t:'text/'+t);return res};
    res.send=b=>{if(typeof b==='object'&&!Buffer.isBuffer(b))return res.json(b);if(!res.getHeader('Content-Type'))res.setHeader('Content-Type','text/html');res.end(b)};
    res.sendStatus=c=>{res.statusCode=c;res.end(String(c))};
    const layers=stack.filter(l=>{if(l.method!=='USE'&&l.method!=='ALL'&&l.method!==req.method)return false;if(l.method==='USE')return l.paths[0]==null||req.path.startsWith(l.paths[0]);return l.paths.some(p=>{const m=match(p,req.path);if(m){l._params=m;return true}return false})});
    let i=0,j=0;
    const next=async(err)=>{if(err){res.statusCode=500;return res.end('err')}
      while(i<layers.length){const l=layers[i];if(j<l.fns.length){const f=l.fns[j++];req.params=l._params||{};try{return await f(req,res,next)}catch(e){console.error(e);res.statusCode=500;return res.end('err')}}i++;j=0}
      res.statusCode=404;res.end('not found')};
    next();
  }
  app.disable=()=>{};app.set=()=>{};app.listen=(port,cb)=>{const s=http.createServer(app);s.listen(port,cb);app.server=s;return s};
  return app;
}
express.json=(o={})=>async(req,res,next)=>{if(!/json/.test(req.headers['content-type']||''))return next();const b=await readBody(req);if(b.length>parseSize(o.limit)){res.statusCode=413;return res.end('too large')}try{req.body=b.length?JSON.parse(b):{}}catch{res.statusCode=400;return res.end('bad json')}next()};
express.raw=(o={})=>async(req,res,next)=>{if(req.body!==undefined&&!Buffer.isBuffer(req.body))return next();const b=await readBody(req);if(b.length>parseSize(o.limit)){res.statusCode=413;return res.end('too large')}req.body=b;next()};
express.static=(dir,o={})=>(req,res,next)=>{if(req.method!=='GET')return next();const f=path.join(path.resolve(dir),path.normalize(decodeURIComponent(req.path)));if(!f.startsWith(path.resolve(dir))||!fs.existsSync(f)||fs.statSync(f).isDirectory())return next();o.setHeaders?.(res,f);res.end(fs.readFileSync(f))};
module.exports=express;
