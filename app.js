'use strict';
const APP_VERSION='0.3.0';
const DB_NAME='pam_local_v2', STORE='state';
const $=id=>document.getElementById(id);
const yen=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP')+'円':'—';
const num=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP'):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
let db, state, editing={type:null,id:null};

const EMPTY={schemaVersion:2,dataType:'personal_asset_manager',exportDate:today(),accounts:[],fxPositions:[],fxTransactions:[],fxSwapRecords:[],holdings:[],balanceSnapshots:[],contributionRecords:[],editHistory:[],importMetadata:{},excelHistoricalDatabase:{},excelSimulationDatabase:{},simulationMetadata:{}};
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbGet(){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbPut(value){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function validateData(d){
 if(!d||typeof d!=='object'||Array.isArray(d))throw Error('JSONの最上位はオブジェクトである必要があります。');
 for(const k of ['accounts','fxPositions','holdings','balanceSnapshots'])if(!Array.isArray(d[k]))throw Error(`${k} が配列ではありません。`);
 const ids=new Set(); for(const a of d.accounts){if(!a||typeof a.accountId!=='string'||!a.accountId)throw Error('口座IDが不正です。');if(ids.has(a.accountId))throw Error('口座IDが重複しています: '+a.accountId);ids.add(a.accountId);}
 const pids=new Set();for(const p of d.fxPositions){if(!p||typeof p.positionId!=='string'||!p.positionId)throw Error('建玉IDが不正です。');if(pids.has(p.positionId))throw Error('建玉IDが重複しています: '+p.positionId);pids.add(p.positionId);if(!Number.isFinite(Number(p.remainingQuantity)))throw Error('建玉残数量が数値ではありません: '+p.positionId);}
 return true;
}
async function save(){state.exportDate=today();await dbPut(state);$('lastSaved').textContent='保存 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});render();}
function logEdit(type,id,action,before,after){state.editHistory=Array.isArray(state.editHistory)?state.editHistory:[];state.editHistory.unshift({historyId:newId('history'),timestamp:new Date().toISOString(),recordType:type,recordId:id,action,before:before?structuredClone(before):null,after:after?structuredClone(after):null});if(state.editHistory.length>2000)state.editHistory.length=2000;}
const typeLabel={account:'口座',position:'FX建玉',snapshot:'残高記録',holding:'保有資産'};
function recordArray(type){return type==='account'?'accounts':type==='position'?'fxPositions':type==='snapshot'?'balanceSnapshots':'holdings';}
function recordKey(type){return type==='account'?'accountId':type==='position'?'positionId':type==='snapshot'?'snapshotId':'holdingId';}
function findRecord(type,id){return state[recordArray(type)].find(x=>String(x[recordKey(type)])===String(id));}
function accountName(id){return state.accounts.find(a=>a.accountId===id)?.accountName||id||'口座未設定';}
function latestSnapshots(){const m=new Map();for(const s of state.balanceSnapshots){const old=m.get(s.accountId);if(!old||String(s.snapshotDate)>String(old.snapshotDate))m.set(s.accountId,s);}return [...m.values()].sort((a,b)=>accountName(a.accountId).localeCompare(accountName(b.accountId),'ja'));}
function render(){
 $('accountCount').textContent=state.accounts.length;$('positionCount').textContent=state.fxPositions.filter(p=>p.status!=='closed').length;$('holdingCount').textContent=state.holdings.length;
 const fxAccounts=state.accounts.filter(a=>a.accountType==='fx');
 $('fxSummary').innerHTML=fxAccounts.map(a=>`<div class="item"><div class="kv"><span>${esc(a.accountName)}</span><b>${state.fxPositions.filter(p=>p.accountId===a.accountId&&p.status!=='closed').length} 建玉</b></div></div>`).join('')||'<p class="muted">FX口座がありません</p>';
 $('balanceSummary').innerHTML=latestSnapshots().map(s=>`<div class="item"><div class="kv"><span>${esc(accountName(s.accountId))}</span><b>${yen(s.netAssetValue??s.evaluationAmount??s.balance)}</b></div><div class="item-sub">${esc(s.snapshotDate||'日付不明')} ・ 評価額/純資産額の項目は元データの定義を確認してください</div></div>`).join('')||'<p class="muted">残高履歴がありません</p>';
 $('accountList').innerHTML=state.accounts.map(a=>`<div class="item"><div class="item-title">${esc(a.accountName)}</div><div class="item-sub">${esc(a.institutionName||'')} ・ ${esc(a.accountType||'')} ・ ${esc(a.accountId)} ・ 確認日 ${esc(a.confirmationDate||'未設定')}</div><div class="item-actions"><button data-edit="account" data-id="${esc(a.accountId)}">編集</button></div></div>`).join('')||'<p class="muted">口座がありません</p>';
 $('positionList').innerHTML=state.fxPositions.map(p=>`<div class="item"><div class="item-title">${esc(p.currencyPair||'通貨ペア未設定')} ${p.side==='buy'?'買':'売'} ・ ${esc(p.status==='closed'?'決済済':'保有中')}</div><div class="item-sub">${esc(accountName(p.accountId))} ・ 新規 ${esc(p.openDate||'不明')} ・ 新規価格 ${esc(p.openPrice??'—')}<br>当初数量 ${num(p.originalQuantity)} ／ 決済数量 ${num(p.closedQuantity)} ／ 残数量 ${num(p.remainingQuantity)}<br>累積スワップ ${yen(p.accumulatedSwap)} ／ 決済損益 ${yen(p.realizedProfitLoss)} ／ 評価損益 ${yen(p.unrealizedProfitLoss)}</div><div class="item-actions"><button data-edit="position" data-id="${esc(p.positionId)}">編集</button></div></div>`).join('')||'<p class="muted">建玉がありません</p>';
 $('snapshotList').innerHTML=state.balanceSnapshots.map((s,i)=>({s,i})).sort((a,b)=>String(b.s.snapshotDate).localeCompare(String(a.s.snapshotDate))).map(({s,i})=>`<div class="item"><div class="item-title">${esc(accountName(s.accountId))} ・ ${esc(s.snapshotDate||'日付不明')}</div><div class="item-sub">残高 ${yen(s.balance)} ／ 評価額 ${yen(s.evaluationAmount)} ／ 純資産額 ${yen(s.netAssetValue)} ／ 必要証拠金 ${yen(s.marginRequirement)}</div><div class="item-actions"><button data-edit="snapshot" data-id="${esc(s.snapshotId||i)}">編集</button></div></div>`).join('')||'<p class="muted">残高履歴がありません</p>';
 $('holdingList').innerHTML=state.holdings.map(h=>`<div class="item"><div class="item-title">${esc(h.productName||'名称未設定')}</div><div class="item-sub">${esc(accountName(h.accountId))} ・ 評価額 ${yen(h.currentEvaluationAmount)}<br>取得額 ${yen(h.acquisitionAmount)} ／ 評価損益 ${yen(h.evaluationProfitLoss)} ・ 確認日 ${esc(h.confirmationDate||'未設定')}</div><div class="item-actions"><button data-edit="holding" data-id="${esc(h.holdingId)}">編集</button></div></div>`).join('')||'<p class="muted">保有資産がありません</p>';
 $('historyCount').textContent=`${(state.editHistory||[]).length}件`;
 $('historyList').innerHTML=(state.editHistory||[]).map(h=>{const date=new Date(h.timestamp).toLocaleString('ja-JP');const payload=h.after||h.before||{};const title=payload.accountName||payload.currencyPair||payload.productName||accountName(payload.accountId)||h.recordId;const detail=h.action==='delete'?'削除':h.action==='create'?'新規保存':h.action==='import'?'データ取り込み':'編集・訂正';return `<div class="item"><div class="item-title">${esc(typeLabel[h.recordType]||h.recordType)}：${esc(title)}</div><div class="item-sub">${esc(date)} ・ ${esc(detail)}<br>${h.before?'変更前の内容あり':'変更前データなし'} ／ ${h.after?'保存後の内容あり':'保存後データなし'}</div><div class="item-actions"><button data-history-view="${esc(h.historyId)}" data-history-side="after" ${h.after?'':'disabled'}>保存後を編集</button>${h.before?`<button data-history-view="${esc(h.historyId)}" data-history-side="before">変更前を編集</button>`:''}</div></div>`;}).join('')||'<p class="muted">まだ保存・訂正履歴はありません。今後の追加・編集・削除から記録されます。</p>';
 $('storageStatus').textContent=`IndexedDBに保存。口座 ${state.accounts.length}件、建玉 ${state.fxPositions.length}件、残高記録 ${state.balanceSnapshots.length}件。`;
}
const fields={
 account:[['accountId','口座ID','text'],['accountName','口座名','text'],['institutionName','金融機関','text'],['accountType','口座種別','select',['fx','bank','nisa','dc','ideco','crypto','other']],['currency','通貨','text'],['confirmationDate','確認日','date']],
 position:[['positionId','建玉ID','text'],['accountId','口座','selectAccounts'],['currencyPair','通貨ペア','text'],['side','売買','select',['buy','sell']],['status','状態','select',['open','closed']],['openDate','新規日','date'],['openPrice','新規価格','number'],['originalQuantity','当初数量','number'],['closedQuantity','決済数量','number'],['remainingQuantity','残数量','number'],['accumulatedSwap','累積スワップ（円）','number'],['realizedProfitLoss','決済損益（円）','number'],['unrealizedProfitLoss','評価損益（円）','number']],
 snapshot:[['accountId','口座','selectAccounts'],['snapshotDate','確認日','date'],['balance','残高（円）','number'],['evaluationAmount','評価額（円）','number'],['unrealizedProfitLoss','評価損益（円）','number'],['marginRequirement','必要証拠金（円）','number'],['netAssetValue','純資産額（円）','number'],['accumulatedSwap','累積スワップ（円）','number'],['pendingWithdrawal','出金依頼額（円）','number']],
 holding:[['holdingId','資産ID','text'],['accountId','口座','selectAccounts'],['productName','商品名','text'],['productCode','商品コード','text'],['holdingQuantity','保有数量','number'],['averageAcquisitionPrice','平均取得単価','number'],['acquisitionAmount','取得額（円）','number'],['currentEvaluationAmount','現在評価額（円）','number'],['evaluationProfitLoss','評価損益（円）','number'],['evaluationProfitLossRate','評価損益率（小数）','number'],['confirmationDate','確認日','date']]
};
function newId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);}
function openEditor(type,id=null,seed=null){
 editing={type,id};let arr=recordArray(type);
 let item;
 if(seed){item=structuredClone(seed);id=seed[recordKey(type)]??id;editing.id=id;}
 else if(id!==null){item=type==='snapshot'?state[arr].find(x=>String(x.snapshotId)===String(id))||state[arr][Number(id)]:state[arr].find(x=>x[fields[type][0][0]]===id);}
 else {item={};for(const f of fields[type])item[f[0]]=f[0].endsWith('Date')||f[0]==='snapshotDate'?today():null;if(type==='account'){item.accountId=newId('account');item.accountType='fx';item.currency='JPY';}if(type==='position'){item.positionId=newId('position');item.status='open';item.side='buy';item.currencyPair='TRY/JPY';item.originalQuantity=0;item.closedQuantity=0;item.remainingQuantity=0;}if(type==='snapshot'){item.snapshotDate=today();item.snapshotId=newId('snapshot');}if(type==='holding')item.holdingId=newId('holding');}
 $('editorTitle').textContent=(id===null?'追加':'編集')+({account:'口座',position:'FX建玉',snapshot:'残高記録',holding:'保有資産'}[type]);
 const root=$('editorFields');root.innerHTML='';
 for(const [key,label,kind,opts] of fields[type]){
  const wrap=document.createElement('div');wrap.className='field';
  const lab=document.createElement('label');lab.textContent=label;lab.htmlFor='f_'+key;wrap.append(lab);
  let el;
  if(kind==='select'||kind==='selectAccounts'){el=document.createElement('select');let values=kind==='selectAccounts'?state.accounts.map(a=>[a.accountId,a.accountName]):opts.map(x=>[x,x]);for(const [v,t] of values){const o=document.createElement('option');o.value=v;o.textContent=t;el.append(o);}}
  else {el=document.createElement('input');el.type=kind;if(kind==='number')el.step='any';}
  el.id='f_'+key;el.name=key;el.value=item[key]??'';if(key==='accountId'&&kind==='selectAccounts'&&!item[key]&&el.options.length)el.value=el.options[0].value;
  if(key==='accountId'&&kind==='selectAccounts'&&!el.options.length){const o=document.createElement('option');o.value='';o.textContent='口座を先に登録';el.append(o);}
  if(key==='accountId'&&kind==='selectAccounts')wrap.classList.add('full-width');
  wrap.append(el);root.append(wrap);
 }
 $('deleteRecord').classList.toggle('hidden',id===null);
 $('editorDialog').showModal();
}
$('editorForm').addEventListener('submit',async e=>{e.preventDefault();const {type,id}=editing;const arr=type==='account'?'accounts':type==='position'?'fxPositions':type==='snapshot'?'balanceSnapshots':'holdings';const obj={};for(const f of fields[type]){const el=$('f_'+f[0]);if(!el)continue;obj[f[0]]=el.value===''?null:(el.type==='number'?Number(el.value):el.value);}
 if(type==='position'){if(obj.remainingQuantity===null)obj.remainingQuantity=0;if(obj.originalQuantity===null)obj.originalQuantity=0;if(obj.closedQuantity===null)obj.closedQuantity=0;}
 if(type==='snapshot'){obj.snapshotId=id===null?newId('snapshot'):(findRecord(type,id)?.snapshotId||id);}
 const key=recordKey(type);const existing=id===null?null:findRecord(type,id);
 if(id===null){state[arr].push(obj);logEdit(type,obj[key],'create',null,obj);}
 else if(existing){const merged={...existing,...obj};const idx=state[arr].indexOf(existing);state[arr][idx]=merged;logEdit(type,merged[key],'edit',existing,merged);}
 else {state[arr].push(obj);logEdit(type,obj[key],'restore',null,obj);}
 $('editorDialog').close();await save();
});
$('deleteRecord').onclick=async()=>{const {type,id}=editing;if(id===null)return;const arr=recordArray(type);if(!confirm('このデータを削除しますか？'))return;const old=findRecord(type,id);if(old){logEdit(type,id,'delete',old,null);state[arr]=state[arr].filter(x=>String(x[recordKey(type)])!==String(id));} $('editorDialog').close();await save();};
$('closeDialog').onclick=()=>$('editorDialog').close();
document.addEventListener('click',e=>{const hb=e.target.closest('[data-history-view]');if(hb){const h=(state.editHistory||[]).find(x=>x.historyId===hb.dataset.historyView);if(!h)return;const candidate=hb.dataset.historySide==='before'?h.before:h.after;if(!candidate){alert('選択した履歴内容がありません。');return;}const current=findRecord(h.recordType,h.recordId);const seed=structuredClone(candidate);if(current)seed[recordKey(h.recordType)]=current[recordKey(h.recordType)];openEditor(h.recordType,current?current[recordKey(h.recordType)]:null,seed);return;}const b=e.target.closest('[data-edit]');if(b)openEditor(b.dataset.edit,b.dataset.id);});
$('addPosition').onclick=()=>openEditor('position');$('addAccount').onclick=()=>openEditor('account');$('addSnapshot').onclick=()=>openEditor('snapshot');$('addHolding').onclick=()=>openEditor('holding');
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));});
function download(name,blob){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}
$('exportJson').onclick=()=>download('personal_asset_backup_'+today()+'.json',new Blob([JSON.stringify({...state,exportDate:today()},null,2)],{type:'application/json'}));
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
$('exportEncrypted').onclick=async()=>{try{const pw=$('backupPassword').value;if(pw.length<12)throw Error('パスワードは12文字以上にしてください。');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pw,salt);const data=new TextEncoder().encode(JSON.stringify({...state,exportDate:today()}));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);const payload={format:'PAM-ENCRYPTED-BACKUP',version:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',salt:btoa(String.fromCharCode(...salt)),iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...new Uint8Array(cipher)))};download('personal_asset_encrypted_'+today()+'.pamenc',new Blob([JSON.stringify(payload)],{type:'application/octet-stream'}));}catch(e){alert(e.message);}};
$('importBtn').onclick=async()=>{const f=$('importFile').files[0];if(!f){$('importResult').textContent='JSONファイルを選択してください。';return;}try{const d=JSON.parse(await f.text());validateData(d);if(!confirm(`検証成功：口座${d.accounts.length}件、FX建玉${d.fxPositions.length}件、保有資産${d.holdings.length}件。現在のデータを置き換えます。事前にバックアップしましたか？`))return;const previousHistory=state.editHistory||[];state={...EMPTY,...d,editHistory:Array.isArray(d.editHistory)?d.editHistory:previousHistory};await save();$('importResult').textContent='取り込みました。';}catch(e){$('importResult').textContent='取り込み中止：'+e.message;}};
$('importEncrypted').onclick=async()=>{const f=$('encryptedFile').files[0],pw=$('restorePassword').value;if(!f){alert('暗号化バックアップを選択してください。');return;}try{const p=JSON.parse(await f.text());if(p.format!=='PAM-ENCRYPTED-BACKUP')throw Error('対応していないファイル形式です。');const from=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const key=await deriveKey(pw,from(p.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:from(p.iv)},key,from(p.data));const d=JSON.parse(new TextDecoder().decode(plain));validateData(d);if(!confirm('暗号化バックアップを復元し、現在のデータを置き換えますか？'))return;const previousHistory=state.editHistory||[];state={...EMPTY,...d,editHistory:Array.isArray(d.editHistory)?d.editHistory:previousHistory};await save();alert('復元しました。');}catch(e){alert('復元できません：パスワードまたはファイルを確認してください。');}};
$('resetBtn').onclick=async()=>{if(!confirm('端末内のすべての資産データを削除します。よろしいですか？'))return;state=structuredClone(EMPTY);await save();};
$('manualUpdate').onclick=async()=>{if(!('serviceWorker'in navigator)){$('updateStatus').textContent='Service Worker非対応です。';return;}try{const reg=await navigator.serviceWorker.getRegistration();if(!reg){$('updateStatus').textContent='Service Workerが未登録です。';return;}await reg.update();$('updateStatus').textContent='更新確認を実行しました。新しい版があれば、現在の画面を閉じて再度開くと反映されます。';}catch(e){$('updateStatus').textContent='更新確認に失敗しました。ネットワーク接続を確認してください。';}};
async function boot(){
 $('appVersion').textContent=APP_VERSION;$('footerVersion').textContent='v'+APP_VERSION;
 db=await openDB();state=await dbGet();if(!state){state=structuredClone(EMPTY);await dbPut(state);}else state={...EMPTY,...state};
 validateData(state);let migrated=false;for(const snap of state.balanceSnapshots){if(!snap.snapshotId){snap.snapshotId=newId('snapshot');migrated=true;}}if(!Array.isArray(state.editHistory)){state.editHistory=[];migrated=true;}if(migrated)await dbPut(state);render();
 $('connection').textContent=navigator.onLine?'オンライン':'オフライン';window.addEventListener('online',()=>$('connection').textContent='オンライン');window.addEventListener('offline',()=>$('connection').textContent='オフライン');
 $('offlineState').textContent='Service Worker対応';
 if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js');}catch(e){$('offlineState').textContent='登録失敗（HTTPS配信を確認）';}}
}
boot().catch(e=>{document.body.innerHTML='<main><div class="panel"><h2>起動エラー</h2><p>'+esc(e.message)+'</p></div></main>';});
