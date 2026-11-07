'use strict';
const APP_VERSION='0.5.0-alpha2';
const DB_NAME='pam_local_v2', STORE='state';
const $=id=>document.getElementById(id);
const yen=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP')+'円':'—';
const num=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP'):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
let db, state, editing={type:null,id:null};

const EMPTY={schemaVersion:4,dataType:'personal_asset_manager',exportDate:today(),accounts:[],fxPositions:[],fxTransactions:[],fxSwapRecords:[],holdings:[],balanceSnapshots:[],contributionRecords:[],cashTransactions:[],fees:[],editHistory:[],timeSeriesRecords:[],timeSeriesRevisions:[],importMetadata:{},excelHistoricalDatabase:{},excelSimulationDatabase:{},simulationMetadata:{}};
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbGet(key='state'){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbPut(value,key='state'){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function validateData(d){
 if(!d||typeof d!=='object'||Array.isArray(d))throw Error('JSONの最上位はオブジェクトである必要があります。');
 for(const k of ['accounts','fxPositions','holdings','balanceSnapshots'])if(!Array.isArray(d[k]))throw Error(`${k} が配列ではありません。`);
 const ids=new Set(); for(const a of d.accounts){if(!a||typeof a.accountId!=='string'||!a.accountId)throw Error('口座IDが不正です。');if(ids.has(a.accountId))throw Error('口座IDが重複しています: '+a.accountId);ids.add(a.accountId);}
 const pids=new Set();for(const p of d.fxPositions){if(!p||typeof p.positionId!=='string'||!p.positionId)throw Error('建玉IDが不正です。');if(pids.has(p.positionId))throw Error('建玉IDが重複しています: '+p.positionId);pids.add(p.positionId);if(!Number.isFinite(Number(p.remainingQuantity)))throw Error('建玉残数量が数値ではありません: '+p.positionId);}
 for(const k of ['timeSeriesRecords','timeSeriesRevisions','cashTransactions','fees','editHistory'])if(d[k]!==undefined&&d[k]!==null&&!Array.isArray(d[k]))throw Error(`${k} が配列ではありません。`);
 return true;
}
async function save(){state.exportDate=today();state.schemaVersion=4;await dbPut(state);$('lastSaved').textContent='保存 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});render();}
function logEdit(type,id,action,before,after){state.editHistory=Array.isArray(state.editHistory)?state.editHistory:[];state.editHistory.unshift({historyId:newId('history'),timestamp:new Date().toISOString(),recordType:type,recordId:id,action,before:before?structuredClone(before):null,after:after?structuredClone(after):null});if(state.editHistory.length>PAMCore.EDIT_HISTORY_LIMIT)state.editHistory.length=PAMCore.EDIT_HISTORY_LIMIT;}
const typeLabel={account:'口座',position:'FX建玉',snapshot:'残高記録',holding:'保有資産',cashTransaction:'入出金・振替',bulkHistory:'履歴一括入力'};
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
 $('positionList').innerHTML=state.fxPositions.map(p=>`<div class="item"><div class="item-title">${esc(p.currencyPair||'通貨ペア未設定')} ${p.side==='buy'?'買':'売'} ・ ${esc(p.status==='closed'?'決済済':'保有中')}</div><div class="item-sub">${esc(accountName(p.accountId))} ・ 新規 ${esc(p.openDate||'不明')} ・ 新規価格 ${esc(p.openPrice??'—')}<br>当初数量 ${num(p.originalQuantity)} ／ 決済数量 ${num(p.closedQuantity)} ／ 残数量 ${num(p.remainingQuantity)}<br>記録時参考レート ${num(p.referenceRate)} ／ 日次スワップ ${yen(p.dailySwapAmount)}<br>累積スワップ ${yen(p.accumulatedSwap)} ／ 決済損益 ${yen(p.realizedProfitLoss)} ／ 評価損益 ${yen(p.unrealizedProfitLoss)}<br>登録日時 ${esc(p.registeredAt?new Date(p.registeredAt).toLocaleString('ja-JP'):'—')} ／ 最終変更 ${esc(p.updatedAt?new Date(p.updatedAt).toLocaleString('ja-JP'):'—')}</div><div class="item-actions"><button data-edit="position" data-id="${esc(p.positionId)}">編集</button></div></div>`).join('')||'<p class="muted">建玉がありません</p>';
 $('snapshotList').innerHTML=state.balanceSnapshots.map((s,i)=>({s,i})).sort((a,b)=>String(b.s.snapshotDate).localeCompare(String(a.s.snapshotDate))).map(({s,i})=>`<div class="item"><div class="item-title">${esc(accountName(s.accountId))} ・ ${esc(s.snapshotDate||'日付不明')}</div><div class="item-sub">残高 ${yen(s.balance)} ／ 評価額 ${yen(s.evaluationAmount)} ／ 純資産額 ${yen(s.netAssetValue)} ／ 必要証拠金 ${yen(s.marginRequirement)}</div><div class="item-actions"><button data-edit="snapshot" data-id="${esc(s.snapshotId||i)}">編集</button></div></div>`).join('')||'<p class="muted">残高履歴がありません</p>';
 $('holdingList').innerHTML=state.holdings.map(h=>`<div class="item"><div class="item-title">${esc(h.productName||'名称未設定')}</div><div class="item-sub">${esc(accountName(h.accountId))} ・ 評価額 ${yen(h.currentEvaluationAmount)}<br>取得額 ${yen(h.acquisitionAmount)} ／ 評価損益 ${yen(h.evaluationProfitLoss)} ・ 確認日 ${esc(h.confirmationDate||'未設定')}</div><div class="item-actions"><button data-edit="holding" data-id="${esc(h.holdingId)}">編集</button></div></div>`).join('')||'<p class="muted">保有資産がありません</p>';
 renderCash();
 $('historyCount').textContent=`${(state.editHistory||[]).length}件`;
 $('historyList').innerHTML=(state.editHistory||[]).map(h=>{const date=new Date(h.timestamp).toLocaleString('ja-JP');const payload=h.after||h.before||{};const title=isBulkPayload(h)?bulkTitle(h):payload.transactionType?(cashTypeLabels[payload.transactionType]||payload.transactionType):(payload.accountName||payload.currencyPair||payload.productName||(payload.accountId?accountName(payload.accountId):h.recordId));const isBulk=h.recordType==='bulkHistory';const detail=h.action==='bulk'?'一括登録・編集':h.action==='delete'?'削除':h.action==='create'?'新規保存':h.action==='import'?'データ取り込み':'編集・訂正';return `<div class="item"><div class="item-title">${esc(typeLabel[h.recordType]||h.recordType)}：${esc(title)}</div><div class="item-sub">${esc(date)} ・ ${esc(detail)}<br>${isBulk?bulkSummary(h):`${h.before?'変更前の内容あり':'変更前データなし'} ／ ${h.after?'保存後の内容あり':'保存後データなし'}`}</div>${isBulk?'':`<div class="item-actions"><button data-history-view="${esc(h.historyId)}" data-history-side="after" ${h.after?'':'disabled'}>保存後を編集</button>${h.before?`<button data-history-view="${esc(h.historyId)}" data-history-side="before">変更前を編集</button>`:''}</div>`}</div>`;}).join('')||'<p class="muted">まだ保存・訂正履歴はありません。今後の追加・編集・削除から記録されます。</p>';
 $('storageStatus').textContent=`IndexedDBに保存。口座 ${state.accounts.length}件、建玉 ${state.fxPositions.length}件、残高記録 ${state.balanceSnapshots.length}件。`;
}
const fields={
 account:[['accountId','口座ID','text'],['accountName','口座名','text'],['institutionName','金融機関','text'],['accountType','口座種別','select',['fx','bank','nisa','dc','ideco','crypto','other']],['currency','通貨','text'],['confirmationDate','確認日','date']],
 position:[['positionId','建玉ID','text'],['accountId','口座','selectAccounts'],['currencyPair','通貨ペア','text'],['side','売買','select',['buy','sell']],['status','状態','select',['open','closed']],['executionDate','新規約定日','date'],['originalExecutionRate','固定約定レート','number'],['referenceRate','記録時参考レート','number'],['originalQuantity','当初数量','number'],['closedQuantity','決済数量（自動）','number'],['remainingQuantity','残数量（自動）','number'],['settlementDate','全数量決済日','date'],['settlementRate','決済レート','number'],['dailySwapAmount','日次スワップ額（円）','number'],['accumulatedSwap','累積スワップ（円）','number'],['realizedProfitLoss','決済損益（円）','number'],['unrealizedProfitLoss','評価損益（円）','number']],
 snapshot:[['accountId','口座','selectAccounts'],['snapshotDate','確認日','date'],['balance','残高（円）','number'],['evaluationAmount','評価額（円）','number'],['unrealizedProfitLoss','評価損益（円）','number'],['marginRequirement','必要証拠金（円）','number'],['netAssetValue','純資産額（円）','number'],['accumulatedSwap','累積スワップ（円）','number'],['pendingWithdrawal','出金依頼額（円）','number']],
 holding:[['holdingId','資産ID','text'],['accountId','口座','selectAccounts'],['productName','商品名','text'],['productCode','商品コード','text'],['holdingQuantity','保有数量','number'],['averageAcquisitionPrice','平均取得単価','number'],['acquisitionAmount','取得額（円）','number'],['currentEvaluationAmount','現在評価額（円）','number'],['evaluationProfitLoss','評価損益（円）','number'],['evaluationProfitLossRate','評価損益率（小数）','number'],['confirmationDate','確認日','date']]
};
function newId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);}
function migrateStateData(){
 let changed=false;
 for(const key of ['timeSeriesRecords','timeSeriesRevisions','cashTransactions','fees','editHistory'])if(!Array.isArray(state[key])){state[key]=[];changed=true;}
 if(Number(state.schemaVersion||0)<4){state.schemaVersion=4;changed=true;}
 for(const snap of state.balanceSnapshots){if(!snap.snapshotId){snap.snapshotId=newId('snapshot');changed=true;}}
 for(const p of state.fxPositions){
  if(p.executionDate===undefined){p.executionDate=p.openDate||null;changed=true;}
  if(p.originalExecutionRate===undefined){p.originalExecutionRate=p.openPrice??null;changed=true;}
  if(p.dailySwapAmount===undefined){p.dailySwapAmount=null;changed=true;}
  if(p.status==='closed'){if(Number(p.closedQuantity)!==Number(p.originalQuantity||0)||Number(p.remainingQuantity)!==0)changed=true;p.closedQuantity=Number(p.originalQuantity||0);p.remainingQuantity=0;}
  else{if(Number(p.closedQuantity)!==0||Number(p.remainingQuantity)!==Number(p.originalQuantity||p.remainingQuantity||0))changed=true;p.closedQuantity=0;p.remainingQuantity=Number(p.originalQuantity||p.remainingQuantity||0);}
  if(!p.registeredAt){p.registeredAt=new Date().toISOString();changed=true;}if(!p.updatedAt){p.updatedAt=p.registeredAt;changed=true;}
 }
 return changed;
}
function openEditor(type,id=null,seed=null){
 editing={type,id};let arr=recordArray(type);
 let item;
 if(seed){item=structuredClone(seed);id=seed[recordKey(type)]??id;editing.id=id;}
 else if(id!==null){item=type==='snapshot'?state[arr].find(x=>String(x.snapshotId)===String(id))||state[arr][Number(id)]:state[arr].find(x=>x[fields[type][0][0]]===id);}
 else {item={};for(const f of fields[type])item[f[0]]=f[0].endsWith('Date')||f[0]==='snapshotDate'?today():null;if(type==='account'){item.accountId=newId('account');item.accountType='fx';item.currency='JPY';}if(type==='position'){item.positionId=newId('position');item.status='open';item.side='buy';item.currencyPair='TRY/JPY';item.originalQuantity=0;item.closedQuantity=0;item.remainingQuantity=0;item.executionDate=today();item.dailySwapAmount=0;}if(type==='snapshot'){item.snapshotDate=today();item.snapshotId=newId('snapshot');}if(type==='holding')item.holdingId=newId('holding');}
 $('editorTitle').textContent=(id===null?'追加':'編集')+({account:'口座',position:'FX建玉',snapshot:'残高記録',holding:'保有資産'}[type]);
 const root=$('editorFields');root.innerHTML='';
 for(const [key,label,kind,opts] of fields[type]){
  const wrap=document.createElement('div');wrap.className='field';
  const lab=document.createElement('label');lab.textContent=label;lab.htmlFor='f_'+key;wrap.append(lab);
  let el;
  if(kind==='select'||kind==='selectAccounts'){el=document.createElement('select');let values=kind==='selectAccounts'?state.accounts.map(a=>[a.accountId,a.accountName]):opts.map(x=>[x,x]);for(const [v,t] of values){const o=document.createElement('option');o.value=v;o.textContent=t;el.append(o);}}
  else {el=document.createElement('input');el.type=kind;if(kind==='number')el.step='any';}
  el.id='f_'+key;el.name=key;el.value=item[key]??'';if(type==='position'&&id!==null&&['executionDate','originalExecutionRate'].includes(key)){el.readOnly=true;el.title='新規約定時の固定情報です。後から変更できません。';}if(type==='position'&&['executionDate','originalExecutionRate','originalQuantity'].includes(key))el.required=true;if(type==='position'&&key==='originalQuantity')el.min='0.00000001';if(key==='accountId'&&kind==='selectAccounts'&&!item[key]&&el.options.length)el.value=el.options[0].value;
  if(key==='accountId'&&kind==='selectAccounts'&&!el.options.length){const o=document.createElement('option');o.value='';o.textContent='口座を先に登録';el.append(o);}
  if(key==='accountId'&&kind==='selectAccounts')wrap.classList.add('full-width');
  wrap.append(el);root.append(wrap);
 }
 $('deleteRecord').classList.toggle('hidden',id===null);
 $('editorDialog').showModal();
}
$('editorForm').addEventListener('submit',async e=>{e.preventDefault();const {type,id}=editing;const arr=type==='account'?'accounts':type==='position'?'fxPositions':type==='snapshot'?'balanceSnapshots':'holdings';const obj={};for(const f of fields[type]){const el=$('f_'+f[0]);if(!el)continue;obj[f[0]]=el.value===''?null:(el.type==='number'?Number(el.value):el.value);}
 const existing=id===null?null:findRecord(type,id);
 if(type==='position'){
  if(obj.executionDate===null)obj.executionDate=today();
  if(obj.originalExecutionRate===null)obj.originalExecutionRate=null;
  obj.openDate=obj.executionDate;
  obj.openPrice=obj.originalExecutionRate;
  obj.originalQuantity=Number(obj.originalQuantity||0);
  if(obj.originalQuantity<=0){alert('当初数量は0より大きい値を入力してください。');return;}
  const fullyClosed=obj.status==='closed';
  if(fullyClosed&&(!obj.settlementDate||obj.settlementRate===null)){alert('全数量決済の場合は、決済日と決済レートを入力してください。');return;}
  obj.closedQuantity=fullyClosed?obj.originalQuantity:0;
  obj.remainingQuantity=fullyClosed?0:obj.originalQuantity;
  if(!fullyClosed){obj.settlementDate=null;obj.settlementRate=null;}
  const now=new Date().toISOString();obj.registeredAt=existing?.registeredAt||now;obj.updatedAt=now;
 }
 if(type==='snapshot'){obj.snapshotId=id===null?newId('snapshot'):(findRecord(type,id)?.snapshotId||id);}
 const key=recordKey(type);
 if(id===null){state[arr].push(obj);logEdit(type,obj[key],'create',null,obj);}
 else if(existing){const merged={...existing,...obj};const idx=state[arr].indexOf(existing);state[arr][idx]=merged;logEdit(type,merged[key],'edit',existing,merged);}
 else {state[arr].push(obj);logEdit(type,obj[key],'restore',null,obj);}
 $('editorDialog').close();await save();
});
$('deleteRecord').onclick=async()=>{const {type,id}=editing;if(id===null)return;const arr=recordArray(type);if(!confirm('このデータを削除しますか？'))return;const old=findRecord(type,id);if(old){logEdit(type,id,'delete',old,null);state[arr]=state[arr].filter(x=>String(x[recordKey(type)])!==String(id));} $('editorDialog').close();await save();};
$('closeDialog').onclick=()=>$('editorDialog').close();
document.addEventListener('click',e=>{const hb=e.target.closest('[data-history-view]');if(hb){const h=(state.editHistory||[]).find(x=>x.historyId===hb.dataset.historyView);if(!h||h.recordType==='bulkHistory')return;const candidate=hb.dataset.historySide==='before'?h.before:h.after;if(!candidate){alert('選択した履歴内容がありません。');return;}if(h.recordType==='cashTransaction'){const current=(state.cashTransactions||[]).find(x=>x.transactionId===h.recordId);const seed=structuredClone(candidate);if(current)seed.transactionId=current.transactionId;openCashEditor(current?current.transactionId:null,seed);return;}const current=findRecord(h.recordType,h.recordId);const seed=structuredClone(candidate);if(current)seed[recordKey(h.recordType)]=current[recordKey(h.recordType)];openEditor(h.recordType,current?current[recordKey(h.recordType)]:null,seed);return;}const b=e.target.closest('[data-edit]');if(b)openEditor(b.dataset.edit,b.dataset.id);});
$('addPosition').onclick=()=>openEditor('position');$('addAccount').onclick=()=>openEditor('account');$('addSnapshot').onclick=()=>openEditor('snapshot');$('addHolding').onclick=()=>openEditor('holding');
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));if(b.dataset.tab==='timeline')renderTimeline();if(b.dataset.tab==='cash')renderCash();if(b.dataset.tab==='bulk')bulkEnter();});
function download(name,blob){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}
$('exportJson').onclick=()=>download('personal_asset_backup_'+today()+'.json',new Blob([JSON.stringify({...state,exportDate:today()},null,2)],{type:'application/json'}));
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
$('exportEncrypted').onclick=async()=>{try{const pw=$('backupPassword').value;if(pw.length<12)throw Error('パスワードは12文字以上にしてください。');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pw,salt);const data=new TextEncoder().encode(JSON.stringify({...state,exportDate:today()}));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);const payload={format:'PAM-ENCRYPTED-BACKUP',version:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',salt:PAMCore.bytesToBase64(salt),iv:PAMCore.bytesToBase64(iv),data:PAMCore.bytesToBase64(new Uint8Array(cipher))};download('personal_asset_encrypted_'+today()+'.pamenc',new Blob([JSON.stringify(payload)],{type:'application/octet-stream'}));}catch(e){alert(e.message);}};
$('importBtn').onclick=async()=>{const f=$('importFile').files[0];if(!f){$('importResult').textContent='JSONファイルを選択してください。';return;}try{const d=JSON.parse(await f.text());validateData(d);if(!confirm(`検証成功：口座${d.accounts.length}件、FX建玉${d.fxPositions.length}件、保有資産${d.holdings.length}件。現在のデータを置き換えます。事前にバックアップしましたか？`))return;const previousHistory=state.editHistory||[];await keepPreImportCopy();state={...EMPTY,...d,editHistory:Array.isArray(d.editHistory)?d.editHistory:previousHistory};migrateStateData();await save();$('importResult').textContent='取り込みました。（取り込み前の状態は端末内に控えとして保持しています）';}catch(e){$('importResult').textContent='取り込み中止：'+e.message;}};
$('importEncrypted').onclick=async()=>{const f=$('encryptedFile').files[0],pw=$('restorePassword').value;if(!f){alert('暗号化バックアップを選択してください。');return;}try{const p=JSON.parse(await f.text());if(p.format!=='PAM-ENCRYPTED-BACKUP')throw Error('対応していないファイル形式です。');const from=PAMCore.base64ToBytes;const key=await deriveKey(pw,from(p.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:from(p.iv)},key,from(p.data));const d=JSON.parse(new TextDecoder().decode(plain));validateData(d);if(!confirm('暗号化バックアップを復元し、現在のデータを置き換えますか？'))return;const previousHistory=state.editHistory||[];await keepPreImportCopy();state={...EMPTY,...d,editHistory:Array.isArray(d.editHistory)?d.editHistory:previousHistory};migrateStateData();await save();alert('復元しました。（復元前の状態は端末内に控えとして保持しています）');}catch(e){alert('復元できません：パスワードまたはファイルを確認してください。');}};
$('resetBtn').onclick=async()=>{if(!confirm('端末内のすべての資産データを削除します。よろしいですか？'))return;await keepPreImportCopy();state=structuredClone(EMPTY);await save();};
$('manualUpdate').onclick=async()=>{if(!('serviceWorker'in navigator)){$('updateStatus').textContent='Service Worker非対応です。';return;}try{const reg=await navigator.serviceWorker.getRegistration();if(!reg){$('updateStatus').textContent='Service Workerが未登録です。';return;}await reg.update();$('updateStatus').textContent='更新確認を実行しました。新しい版があれば、現在の画面を閉じて再度開くと反映されます。';}catch(e){$('updateStatus').textContent='更新確認に失敗しました。ネットワーク接続を確認してください。';}};

// Cash movement and fee ledger (v0.5)
let editingCashId=null;
const cashTypeLabels={transfer:'口座間振替',deposit:'単独入金',withdrawal:'単独出金',fee:'手数料'};
const cashMoney=(n,c='JPY')=>c==='JPY'?yen(n):`${num(n)} ${c}`;
const feeLabels={transfer:'振込・振替手数料',deposit:'入金手数料',withdrawal:'出金手数料',trading:'売買手数料',crypto:'暗号資産取引手数料',other:'その他'};
function cashAccountOptions(select,selected=''){
 const el=$(select);el.innerHTML='';for(const a of state.accounts){const o=document.createElement('option');o.value=a.accountId;o.textContent=`${a.accountName||a.accountId}（${a.accountType||'口座'}）`;el.append(o);}if(selected)el.value=selected;
}
function cashEffect(t,accountId){
 const amount=Number(t.amount||0),fee=Number(t.feeAmount||0),mode=t.feeMode||'additional';
 if(t.transactionType==='transfer'){
  if(accountId===t.sourceAccountId)return -(amount+(mode==='additional'&&t.feeAccountId===t.sourceAccountId?fee:0));
  if(accountId===t.targetAccountId)return amount-(mode==='deducted'?fee:0)-(mode==='additional'&&t.feeAccountId===t.targetAccountId?fee:0);
  if(mode==='additional'&&accountId===t.feeAccountId&&t.feeAccountId!==t.sourceAccountId&&t.feeAccountId!==t.targetAccountId)return -fee;
 }
 if(t.transactionType==='deposit'){
  if(accountId===t.targetAccountId)return amount-((mode==='deducted'||(mode==='additional'&&t.feeAccountId===t.targetAccountId))?fee:0);
  if(mode==='additional'&&accountId===t.feeAccountId&&t.feeAccountId!==t.targetAccountId)return -fee;
 }
 if(t.transactionType==='withdrawal'){
  if(accountId===t.sourceAccountId)return -(amount+(mode==='additional'&&t.feeAccountId===t.sourceAccountId?fee:0));
  if(mode==='additional'&&accountId===t.feeAccountId&&t.feeAccountId!==t.sourceAccountId)return -fee;
 }
 if(t.transactionType==='fee'&&accountId===t.feeAccountId)return -fee;
 return 0;
}
function cashNetByCurrency(accountId){const totals={};for(const t of (state.cashTransactions||[])){const c=t.currency||'JPY';totals[c]=(totals[c]||0)+cashEffect(t,accountId);}return Object.entries(totals).filter(([,v])=>v!==0).map(([c,v])=>cashMoney(v,c)).join(' / ')||'0円';}
function renderCash(){
 const rows=(state.cashTransactions||[]).slice().sort((a,b)=>String(b.effectiveDate).localeCompare(String(a.effectiveDate))||String(b.registeredAt).localeCompare(String(a.registeredAt)));
 const feeTotals={};for(const f of (state.fees||[])){const c=f.currency||'JPY';feeTotals[c]=(feeTotals[c]||0)+Number(f.amount||0);}const totalFeeLabel=Object.entries(feeTotals).map(([c,v])=>cashMoney(v,c)).join(' / ')||'—';
 $('cashSummary').innerHTML=`<div class="stat"><span>資金移動・入出金</span><strong>${rows.length}件</strong></div><div class="stat"><span>手数料累計</span><strong>${esc(totalFeeLabel)}</strong></div><div class="stat"><span>管理口座</span><strong>${state.accounts.length}口座</strong></div>`;
 $('cashAccountSummary').innerHTML=state.accounts.map(a=>`<div class="kv"><span>${esc(a.accountName||a.accountId)} の登録済み資金移動差額</span><b>${esc(cashNetByCurrency(a.accountId))}</b></div>`).join('')||'<p class="muted">先に口座を登録してください。</p>';
 $('cashTransactionList').innerHTML=rows.map(t=>{
  const fee=Number(t.feeAmount||0),detail=t.transactionType==='transfer'?`${accountName(t.sourceAccountId)} → ${accountName(t.targetAccountId)}`:t.transactionType==='deposit'?`${accountName(t.targetAccountId)} ← 外部`:t.transactionType==='withdrawal'?`${accountName(t.sourceAccountId)} → 外部`:`負担口座：${accountName(t.feeAccountId)}`;
  const amt=t.transactionType==='fee'?`手数料 ${cashMoney(fee,t.currency)}`:`${cashMoney(t.amount,t.currency)}${fee?` ／ 手数料 ${cashMoney(fee,t.currency)}`:''}`;
  return `<div class="item"><div class="item-title">${esc(cashTypeLabels[t.transactionType]||t.transactionType)} ・ ${esc(t.effectiveDate)}</div><div class="item-sub">${esc(detail)}<br>${esc(amt)} ・ ${esc(t.currency||'JPY')}${fee?` ・ ${esc(feeLabels[t.feeCategory]||'手数料')}（${t.feeMode==='deducted'?'入出金額から控除':'別途差引'}）`:''}${t.memo?`<br>${esc(t.memo)}`:''}</div><div class="item-actions"><button data-cash-edit="${esc(t.transactionId)}">詳細・修正</button></div></div>`;
 }).join('')||'<p class="muted">入出金・口座間振替の記録はありません。</p>';
 $('feeCount').textContent=`${(state.fees||[]).length}件`;
 $('feeList').innerHTML=(state.fees||[]).slice().sort((a,b)=>String(b.effectiveDate).localeCompare(String(a.effectiveDate))).map(f=>`<div class="item"><div class="item-title">${esc(feeLabels[f.category]||'その他手数料')} ・ ${esc(f.effectiveDate)}</div><div class="item-sub">${esc(accountName(f.accountId))} ／ ${cashMoney(f.amount,f.currency)} ／ ${esc(f.currency||'JPY')}${f.memo?`<br>${esc(f.memo)}`:''}</div></div>`).join('')||'<p class="muted">手数料はまだありません。</p>';
}
function updateCashFormVisibility(){
 const type=$('cashType').value,transfer=type==='transfer',deposit=type==='deposit',withdrawal=type==='withdrawal',fee=type==='fee';
 $('cashSourceWrap').classList.toggle('hidden',!(transfer||withdrawal));$('cashTargetWrap').classList.toggle('hidden',!(transfer||deposit));$('cashAccountWrap').classList.add('hidden');$('cashAmountWrap').classList.toggle('hidden',fee);
 $('cashAmount').required=!fee;$('cashFee').required=fee;
 $('cashFeeMode').disabled=fee;$('cashFeeCategory').disabled=false;
 if(fee){$('cashFee').value=$('cashFee').value||'0';}
 renderCashPreview();
}
function renderCashPreview(){
 const type=$('cashType').value,amount=Number($('cashAmount').value||0),fee=Number($('cashFee').value||0),mode=$('cashFeeMode').value;
 let msg='';if(type==='transfer'){const src=$('cashSource').value,dst=$('cashTarget').value,feeAcc=$('cashFeeAccount').value;const debit=amount+(mode==='additional'&&feeAcc===src?fee:0);const credit=amount-((mode==='deducted'||(mode==='additional'&&feeAcc===dst))?fee:0);msg=`${accountName(src)}から ${cashMoney(debit,$('cashCurrency').value)} を出金し、${accountName(dst)}へ ${cashMoney(credit,$('cashCurrency').value)} を入金します。`;}
 else if(type==='deposit'){const net=amount-((mode==='deducted'||(mode==='additional'&&$('cashFeeAccount').value===$('cashTarget').value))?fee:0);msg=`${accountName($('cashTarget').value)}への入金反映額：${cashMoney(net,$('cashCurrency').value)}。`;}
 else if(type==='withdrawal'){const debit=amount+(mode==='additional'&&$('cashFeeAccount').value===$('cashSource').value?fee:0);msg=`${accountName($('cashSource').value)}からの出金反映額：${cashMoney(debit,$('cashCurrency').value)}。`;}
 else msg=`${accountName($('cashFeeAccount').value)}から手数料 ${cashMoney(fee,$('cashCurrency').value)} を費用として記録します。`;
 $('cashPreview').textContent=msg+(fee?` 手数料は独立した費用記録として保存します。`:'');
}
function openCashEditor(id=null,seed=null){
 editingCashId=id??seed?.transactionId??null;const t=seed|| (editingCashId?(state.cashTransactions||[]).find(x=>x.transactionId===editingCashId):null);
 $('cashTitle').textContent=t?'入出金・振替の修正':'入出金・振替の登録';
 for(const f of ['cashSource','cashTarget','cashAccount','cashFeeAccount'])cashAccountOptions(f);
 $('cashType').value=t?.transactionType||'transfer';$('cashDate').value=t?.effectiveDate||today();$('cashSource').value=t?.sourceAccountId||state.accounts[0]?.accountId||'';$('cashTarget').value=t?.targetAccountId||state.accounts[1]?.accountId||state.accounts[0]?.accountId||'';$('cashAccount').value=t?.feeAccountId||state.accounts[0]?.accountId||'';$('cashAmount').value=t?.amount??'';$('cashFee').value=t?.feeAmount??0;$('cashFeeCategory').value=t?.feeCategory||'transfer';$('cashFeeAccount').value=t?.feeAccountId||t?.sourceAccountId||t?.targetAccountId||state.accounts[0]?.accountId||'';$('cashFeeMode').value=t?.feeMode||'additional';$('cashCurrency').value=t?.currency||'JPY';$('cashMemo').value=t?.memo||'';
 $('cashAudit').textContent=t?`登録：${new Date(t.registeredAt).toLocaleString('ja-JP')} ／ 最終変更：${new Date(t.updatedAt||t.registeredAt).toLocaleString('ja-JP')} ／ ${t.transferId?'振替ID：'+t.transferId:'単独記録'}`:'登録日時・変更日時は自動記録されます。';
 $('deleteCash').classList.toggle('hidden',!t);updateCashFormVisibility();$('cashDialog').showModal();
}
$('cashType').addEventListener('change',updateCashFormVisibility);
['cashAmount','cashFee','cashFeeMode','cashSource','cashTarget','cashAccount','cashFeeAccount','cashCurrency'].forEach(id=>$(id).addEventListener('input',renderCashPreview));
$('addCashTransaction').onclick=()=>openCashEditor();$('closeCash').onclick=()=>$('cashDialog').close();
document.addEventListener('click',e=>{const b=e.target.closest('[data-cash-edit]');if(b)openCashEditor(b.dataset.cashEdit);});
$('cashForm').addEventListener('submit',async e=>{
 e.preventDefault();try{
  const type=$('cashType').value,transfer=type==='transfer',deposit=type==='deposit',withdrawal=type==='withdrawal',amount=Number($('cashAmount').value||0),fee=Number($('cashFee').value||0),now=new Date().toISOString();
  if(fee<0||amount<0)throw Error('金額・手数料は0以上で入力してください。');
  const source=$('cashSource').value||null,target=$('cashTarget').value||null,feeAccount=$('cashFeeAccount').value||$('cashAccount').value||source||target;
  if(type==='transfer'&&(!source||!target||source===target))throw Error('振替元と振替先に異なる口座を指定してください。');
  if(type==='deposit'&&!target)throw Error('入金先口座を指定してください。');if(type==='withdrawal'&&!source)throw Error('出金元口座を指定してください。');if(type==='fee'&&(!feeAccount||fee<=0))throw Error('手数料の対象口座と金額を入力してください。');
  if(type!=='fee'&&amount<=0)throw Error('入出金額を入力してください。');if(fee>0&&!feeAccount)throw Error('手数料の負担口座を指定してください。');
  const before=editingCashId?(state.cashTransactions||[]).find(x=>x.transactionId===editingCashId):null;
  const record={transactionId:editingCashId||newId('cash'),transactionType:type,effectiveDate:$('cashDate').value,sourceAccountId:transfer||withdrawal?source:null,targetAccountId:transfer||deposit?target:null,amount:type==='fee'?0:amount,feeAmount:fee,feeCategory:$('cashFeeCategory').value,feeAccountId:feeAccount,feeMode:$('cashFeeMode').value,currency:$('cashCurrency').value,memo:$('cashMemo').value.trim(),transferId:type==='transfer'?(before?.transferId||newId('transfer')):null,registeredAt:before?.registeredAt||now,updatedAt:now};
  if(before){const i=state.cashTransactions.findIndex(x=>x.transactionId===editingCashId);state.cashTransactions[i]=record;logEdit('cashTransaction',record.transactionId,'edit',before,record);}else{state.cashTransactions.unshift(record);logEdit('cashTransaction',record.transactionId,'create',null,record);}
  const fi=(state.fees||[]).findIndex(x=>x.transactionId===record.transactionId);if(fee>0){const fr={feeId:before?.feeId||newId('fee'),transactionId:record.transactionId,effectiveDate:record.effectiveDate,accountId:record.transactionType==='fee'?feeAccount:feeAccount,category:record.feeCategory,amount:fee,currency:record.currency,memo:record.memo};record.feeId=fr.feeId;if(fi>=0)state.fees[fi]=fr;else state.fees.unshift(fr);}else if(fi>=0)state.fees.splice(fi,1);
  if(type==='fee'&&fee>0){record.amount=0;record.feeAmount=fee;}
  $('cashDialog').close();await save();
 }catch(err){alert(err.message);}
});
$('deleteCash').onclick=async()=>{if(!editingCashId)return;const old=state.cashTransactions.find(x=>x.transactionId===editingCashId);if(!old)return;if(!confirm('この入出金・振替記録と関連手数料を削除しますか？変更履歴は保持します。'))return;logEdit('cashTransaction',old.transactionId,'delete',old,null);state.cashTransactions=state.cashTransactions.filter(x=>x.transactionId!==editingCashId);state.fees=(state.fees||[]).filter(x=>x.transactionId!==editingCashId);$('cashDialog').close();await save();};

const timelineTypeLabels={crypto_snapshot:'暗号資産評価',account_snapshot:'口座スナップショット',bank_balance:'銀行残高',fx_position:'FX建玉更新',fx_swap:'FXスワップ',fx_settlement:'FX決済',securities_snapshot:'証券評価額',contribution:'入出金・積立',mortgage:'住宅ローン',other:'その他'};
let editingTimelineId=null;
const localDateTimeValue=iso=>{if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const fromLocalDateTime=value=>{const d=new Date(value);if(Number.isNaN(d.getTime()))throw Error('有効日時を正しく入力してください。');return d.toISOString();};
const timelineNum=v=>v===null||v===undefined||v===''?null:Number(v);
function timelineAccountOptions(selected=''){$('tlAccount').innerHTML='';const none=document.createElement('option');none.value='';none.textContent='口座未指定';$('tlAccount').append(none);for(const a of state.accounts){const o=document.createElement('option');o.value=a.accountId;o.textContent=a.accountName||a.accountId;$('tlAccount').append(o);} $('tlAccount').value=selected||'';}
function timelineTitle(r){return `${timelineTypeLabels[r.recordType]||r.recordType} ・ ${accountName(r.accountId)}${r.entityId?' ・ '+r.entityId:''}`;}
function renderTimeline(){
 const type=$('timelineFilterType')?.value||'',q=($('timelineSearch')?.value||'').trim().toLocaleLowerCase('ja');
 const rows=(state.timeSeriesRecords||[]).filter(r=>!r.deletedAt&&(!type||r.recordType===type)&&(!q||[timelineTitle(r),r.memo,r.entityId,r.recordId].join(' ').toLocaleLowerCase('ja').includes(q))).sort((a,b)=>String(b.effectiveAt).localeCompare(String(a.effectiveAt))||String(b.registeredAt).localeCompare(String(a.registeredAt)));
 $('timelineList').innerHTML=rows.map(r=>{const v=r.values||{};const effective=r.datePrecision==='date'?PAMCore.tsDate(r)+'（日付のみ）':new Date(r.effectiveAt).toLocaleString('ja-JP');const registered=new Date(r.registeredAt).toLocaleString('ja-JP');const valueText=formatTsValues(v);return `<div class="item"><div class="item-title">${esc(timelineTitle(r))}</div><div class="item-sub">有効日時：${esc(effective)}<br>${esc(valueText)||'数値項目なし'}<br>登録：${esc(registered)} ・ ${esc({actual:'実績',manual_historical:'手入力過去実績',estimate:'推定',calculated:'計算',simulation:'シミュレーション'}[r.valueKind]||r.valueKind)} ・ ${esc({manual:'手入力',import:'インポート',estimate:'推定計算',system:'システム',bulk:'一括入力'}[r.source]||r.source||'手入力')}${r.derivedFields?.length?'<br>自動計算：'+esc(r.derivedFields.map(k=>PAMCore.VALUE_LABELS[k]?.label||k).join('・')):''}${r.memo?'<br>メモ：'+esc(r.memo):''}</div><div class="item-actions"><button data-timeline-open="${esc(r.recordId)}">詳細・修正</button></div></div>`;}).join('')||'<p class="muted">該当する時系列記録はありません。履歴を追加するか、検索条件を変更してください。</p>';
}
function openTimelineEditor(id=null){
 editingTimelineId=id;const r=id?(state.timeSeriesRecords||[]).find(x=>x.recordId===id):null;
 $('timelineTitle').textContent=r?'時系列履歴の詳細・修正':'時系列履歴を追加';
 $('tlType').value=r?.recordType||'account_snapshot';$('tlEffectiveAt').value=localDateTimeValue(r?.effectiveAt||new Date().toISOString());
 timelineAccountOptions(r?.accountId||'');$('tlEntity').value=r?.entityId||'';
 const v=r?.values||{};$('tlAmount').value=v.amount??'';$('tlQuantity').value=v.quantity??'';$('tlRate').value=v.rate??'';$('tlProfitLoss').value=v.profitLoss??'';$('tlSwap').value=v.swap??'';
 $('tlValueKind').value=r?.valueKind||'actual';$('tlSource').value=r?.source||'manual';$('tlMemo').value=r?.memo||'';$('tlReason').value='';
 const revisions=(state.timeSeriesRevisions||[]).filter(x=>x.recordId===id).length;
 $('timelineAudit').textContent=r?`記録ID：${r.recordId} ／ 登録日時：${new Date(r.registeredAt).toLocaleString('ja-JP')} ／ 最終修正：${new Date(r.updatedAt||r.registeredAt).toLocaleString('ja-JP')} ／ 修正履歴：${revisions}件${r.batchId?' ／ 一括ID：'+r.batchId:''}${r.datePrecision==='date'?' ／ 日付のみの記録':''}`:'新規記録です。登録日時は保存時に自動記録されます。';
 const revs=(state.timeSeriesRevisions||[]).filter(x=>x.recordId===id).slice(0,10);
 $('timelineRevisionList').innerHTML=revs.length?'<h3 class="subheading">この記録の変更履歴</h3>'+revs.map(x=>{const old=x.before||{},next=x.after||{};const val=z=>formatTsValues(z.values)||'数値項目なし';return `<div class="item"><div class="item-title">${esc({create:'新規登録',edit:'修正',logical_delete:'論理削除'}[x.action]||x.action)} ・ ${esc(new Date(x.changedAt).toLocaleString('ja-JP'))}${x.batchId?' ・ 一括操作':''}</div><div class="item-sub">変更前：${esc(x.before?val(old):'—')}<br>変更後：${esc(x.after?val(next):'—')}${x.reason?'<br>理由：'+esc(x.reason):''}</div></div>`;}).join(''):'<p class="muted">この記録の変更履歴はまだありません。</p>';
 $('deleteTimeline').classList.toggle('hidden',!r||!!r.deletedAt);$('timelineDialog').showModal();
}
function addTimelineRevision(recordId,action,before,after,reason=''){
 state.timeSeriesRevisions=Array.isArray(state.timeSeriesRevisions)?state.timeSeriesRevisions:[];
 state.timeSeriesRevisions.unshift({revisionId:newId('rev'),recordId,action,changedAt:new Date().toISOString(),reason:reason||'',before:before?structuredClone(before):null,after:after?structuredClone(after):null});
}
$('timelineForm').addEventListener('submit',async e=>{
 e.preventDefault();try{
 const now=new Date().toISOString(),id=editingTimelineId;
 const before=id?(state.timeSeriesRecords||[]).find(x=>x.recordId===id):null;
 const effAt=fromLocalDateTime($('tlEffectiveAt').value),unchangedTime=!!before&&localDateTimeValue(before.effectiveAt)===$('tlEffectiveAt').value;
 const record={...(before||{}),recordId:id||newId('ts'),recordType:$('tlType').value,accountId:$('tlAccount').value||null,entityId:$('tlEntity').value.trim()||null,effectiveAt:unchangedTime?before.effectiveAt:effAt,effectiveDate:unchangedTime?PAMCore.tsDate(before):PAMCore.localDateString(new Date(effAt)),datePrecision:unchangedTime?(before.datePrecision||'datetime'):'datetime',registeredAt:before?.registeredAt||now,updatedAt:now,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Tokyo',valueKind:$('tlValueKind').value,source:$('tlSource').value,values:{...(before?.values||{}),amount:timelineNum($('tlAmount').value),quantity:timelineNum($('tlQuantity').value),rate:timelineNum($('tlRate').value),profitLoss:timelineNum($('tlProfitLoss').value),swap:timelineNum($('tlSwap').value)},memo:$('tlMemo').value.trim(),deletedAt:null};
 if(before){const idx=state.timeSeriesRecords.findIndex(x=>x.recordId===id);state.timeSeriesRecords[idx]=record;addTimelineRevision(id,'edit',before,record,$('tlReason').value.trim());}
 else{state.timeSeriesRecords.unshift(record);addTimelineRevision(record.recordId,'create',null,record,'');}
 $('timelineDialog').close();await save();renderTimeline();
 }catch(err){alert(err.message);}
});
$('deleteTimeline').onclick=async()=>{const id=editingTimelineId;if(!id)return;const r=state.timeSeriesRecords.find(x=>x.recordId===id);if(!r)return;if(!confirm('この履歴を論理削除しますか？記録自体と修正履歴は保持され、通常の一覧から非表示になります。'))return;const before=structuredClone(r);r.deletedAt=new Date().toISOString();r.updatedAt=r.deletedAt;addTimelineRevision(id,'logical_delete',before,r,'論理削除');$('timelineDialog').close();await save();renderTimeline();};
$('closeTimeline').onclick=()=>$('timelineDialog').close();
$('addTimeline').onclick=()=>openTimelineEditor();
$('timelineFilterType').onchange=renderTimeline;$('timelineSearch').oninput=renderTimeline;
document.addEventListener('click',e=>{const b=e.target.closest('[data-timeline-open]');if(b)openTimelineEditor(b.dataset.timelineOpen);});

// ===== 履歴一括入力（v0.5.0-alpha2）：画面ロジック。計算・検証は history-core.js =====
const BULK_DRAFT_KEY='bulk_draft';
const kindLabels={actual:'実績・確定値',manual_historical:'手入力の過去実績',estimate:'推定値',calculated:'計算値',simulation:'シミュレーション'};
let bulk={templateId:'bank',accountId:'',rows:[],plan:null},bulkTimer=null;
const numFull=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP',{maximumFractionDigits:8}):'—';
function fmtTsValue(key,x){return PAMCore.VALUE_LABELS[key]?.fmt==='yen'?yen(x):numFull(x);}
function formatTsValues(v){v=v||{};return Object.keys(PAMCore.VALUE_LABELS).filter(k=>v[k]!==null&&v[k]!==undefined&&v[k]!=='').map(k=>`${PAMCore.VALUE_LABELS[k].label} ${fmtTsValue(k,v[k])}`).join(' ／ ');}
function isBulkPayload(h){return h&&h.recordType==='bulkHistory';}
function bulkTitle(h){const a=h.after||{};return `${accountName(a.accountId)}（${PAMCore.TEMPLATES[a.templateId]?.label||'—'}）`;}
function bulkSummary(h){const a=h.after||{},c=a.counts||{};return `新規${c.create||0}件／修正${c.edit||0}件／削除${c.delete||0}件・一括ID ${esc(a.batchId||'')}${a.reason?'<br>理由：'+esc(a.reason):''}`;}
async function keepPreImportCopy(){try{await dbPut({savedAt:new Date().toISOString(),appVersion:APP_VERSION,state:structuredClone(state)},'pre_import_backup');}catch(e){throw Error('取り込み前の控えを保存できなかったため、処理を中止しました。');}}
$('exportPreImport').onclick=async()=>{try{const b=await dbGet('pre_import_backup');if(!b||!b.state){alert('取り込み前の控えはまだありません。');return;}download('personal_asset_before_import_'+today()+'.json',new Blob([JSON.stringify({...b.state,exportDate:today()},null,2)],{type:'application/json'}));}catch(e){alert('控えを読み出せませんでした。');}};

const bulkTpl=()=>PAMCore.TEMPLATES[bulk.templateId];
const bulkUid=()=>'r'+Math.random().toString(36).slice(2,9);
const bulkBlankRow=date=>({uid:bulkUid(),recordId:null,base:null,date:date||today(),entityId:'',values:{},memo:'',valueKind:$('bulkKind').value,delete:false});
function bulkRowFromRecord(r){const tpl=bulkTpl(),values={};for(const fd of tpl.fields){const x=r.values?.[fd.key];values[fd.key]=x===null||x===undefined?'':String(x);}const other={};for(const [k,v] of Object.entries(r.values||{}))if(!tpl.fields.some(fd=>fd.key===k))other[k]=v;return {uid:bulkUid(),recordId:r.recordId,base:r.updatedAt||null,date:PAMCore.tsDate(r),entityId:r.entityId||'',values,memo:r.memo||'',valueKind:r.valueKind||'manual_historical',delete:false,extra:formatTsValues(other)};}
const derivedLabels=(tid,keys)=>keys.map(k=>PAMCore.TEMPLATES[tid]?.fields.find(f=>f.key===k)?.label||PAMCore.VALUE_LABELS[k]?.label||k).join('・');
function bulkAccountOptions(){const el=$('bulkAccount');el.innerHTML='';for(const a of state.accounts){const o=document.createElement('option');o.value=a.accountId;o.textContent=`${a.accountName||a.accountId}（${a.accountType||'口座'}）`;el.append(o);}if(!state.accounts.some(a=>a.accountId===bulk.accountId))bulk.accountId=state.accounts[0]?.accountId||'';el.value=bulk.accountId;}
function bulkTemplateOptions(){const el=$('bulkTemplate');el.innerHTML='';for(const t of Object.values(PAMCore.TEMPLATES)){const o=document.createElement('option');o.value=t.id;o.textContent=t.label;el.append(o);}el.value=bulk.templateId;}
function bulkUpdateMsg(extra=''){const n=bulk.rows.length,e=bulk.rows.filter(r=>r.recordId).length,d=bulk.rows.filter(r=>r.delete).length;$('bulkMsg').textContent=n?`${n}行（既存${e}／新規${n-e}／削除予定${d}）${extra}`:(extra||'');}
function bulkDraftSchedule(){bulkUpdateMsg();clearTimeout(bulkTimer);bulkTimer=setTimeout(bulkSaveDraftNow,600);$('bulkDraftState').textContent='入力中（未保存）';}
async function bulkSaveDraftNow(){try{if(!bulk.rows.length){await dbPut(null,BULK_DRAFT_KEY);$('bulkDraftState').textContent='';return;}await dbPut({savedAt:new Date().toISOString(),accountId:bulk.accountId,templateId:bulk.templateId,rows:bulk.rows,kind:$('bulkKind').value,reason:$('bulkReason').value},BULK_DRAFT_KEY);$('bulkDraftState').textContent='下書きを端末内に自動保存済み';}catch(e){$('bulkDraftState').textContent='下書きを自動保存できません';}}
function bulkMk(tag,props={},text){const el=document.createElement(tag);Object.assign(el,props);if(text!==undefined)el.textContent=text;return el;}
function bulkField(label,ctl,wide){const w=bulkMk('div',{className:'field'+(wide?' full-width':'')});w.append(bulkMk('label',{},label),ctl);return w;}
function bulkActBtn(text,act,cls=''){const b=bulkMk('button',{type:'button',className:cls},text);b.dataset.bulkAct=act;return b;}
function bulkRenderRows(){
 const root=$('bulkRows');root.innerHTML='';const tpl=bulkTpl();
 if(!bulk.rows.length){root.append(bulkMk('p',{className:'panel muted'},'行がありません。「＋ 行を追加」で新規入力するか、「既存の履歴を読み込む」で修正対象を読み込みます。'));bulkUpdateMsg();return;}
 bulk.rows.forEach((row,i)=>{
  const card=bulkMk('div',{className:'panel bulk-row'+(row.delete?' marked-delete':'')});card.dataset.uid=row.uid;
  const head=bulkMk('div',{className:'bulk-row-head'});head.append(bulkMk('strong',{},`${i+1}行目`),bulkMk('span',{className:'badge'},row.recordId?'既存':'新規'),bulkMk('span',{className:'spacer'}),bulkActBtn('複製','dup'),bulkActBtn(row.recordId?(row.delete?'削除を取消':'削除'):'行を消す','del','danger'));card.append(head);
  const grid=bulkMk('div',{className:'form-grid'});
  const date=bulkMk('input',{type:'date',value:row.date,disabled:row.delete});date.dataset.f='date';grid.append(bulkField('対象日（実際の日付）',date,true));
  if(tpl.entity){const sel=bulkMk('select',{disabled:row.delete});sel.dataset.f='entityId';sel.append(bulkMk('option',{value:''},'選択'));for(const x of tpl.entity.options)sel.append(bulkMk('option',{value:x},x));sel.value=row.entityId||'';grid.append(bulkField(tpl.entity.label,sel));}
  for(const fd of tpl.fields){
   const inp=bulkMk('input',{type:'text',autocomplete:'off',value:row.values[fd.key]??'',disabled:row.delete});inp.setAttribute('inputmode','decimal');inp.dataset.f='v:'+fd.key;let ctl=inp;
   if(fd.signed){const wrap=bulkMk('div',{className:'num-wrap'});const sb=bulkActBtn('±','sign','sign-btn');sb.dataset.key=fd.key;sb.disabled=row.delete;sb.setAttribute('aria-label','正負を切り替え');wrap.append(inp,sb);ctl=wrap;}
   grid.append(bulkField(fd.label,ctl));
  }
  const kind=bulkMk('select',{disabled:row.delete});kind.dataset.f='valueKind';for(const [v,t] of Object.entries(kindLabels))kind.append(bulkMk('option',{value:v},t));kind.value=row.valueKind;grid.append(bulkField('値の区分',kind));
  const memo=bulkMk('input',{type:'text',maxLength:500,value:row.memo,disabled:row.delete});memo.dataset.f='memo';grid.append(bulkField('メモ・根拠',memo,true));
  if(row.extra)card.append(bulkMk('p',{className:'muted'},'この記録にはほかの保存値があります（この画面では変更しません）：'+row.extra));
  card.append(grid);root.append(card);
 });
 bulkUpdateMsg();
}
function bulkOnInput(e){const t=e.target,f=t.dataset?.f;if(!f)return;const card=t.closest('.bulk-row');const row=card&&bulk.rows.find(r=>r.uid===card.dataset.uid);if(!row)return;
 if(f==='date')row.date=t.value;else if(f==='entityId')row.entityId=t.value;else if(f==='memo')row.memo=t.value;else if(f==='valueKind')row.valueKind=t.value;else if(f.startsWith('v:'))row.values[f.slice(2)]=t.value;bulkDraftSchedule();}
$('bulkRows').addEventListener('input',bulkOnInput);$('bulkRows').addEventListener('change',bulkOnInput);
$('bulkRows').addEventListener('click',e=>{
 const b=e.target.closest('[data-bulk-act]');if(!b)return;const card=b.closest('.bulk-row');const idx=bulk.rows.findIndex(r=>r.uid===card?.dataset.uid);if(idx<0)return;const row=bulk.rows[idx],act=b.dataset.bulkAct;
 if(act==='dup'){bulk.rows.splice(idx+1,0,{...structuredClone(row),uid:bulkUid(),recordId:null,base:null,delete:false});bulkRenderRows();bulkDraftSchedule();}
 else if(act==='del'){if(row.recordId)row.delete=!row.delete;else bulk.rows.splice(idx,1);bulkRenderRows();bulkDraftSchedule();}
 else if(act==='sign'){const k=b.dataset.key,v=String(row.values[k]??'').trim();row.values[k]=v.startsWith('-')?v.slice(1):(v===''?'-':'-'+v.replace(/^\+/,''));const inp=card.querySelector(`[data-f="v:${k}"]`);if(inp)inp.value=row.values[k];bulkDraftSchedule();}
});
function bulkAddRows(n){const last=bulk.rows[bulk.rows.length-1];for(let k=0;k<n;k++)bulk.rows.push(bulkBlankRow(last?.date));bulkRenderRows();bulkDraftSchedule();const cards=$('bulkRows').querySelectorAll('.bulk-row');cards[cards.length-n]?.scrollIntoView({block:'start',behavior:'smooth'});}
function bulkChangeContext(accountId,templateId){
 if(bulk.rows.length&&!confirm('入力中の行は破棄されます。よろしいですか？')){$('bulkAccount').value=bulk.accountId;$('bulkTemplate').value=bulk.templateId;return;}
 bulk.rows=[];bulk.plan=null;bulk.accountId=accountId;bulk.templateId=templateId;$('bulkTemplate').value=templateId;bulkRenderRows();bulkSaveDraftNow();
}
$('bulkAccount').onchange=()=>{const a=state.accounts.find(x=>x.accountId===$('bulkAccount').value);bulkChangeContext(a?.accountId||'',PAMCore.templateIdForAccountType(a?.accountType));};
$('bulkTemplate').onchange=()=>bulkChangeContext(bulk.accountId,$('bulkTemplate').value);
$('bulkKind').onchange=bulkDraftSchedule;$('bulkReason').oninput=bulkDraftSchedule;
$('bulkAddRow').onclick=()=>bulkAddRows(1);$('bulkAddFive').onclick=()=>bulkAddRows(5);
$('bulkDiscard').onclick=()=>{if(bulk.rows.length&&!confirm('入力中の行をすべて破棄します。保存済みの履歴には影響しません。よろしいですか？'))return;bulk.rows=[];bulk.plan=null;bulkRenderRows();bulkSaveDraftNow();$('bulkNotice').classList.add('hidden');};
$('bulkLoad').onclick=()=>{
 if(!bulk.accountId){alert('口座を選択してください。');return;}
 if(bulk.rows.length&&!confirm('入力中の行は破棄され、既存の履歴で置き換わります。よろしいですか？'))return;
 const from=$('bulkFrom').value,to=$('bulkTo').value,tpl=bulkTpl();
 let recs=(state.timeSeriesRecords||[]).filter(r=>!r.deletedAt&&r.accountId===bulk.accountId&&r.recordType===tpl.recordType&&(!from||PAMCore.tsDate(r)>=from)&&(!to||PAMCore.tsDate(r)<=to));
 recs.sort((a,b)=>PAMCore.tsDate(a).localeCompare(PAMCore.tsDate(b))||String(a.effectiveAt).localeCompare(String(b.effectiveAt))||String(a.registeredAt).localeCompare(String(b.registeredAt)));
 const total=recs.length;recs=recs.slice(0,300);bulk.rows=recs.map(bulkRowFromRecord);bulk.plan=null;bulkRenderRows();bulkDraftSchedule();
 bulkUpdateMsg(total===0?'（該当する履歴はありません）':total>300?`（該当${total}件のうち先頭300件のみ読み込みました。期間を絞ってください）`:'');
};
const chgVal=(c,x)=>x===null||x===undefined||x===''?'—':c.key==='区分'?(kindLabels[x]||x):c.fmt==='yen'?yen(x):c.fmt?numFull(x):String(x);
function bulkShowPreview(){
 const now=new Date().toISOString(),tpl=bulkTpl();
 const plan=PAMCore.planBatch({records:state.timeSeriesRecords||[],accountId:bulk.accountId,templateId:bulk.templateId,rows:bulk.rows.map(r=>({...r,values:{...r.values}})),defaultKind:$('bulkKind').value,reason:$('bulkReason').value.trim(),batchId:newId('batch'),now,newId,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Tokyo',today:today()});
 bulk.plan=plan;const c=plan.counts,rowNo=r=>r>=0?`${r+1}行目`:'全体';
 let html=`<div class="kv"><span>口座</span><b>${esc(accountName(plan.accountId))}</b></div><div class="kv"><span>入力項目セット</span><b>${esc(tpl.label)}</b></div><div class="kv"><span>登録日時（保存時に記録）</span><b>${esc(new Date(now).toLocaleString('ja-JP'))}</b></div>`;
 html+=`<div class="stats"><div class="stat"><span>新規</span><strong>${c.create}</strong></div><div class="stat"><span>修正</span><strong>${c.edit}</strong></div><div class="stat"><span>削除</span><strong>${c.delete}</strong></div></div>`;
 if(c.unchanged)html+=`<p class="muted">変更なし ${c.unchanged}行（保存対象外・修正履歴も作りません）</p>`;
 if(plan.errors.length)html+=`<div class="notice err"><b>保存できません。戻って次を修正してください。</b><br>${plan.errors.map(x=>`${esc(rowNo(x.row))}：${esc(x.msg)}`).join('<br>')}</div>`;
 if(plan.warnings.length)html+=`<div class="notice"><b>確認事項（保存は可能です）</b><br>${plan.warnings.map(x=>`${esc(rowNo(x.row))}：${esc(x.msg)}`).join('<br>')}</div>`;
 $('bulkPlanSummary').innerHTML=html;
 const act=plan.items.filter(x=>x.action!=='unchanged').sort((a,b)=>a.row-b.row);
 $('bulkPlanList').innerHTML=act.map(it=>{
  const lbl={create:'新規',edit:'修正',delete:'論理削除'}[it.action],rec=it.after||it.before,d=PAMCore.tsDate(rec);
  let sub='';
  if(it.action==='create')sub=esc(formatTsValues(it.after.values))+(it.derived.length?`<br>自動計算：${esc(derivedLabels(plan.templateId,it.derived))}`:'');
  else if(it.action==='edit')sub=it.changes.map(ch=>`${esc(ch.key)}：${esc(chgVal(ch,ch.from))} → <b>${esc(chgVal(ch,ch.to))}</b>`).join('<br>')+(it.derived.length?`<br>自動計算：${esc(derivedLabels(plan.templateId,it.derived))}`:'');
  else sub=esc(formatTsValues(it.before.values))+'<br>記録は残り、通常の一覧から非表示になります。';
  return `<div class="item pv-${it.action}"><div class="item-title">${esc(rowNo(it.row))} ・ ${lbl} ・ 対象日 ${esc(d)}${rec.entityId?' ・ '+esc(rec.entityId):''}</div><div class="item-sub">${sub}</div></div>`;
 }).join('')||'<p class="muted">保存対象の変更がありません。</p>';
 $('bulkCommit').disabled=plan.errors.length>0||(c.create+c.edit+c.delete)===0;
 $('bulkEdit').classList.add('hidden');$('bulkConfirm').classList.remove('hidden');window.scrollTo(0,0);
}
$('bulkPreview').onclick=bulkShowPreview;
$('bulkBack').onclick=()=>{$('bulkConfirm').classList.add('hidden');$('bulkEdit').classList.remove('hidden');};
$('bulkCommit').onclick=async()=>{
 const plan=bulk.plan;if(!plan||plan.errors.length)return;$('bulkCommit').disabled=true;
 try{
  const next=structuredClone(state);PAMCore.applyPlan(next,plan,newId);next.exportDate=today();next.schemaVersion=4;
  await dbPut(next);state=next;   // 1回のput。失敗時はstateも置き換えない
  const c=plan.counts;bulk.rows=[];bulk.plan=null;await bulkSaveDraftNow();
  $('lastSaved').textContent='保存 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});render();renderTimeline();bulkRenderRows();
  $('bulkConfirm').classList.add('hidden');$('bulkEdit').classList.remove('hidden');$('bulkNotice').textContent=`保存しました：新規${c.create}件／修正${c.edit}件／削除${c.delete}件。変更前後は「時系列履歴」の各記録と「操作履歴」で確認できます。`;$('bulkNotice').classList.remove('hidden');window.scrollTo(0,0);
 }catch(e){alert('保存できませんでした：'+e.message);$('bulkCommit').disabled=false;}
};
function bulkEnter(){bulkAccountOptions();bulkTemplateOptions();}
async function bulkInit(){
 for(const [v,t] of Object.entries(kindLabels))$('bulkKind').append(bulkMk('option',{value:v},t));$('bulkKind').value='manual_historical';
 bulk.accountId=state.accounts[0]?.accountId||'';bulk.templateId=PAMCore.templateIdForAccountType(state.accounts[0]?.accountType);
 try{const d=await dbGet(BULK_DRAFT_KEY);if(d&&!bulk.rows.length&&Array.isArray(d.rows)&&d.rows.length&&PAMCore.TEMPLATES[d.templateId]&&state.accounts.some(a=>a.accountId===d.accountId)){bulk.accountId=d.accountId;bulk.templateId=d.templateId;bulk.rows=d.rows;$('bulkKind').value=d.kind||'manual_historical';$('bulkReason').value=d.reason||'';$('bulkNotice').textContent=`未保存の下書き（${new Date(d.savedAt).toLocaleString('ja-JP')}、${d.rows.length}行）を復元しました。`;$('bulkNotice').classList.remove('hidden');}}catch(e){}
 bulkAccountOptions();bulkTemplateOptions();bulkRenderRows();
}

async function boot(){
 $('appVersion').textContent=APP_VERSION;$('footerVersion').textContent='v'+APP_VERSION;
 db=await openDB();state=await dbGet();if(!state){state=structuredClone(EMPTY);await dbPut(state);}else state={...EMPTY,...state};
 validateData(state);if(migrateStateData())await dbPut(state);render();renderTimeline();try{await bulkInit();}catch(e){console.error(e);}
 $('connection').textContent=navigator.onLine?'オンライン':'オフライン';window.addEventListener('online',()=>$('connection').textContent='オンライン');window.addEventListener('offline',()=>$('connection').textContent='オフライン');
 $('offlineState').textContent='Service Worker対応';
 if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js');}catch(e){$('offlineState').textContent='登録失敗（HTTPS配信を確認）';}}
}
boot().catch(e=>{document.body.innerHTML='<main><div class="panel"><h2>起動エラー</h2><p>'+esc(e.message)+'</p></div></main>';});
