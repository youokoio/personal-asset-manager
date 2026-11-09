const CACHE='pam-shell-v0.6.1-alpha2-data-safety';
const FILES=['./','./index.html','./styles.css','./app.js','./history-core.js','./store-core.js','./finance-core.js','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:'reload'})))));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',event=>{
 const u=new URL(event.request.url);
 if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
 event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{
   if(res.ok&&u.origin===self.location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
   return res;
 }).catch(()=>caches.match('./index.html'))));
});
