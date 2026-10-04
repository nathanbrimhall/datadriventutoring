import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { openStore } from './lib/store.mjs';
import { createAPI } from './lib/api.mjs';
import { hash, check } from './lib/domain.mjs';

const project = fileURLToPath(new URL('.',import.meta.url));
export function createApp({ dataDir = resolve(project,process.env.DATA_DIR||'.data'), env = process.env, fetchImpl = fetch } = {}) {
  const store=openStore(dataDir);
  const api=createAPI(store,{env,fetchImpl});
  const limits=new Map();
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{
      res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify(value));
    };
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const port=server.address()?.port||3000;
      const origin=env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : 'http://localhost:'+port;
      const url=new URL(req.url,origin),path=url.pathname;
      if(path.startsWith('/api/')) {
        check(req.url.length<=4096,'Request URL is too long.',414);
        const cookie=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('baseline='))?.slice(9);
        const session=cookie?store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(cookie),Date.now()):undefined;
        if(!['GET','HEAD'].includes(req.method)) {
          check(!req.headers.origin||req.headers.origin===origin,'This request came from a different site.',403);
          check(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),'Cross-site requests are not accepted.',403);
          check(req.headers['content-type']?.startsWith('application/json'),'Use a JSON request body.',415);
          const now=Date.now(),key=path==='/api/session'?'login:'+req.socket.remoteAddress:'write:'+(session?.hash||req.socket.remoteAddress);
          for(const [k,v] of limits) if(v.until<now) limits.delete(k);
          const limit=limits.get(key)||{count:0,until:now+60000}; limit.count++;limits.set(key,limit);
          check(limit.count<=(path==='/api/session'?30:120),'Too many requests. Please wait a minute.',429);
        }
        let body={};
        if(!['GET','HEAD'].includes(req.method)) {
          let raw='',size=0;
          for await(const chunk of req) {size+=chunk.length;check(size<=2_000_000,'The request is too large.',413);raw+=chunk;}
          try { body=JSON.parse(raw||'{}'); } catch { check(false,'The request contains invalid JSON.'); }
          check(body&&typeof body==='object'&&!Array.isArray(body),'Use a JSON object.');
        }
        return await api({req,res,path,url,session,body,send,origin});
      }
      check(['GET','HEAD'].includes(req.method),'Method not allowed.',405);
      const files={'/':'index.html','/math-init.js':'math-init.js','/assignment-builder.js':'assignment-builder.js','/app.js':'app.js','/views.js':'views.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
      if(path==='/vendor/mathlive.min.mjs'||/^\/vendor\/fonts\/[a-zA-Z0-9_.-]+\.woff2$/.test(path)) {
        const file=path==='/vendor/mathlive.min.mjs'?'mathlive.min.mjs':'fonts/'+path.split('/').pop();
        res.setHeader('Content-Type',file.endsWith('.woff2')?'font/woff2':'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control','public, max-age=86400');
        return res.end(readFileSync(join(project,'node_modules','mathlive',file)));
      }
      const file=files[path];check(file,'Page not found.',404);
      const types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
      res.setHeader('Content-Type',types[file.split('.').pop()]+'; charset=utf-8');
      res.end(req.method==='HEAD'?undefined:readFileSync(join(project,'public',file)));
    } catch(error) {
      if(!error.status) console.error('Request failed:',error.message);
      if(!res.headersSent) send(error.status||500,{error:error.status?error.message:'Something went wrong. Please try again.'});
      else res.end();
    }
  });
  server.requestTimeout=60000;
  server.headersTimeout=15000;
  return {server,store};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server,store}=createApp();
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  const directory=resolve(project,process.env.DATA_DIR||'.data');
  server.listen(port,host,()=>{
    const base=process.env.PUBLIC_URL||'http://localhost:'+port;
    if(store.bootstrapToken) {
      writeFileSync(join(directory,'tutor-access.txt'),base+'/#access='+store.bootstrapToken+'\n',{mode:0o600});
    }
    console.log('ProgressPoint is running at '+base);
    console.log('First tutor link: '+join(directory,'tutor-access.txt')+' (private; keep it on this server).');
    console.log('For public hosting, set PUBLIC_URL to your HTTPS origin and use persistent storage.');
  });
  const stop=()=>server.close(()=>{store.db.close();process.exit(0);});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
