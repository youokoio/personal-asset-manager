'use strict';
const APP_VERSION='0.6.1-alpha1';
const DB_NAME='pam_local_v2', STORE='state';
const $=id=>document.getElementById(id);
const yen=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP')+'円':'—';
const num=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ja-JP'):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
let db, state, editing={type:null,id:null};
let committed=null,busy=false;
class Invalid extends Error{} // 入力エラー（保存せず、状態も変更しない）

const EMPTY={schemaVersion:5,dataType:'personal_asset_manager',exportDate:today(),accounts:[],fxPositions:[],fxTransactions:[],fxSwapRecords:[],holdings:[],balanceSnapshots:[],contributionRecords:[],cashTransactions:[],fees:[],editHistory:[],timeSeriesRecords:[],timeSeriesRevisions:[],importMetadata:{},excelHistoricalDatabase:{},excelSimulationDatabase:{},simulationMetadata:{}};
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
const SCHEMA_VERSION=PAMStore.SCHEMA_VERSION;
function setSaveStatus(ok,msg){const el=$('lastSaved');el.textContent=msg;el.classList.toggle('err-text',!ok);}
// 保存と描画を分離：描画の失敗は保存結果に影響しない（保存済みデータは常にIndexedDBと一致）
function safeRender(){
 try{render();}catch(e){console.error('render',e);try{const el=$('lastSaved');el.textContent+='（画面更新に失敗しました。データは保存済みです。再読み込みしてください）';el.classList.add('err-text');}catch(_){}}
 for(const fn of [()=>renderTimeline(),()=>renderTrend()]){try{fn();}catch(e){console.error(e);}}
}
function reportFailure(e,rolledBack){
 if(e instanceof Invalid){alert(e.message);return;} // 入力エラー：状態は何も変わっていない
 setSaveStatus(false,'保存失敗');safeRender();
 alert('保存できませんでした。変更は反映されていません（変更前の状態を保持しています）。\n'+(e&&e.message||e));
}
function finishSave(){committed=structuredClone(state);setSaveStatus(true,'保存 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}));safeRender();}
function stamp(s){s.exportDate=today();s.schemaVersion=SCHEMA_VERSION;s.lastModifiedAt=new Date().toISOString();}
function integrityGate(next,prev){const np=PAMStore.newProblems(PAMStore.checkIntegrity(next),PAMStore.checkIntegrity(prev||{}));if(np.length)throw Error('データの整合性エラーのため保存しませんでした：'+np.slice(0,3).map(p=>p.msg).join(' / '));}
/* 変更は「現在状態の複製」に対してだけ行い、検証→IndexedDB保存が成功した後にだけ現在状態を差し替える。
   失敗時は元の state をそのまま維持する。 */
async function commitChange(mutator){
 if(busy)return false;busy=true;
 const prev=state,draft=structuredClone(state);let swapped=false;
 try{
  state=draft;swapped=true;
  await mutator(draft);
  stamp(draft);integrityGate(draft,prev);
  await dbPut(draft);
 }catch(e){if(swapped)state=prev;busy=false;reportFailure(e);return false;}
 busy=false;finishSave();return true;
}
/* 互換用：呼び出し側が state を直接変更した後に呼ぶ旧方式。失敗時は最後に保存に成功した状態へ戻す。 */
async function save(){
 if(busy)return false;busy=true;
 try{stamp(state);integrityGate(state,committed);await dbPut(state);}
 catch(e){state=structuredClone(committed);busy=false;reportFailure(e);return false;}
 busy=false;finishSave();return true;
}
// 想定外のエラーで「画面上の変更だけが残る」状態を防ぐ安全網
function rollbackIfUnsaved(){try{if(committed&&JSON.stringify(state)!==JSON.stringify(committed)){state=structuredClone(committed);busy=false;safeRender();alert('処理中にエラーが発生したため、保存されていない変更を取り消しました。');}}catch(e){}}
window.addEventListener('error',rollbackIfUnsaved);window.addEventListener('unhandledrejection',rollbackIfUnsaved);

function logEdit(type,id,action,before,after){state.editHistory=Array.isArray(state.editHistory)?state.editHistory:[];state.editHistory.unshift({historyId:newId('history'),timestamp:new Date().toISOString(),recordType:type,recordId:id,action,before:before?structuredClone(before):null,after:after?structuredClone(after):null});if(state.editHistory.length>PAMCore.EDIT_HISTORY_LIMIT)state.editHistory.length=PAMCore.EDIT_HISTORY_LIMIT;}
const typeLabel={account:'口座',position:'FX建玉',snapshot:'残高記録',holding:'保有資産',cashTransaction:'入出金・振替',bulkHistory:'履歴一括入力',importLog:'JSON取り込み'};
function recordArray(type){return type==='account'?'accounts':type==='position'?'fxPositions':type==='snapshot'?'balanceSnapshots':'holdings';}
function recordKey(type){return type==='account'?'accountId':type==='position'?'positionId':type==='snapshot'?'snapshotId':'holdingId';}
function findRecord(type,id){return state[recordArray(type)].find(x=>String(x[recordKey(type)])===String(id));}
function accountName(id){return state.accounts.find(a=>a.accountId===id)?.accountName||id||'口座未設定';}
function latestSnapshots(){const m=new Map();for(const s of state.balanceSnapshots){const old=m.get(s.accountId);if(!old||String(s.snapshotDate)>String(old.snapshotDate))m.set(s.accountId,s);}return [...m.values()].sort((a,b)=>accountName(a.accountId).localeCompare(accountName(b.accountId),'ja'));}
function render(){
 $('accountCount').textContent=state.accounts.length;$('positionCount').textContent=state.fxPositions.filter(p=>p.status!=='closed').length;$('holdingCount').textContent=state.holdings.length;
 const fxAccounts=state.accounts.filter(a=>a.accountType==='fx');
 renderFxSummary();
 $('balanceSummary').innerHTML=latestSnapshots().map(s=>`<div class="item"><div class="kv"><span>${esc(accountName(s.accountId))}</span><b>${yen(s.netAssetValue??s.evaluationAmount??s.balance)}</b></div><div class="item-sub">${esc(s.snapshotDate||'日付不明')} ・ 評価額/純資産額の項目は元データの定義を確認してください</div></div>`).join('')||'<p class="muted">残高履歴がありません</p>';
 $('accountList').innerHTML=state.accounts.map(a=>`<div class="item"><div class="item-title">${esc(a.accountName)}</div><div class="item-sub">${esc(a.institutionName||'')} ・ ${esc(a.accountType||'')} ・ ${esc(a.accountId)} ・ 確認日 ${esc(a.confirmationDate||'未設定')}</div><div class="item-actions"><button data-edit="account" data-id="${esc(a.accountId)}">編集</button></div></div>`).join('')||'<p class="muted">口座がありません</p>';
 $('positionList').innerHTML=state.fxPositions.map(p=>`<div class="item"><div class="item-title">${esc(p.currencyPair||'通貨ペア未設定')} ${p.side==='buy'?'買':'売'} ・ ${esc(p.status==='closed'?'決済済':'保有中')}</div><div class="item-sub">${esc(accountName(p.accountId))} ・ 新規 ${esc(p.openDate||'不明')} ・ 新規価格 ${esc(p.openPrice??'—')}<br>当初数量 ${num(p.originalQuantity)} ／ 決済数量 ${num(p.closedQuantity)} ／ 残数量 ${num(p.remainingQuantity)}<br>記録時参考レート ${num(p.referenceRate)} ／ 日次スワップ ${yen(p.dailySwapAmount)}<br>累積スワップ ${yen(p.accumulatedSwap)} ／ 決済損益 ${yen(p.realizedProfitLoss)} ／ 評価損益 ${yen(p.unrealizedProfitLoss)}<br>登録日時 ${esc(p.registeredAt?new Date(p.registeredAt).toLocaleString('ja-JP'):'—')} ／ 最終変更 ${esc(p.updatedAt?new Date(p.updatedAt).toLocaleString('ja-JP'):'—')}</div><div class="item-actions"><button data-edit="position" data-id="${esc(p.positionId)}">編集</button></div></div>`).join('')||'<p class="muted">建玉がありません</p>';
 $('snapshotList').innerHTML=state.balanceSnapshots.map((s,i)=>({s,i})).sort((a,b)=>String(b.s.snapshotDate).localeCompare(String(a.s.snapshotDate))).map(({s,i})=>`<div class="item"><div class="item-title">${esc(accountName(s.accountId))} ・ ${esc(s.snapshotDate||'日付不明')}</div><div class="item-sub">残高 ${yen(s.balance)} ／ 評価額 ${yen(s.evaluationAmount)} ／ 純資産額 ${yen(s.netAssetValue)} ／ 必要証拠金 ${yen(s.marginRequirement)}</div><div class="item-actions"><button data-edit="snapshot" data-id="${esc(s.snapshotId||i)}">編集</button></div></div>`).join('')||'<p class="muted">残高履歴がありません</p>';
 $('holdingList').innerHTML=state.holdings.map(h=>`<div class="item"><div class="item-title">${esc(h.productName||'名称未設定')}</div><div class="item-sub">${esc(accountName(h.accountId))} ・ 評価額 ${yen(h.currentEvaluationAmount)}<br>取得額 ${yen(h.acquisitionAmount)} ／ 評価損益 ${yen(h.evaluationProfitLoss)} ・ 確認日 ${esc(h.confirmationDate||'未設定')}</div><div class="item-actions"><button data-edit="holding" data-id="${esc(h.holdingId)}">編集</button></div></div>`).join('')||'<p class="muted">保有資産がありません</p>';
 renderCash();renderAssetSummary();renderFxCorrections();
 $('historyCount').textContent=`${(state.editHistory||[]).length}件`;
 $('historyList').innerHTML=(state.editHistory||[]).map(h=>{const date=new Date(h.timestamp).toLocaleString('ja-JP');const payload=h.after||h.before||{};const title=isBulkPayload(h)?bulkTitle(h):payload.transactionType?(cashTypeLabels[payload.transactionType]||payload.transactionType):(payload.accountName||payload.currencyPair||payload.productName||(payload.accountId?accountName(payload.accountId):h.recordId));const isBulk=isBulkPayload(h);const detail=h.action==='bulk'?'一括登録・編集':h.action==='delete'?'削除':h.action==='create'?'新規保存':h.action==='correction'?'決済の訂正':h.action==='import'?'データ取り込み':'編集・訂正';return `<div class="item"><div class="item-title">${esc(typeLabel[h.recordType]||h.recordType)}：${esc(title)}</div><div class="item-sub">${esc(date)} ・ ${esc(detail)}<br>${isBulk?bulkSummary(h):`${h.before?'変更前の内容あり':'変更前データなし'} ／ ${h.after?'保存後の内容あり':'保存後データなし'}`}</div>${isBulk?'':`<div class="item-actions"><button data-history-view="${esc(h.historyId)}" data-history-side="after" ${h.after?'':'disabled'}>保存後を編集</button>${h.before?`<button data-history-view="${esc(h.historyId)}" data-history-side="before">変更前を編集</button>`:''}</div>`}</div>`;}).join('')||'<p class="muted">まだ保存・訂正履歴はありません。今後の追加・編集・削除から記録されます。</p>';
 $('storageStatus').textContent=`IndexedDBに保存。口座 ${state.accounts.length}件、建玉 ${state.fxPositions.length}件、残高記録 ${state.balanceSnapshots.length}件。`+(state.lastModifiedAt?` 最終保存：${new Date(state.lastModifiedAt).toLocaleString('ja-JP')}`:'');
}
const fields={
 account:[['accountId','口座ID','text'],['accountName','口座名','text'],['institutionName','金融機関','text'],['accountType','口座種別','select',['fx','bank','nisa','dc','ideco','crypto','mortgage','loan','other']],['currency','通貨','text'],['confirmationDate','確認日','date']],
 position:[['positionId','建玉ID','text'],['accountId','口座','selectAccounts'],['currencyPair','通貨ペア','text'],['side','売買','select',['buy','sell']],['status','状態','select',['open','closed']],['executionDate','新規約定日','date'],['originalExecutionRate','固定約定レート','number'],['referenceRate','記録時参考レート','number'],['originalQuantity','当初数量','number'],['closedQuantity','決済数量（自動）','number'],['remainingQuantity','残数量（自動）','number'],['settlementDate','全数量決済日','date'],['settlementRate','決済レート','number'],['dailySwapAmount','日次スワップ額（円）','number'],['accumulatedSwap','累積スワップ（円）','number'],['realizedProfitLoss','決済損益（円）','number'],['unrealizedProfitLoss','評価損益（円）','number']],
 snapshot:[['accountId','口座','selectAccounts'],['snapshotDate','確認日','date'],['balance','残高（円）','number'],['evaluationAmount','評価額（円）','number'],['unrealizedProfitLoss','評価損益（円）','number'],['marginRequirement','必要証拠金（円）','number'],['netAssetValue','純資産額（円）','number'],['accumulatedSwap','累積スワップ（円）','number'],['pendingWithdrawal','出金依頼額（円）','number']],
 holding:[['holdingId','資産ID','text'],['accountId','口座','selectAccounts'],['productName','商品名','text'],['productCode','商品コード','text'],['holdingQuantity','保有数量','number'],['averageAcquisitionPrice','平均取得単価','number'],['acquisitionAmount','取得額（円）','number'],['currentEvaluationAmount','現在評価額（円）','number'],['evaluationProfitLoss','評価損益（円）','number'],['evaluationProfitLossRate','評価損益率（小数）','number'],['confirmationDate','確認日','date']]
};
function newId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);}
function migrateStateData(){const r=PAMStore.migrateState(state,{newId,now:new Date().toISOString()});return r;}
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
  el.id='f_'+key;el.name=key;el.value=item[key]??'';if(key===recordKey(type)&&kind==='text'){el.readOnly=true;el.title='IDは自動採番され、変更できません。';}if(type==='position'&&['closedQuantity','remainingQuantity'].includes(key)){el.readOnly=true;el.title='自動計算される項目です。';}if(type==='position'&&id!==null&&['executionDate','originalExecutionRate','originalQuantity'].includes(key)){el.readOnly=true;el.title='新規約定時の固定情報です。後から変更できません。';}if(type==='position'&&id!==null&&key==='status'&&item.status==='closed'){el.disabled=true;el.title='決済済みを未決済に戻すには「決済の訂正」を使います。';}if(type==='position'&&['executionDate','originalExecutionRate','originalQuantity'].includes(key))el.required=true;if(type==='position'&&key==='originalQuantity')el.min='0.00000001';if(key==='accountId'&&kind==='selectAccounts'&&!item[key]&&el.options.length)el.value=el.options[0].value;
  if(key==='accountId'&&kind==='selectAccounts'&&!el.options.length){const o=document.createElement('option');o.value='';o.textContent='口座を先に登録';el.append(o);}
  if(key==='accountId'&&kind==='selectAccounts')wrap.classList.add('full-width');
  wrap.append(el);root.append(wrap);
 }
 $('deleteRecord').classList.toggle('hidden',id===null);$('reopenPosition').classList.toggle('hidden',!(type==='position'&&id!==null&&item&&item.status==='closed'));
 $('editorDialog').showModal();
}
$('editorForm').addEventListener('submit',async e=>{
 e.preventDefault();const {type,id}=editing;const arr=recordArray(type),key=recordKey(type);
 const input={};for(const f of fields[type]){const el=$('f_'+f[0]);if(!el)continue;input[f[0]]=el.value===''?null:(el.type==='number'?Number(el.value):el.value);}
 const ok=await commitChange(()=>{
  const existing=id===null?null:findRecord(type,id);let obj;
  if(type==='position'){
   const r=PAMStore.buildPosition(existing,input,{now:new Date().toISOString(),newId});
   if(r.errors.length)throw new Invalid(r.errors.join('\n'));obj=r.position;
  }else{
   obj={...input};
   if(existing)obj[key]=existing[key]; // 口座ID・資産IDなどのIDは通常の編集では変更できない
   else if(type==='snapshot')obj.snapshotId=newId('snapshot');
   else if(!obj[key])obj[key]=newId(type);
   if(type==='snapshot'&&existing)obj.snapshotId=existing.snapshotId||id;
  }
  if(existing){const merged={...existing,...obj};state[arr][state[arr].indexOf(existing)]=merged;logEdit(type,merged[key],'edit',existing,merged);}
  else if(id===null){state[arr].push(obj);logEdit(type,obj[key],'create',null,obj);}
  else{state[arr].push(obj);logEdit(type,obj[key],'restore',null,obj);}
 });
 if(ok)$('editorDialog').close();
});
$('deleteRecord').onclick=async()=>{
 const {type,id}=editing;if(id===null)return;const arr=recordArray(type);
 if(type==='account'){const used=Object.entries(PAMStore.accountReferences(state,id)).filter(([,n])=>n>0);
  if(used.length){alert('この口座は次のデータから参照されているため削除できません。\n'+used.map(([k,n])=>`・${k}：${n}件`).join('\n')+'\n先に関連データを削除するか、別の口座へ付け替えてください。');return;}}
 if(!confirm('このデータを削除しますか？削除前の内容は操作履歴に残ります。'))return;
 const ok=await commitChange(()=>{const old=findRecord(type,id);if(!old)throw new Invalid('対象のデータが見つかりません。');logEdit(type,id,'delete',old,null);state[arr]=state[arr].filter(x=>String(x[recordKey(type)])!==String(id));});
 if(ok)$('editorDialog').close();
};
$('reopenPosition').onclick=()=>{$('reopenReason').value='';$('reopenDialog').showModal();};
$('closeReopen').onclick=()=>$('reopenDialog').close();
$('reopenForm').addEventListener('submit',async e=>{
 e.preventDefault();const id=editing.id,reason=$('reopenReason').value;
 const ok=await commitChange(()=>{const p=findRecord('position',id);const r=PAMStore.reopenPosition(p,reason,{now:new Date().toISOString(),newId});if(r.error)throw new Invalid(r.error);
  state.fxPositions[state.fxPositions.indexOf(p)]=r.after;state.fxCorrections.unshift(r.correction);logEdit('position',id,'correction',p,r.after);});
 if(ok){$('reopenDialog').close();$('editorDialog').close();}
});

$('closeDialog').onclick=()=>$('editorDialog').close();
document.addEventListener('click',e=>{const hb=e.target.closest('[data-history-view]');if(hb){const h=(state.editHistory||[]).find(x=>x.historyId===hb.dataset.historyView);if(!h||isBulkPayload(h))return;const candidate=hb.dataset.historySide==='before'?h.before:h.after;if(!candidate){alert('選択した履歴内容がありません。');return;}if(h.recordType==='cashTransaction'){const current=(state.cashTransactions||[]).find(x=>x.transactionId===h.recordId);const seed=structuredClone(candidate);if(current)seed.transactionId=current.transactionId;openCashEditor(current?current.transactionId:null,seed);return;}const current=findRecord(h.recordType,h.recordId);const seed=structuredClone(candidate);if(current)seed[recordKey(h.recordType)]=current[recordKey(h.recordType)];openEditor(h.recordType,current?current[recordKey(h.recordType)]:null,seed);return;}const b=e.target.closest('[data-edit]');if(b)openEditor(b.dataset.edit,b.dataset.id);});
$('addPosition').onclick=()=>openEditor('position');$('addAccount').onclick=()=>openEditor('account');$('addSnapshot').onclick=()=>openEditor('snapshot');$('addHolding').onclick=()=>openEditor('holding');
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));if(b.dataset.tab==='timeline')renderTimeline();if(b.dataset.tab==='cash')renderCash();if(b.dataset.tab==='bulk')bulkEnter();if(b.dataset.tab==='trend')trendEnter();});
function download(name,blob){const a=document.createElement('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}
$('exportJson').onclick=()=>download('personal_asset_backup_'+today()+'.json',new Blob([JSON.stringify({...state,exportDate:today()},null,2)],{type:'application/json'}));
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
$('exportEncrypted').onclick=async()=>{try{const pw=$('backupPassword').value;if(pw.length<12)throw Error('パスワードは12文字以上にしてください。');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(pw,salt);const data=new TextEncoder().encode(JSON.stringify({...state,exportDate:today()}));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);const payload={format:'PAM-ENCRYPTED-BACKUP',version:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',salt:PAMCore.bytesToBase64(salt),iv:PAMCore.bytesToBase64(iv),data:PAMCore.bytesToBase64(new Uint8Array(cipher))};download('personal_asset_encrypted_'+today()+'.pamenc',new Blob([JSON.stringify(payload)],{type:'application/octet-stream'}));}catch(e){alert(e.message);}};
function showProblems(target,title,errors,warnings=[]){
 const el=$(target);el.textContent='';el.classList.add('problems');
 const add=(t,cls)=>{const d=document.createElement('div');d.className=cls||'';d.textContent=t;el.append(d);};
 add(title,'problems-title');errors.slice(0,30).forEach(m=>add('・'+m));if(errors.length>30)add(`…ほか ${errors.length-30} 件の問題があります。`);
 warnings.slice(0,10).forEach(m=>add('注意：'+m,'problems-warn'));
}
const countsLine=c=>`口座${c.accounts}／建玉${c.fxPositions}／保有${c.holdings}／残高記録${c.balanceSnapshots}／入出金${c.cashTransactions}／時系列${c.timeSeriesRecords}`;
const lostLabels={accounts:'口座',fxPositions:'FX建玉',holdings:'保有資産',balanceSnapshots:'残高記録',cashTransactions:'入出金',fees:'手数料',timeSeriesRecords:'時系列履歴',timeSeriesRevisions:'時系列の修正履歴',fxCorrections:'決済訂正'};
// 全置換の共通処理：検証 → 置換前の状態を控えに保存（失敗なら中止）→ 保存成功後にだけ state を差し替える
async function replaceState(incoming){
 if(busy)throw Error('他の保存処理が実行中です。少し待ってからやり直してください。');busy=true;
 try{
  await keepPreImportCopy();
  const next={...structuredClone(EMPTY),...structuredClone(incoming)};
  if(!Array.isArray(incoming.editHistory))next.editHistory=structuredClone(state.editHistory||[]);
  PAMStore.migrateState(next,{newId,now:new Date().toISOString()});stamp(next);
  await dbPut(next);state=next;
 }finally{busy=false;}
 finishSave();
}
async function importData(d,{target,label}){
 if(PAMStore.detectFormat(d).format==='canonical')return importCanonical(d,{target,label});
 const v=PAMStore.validateImport(d);
 if(v.errors.length){
  const msg=`取り込み中止：${label}に問題があります。データは一切読み込んでいません。`;
  if(target)showProblems(target,msg,v.errors,v.warnings);else alert(msg+'\n'+v.errors.slice(0,8).join('\n')+(v.errors.length>8?`\n…ほか${v.errors.length-8}件`:''));
  return false;
 }
 const lost=PAMStore.lostByReplace(state,d);const lostText=Object.entries(lost).map(([k,n])=>`${lostLabels[k]||k}${n}件`).join('、');
 const text=`検証に成功しました。\n取り込み後：${countsLine(PAMStore.countsOf(d))}\n現在　　：${countsLine(PAMStore.countsOf(state))}\n`+(lostText?`\n【注意】現在のデータにあり、取り込みデータに無いもの：${lostText}。置き換えると、これらは画面から消えます。\n`:'')+(v.warnings.length?`\n確認事項：${v.warnings.slice(0,3).join(' / ')}${v.warnings.length>3?` …ほか${v.warnings.length-3}件`:''}\n`:'')+'\n現在の状態は、置き換え前に端末内へ自動で控えが保存されます（「データ管理」から書き出せます）。\n現在のデータを置き換えますか？';
 if(!confirm(text))return false;
 await replaceState(d);return true;
}


// ===== 正規化JSON（dataType: personal_asset_management）の取り込み：検証 → 確認 → 追加のみで統合 =====
function showReport(target,title,lines,warns=[],cls='report'){
 const el=$(target);el.textContent='';el.classList.remove('problems','report');el.classList.add(cls);
 const add=(t,c)=>{const d=document.createElement('div');if(c)d.className=c;d.textContent=t;el.append(d);};
 add(title,'problems-title');lines.forEach(l=>add(l));warns.slice(0,15).forEach(w=>add('注意：'+w,'problems-warn'));if(warns.length>15)add(`…ほか ${warns.length-15} 件の注意があります。`);
}
function canonicalReportLines(r){
 const L=[];
 L.push(`口座：追加 ${r.accounts.added}件／追加なし ${r.accounts.skipped}件${r.accounts.aliased?`（うち同名の既存口座へ紐付け ${r.accounts.aliased}件）`:''}`);
 L.push(`FX建玉：追加 ${r.positions.added}件／重複・取り込み済みのため追加なし ${r.positions.skipped}件`);
 L.push(`残高記録：追加 ${r.snapshots.added}件／追加なし ${r.snapshots.skipped}件`);
 const pv=r.preserved;const pp=k=>pv[k]?`${pv[k].added}件追加`:'—';
 L.push(`原データの保持：原資料 ${pp('sourceDocuments')}／建玉イベント ${pp('fxPositionEvents')}／移行メモ ${pp('migrationNotes')}`);
 if(r.unsupportedNonEmpty.length)L.push(`アプリに表示項目がない形式のため、原データのまま保持（画面には未表示）：${r.unsupportedNonEmpty.join('、')}`);
 return L;
}
function canonicalWarnings(r,v){return [...(v?v.warnings:[]),...r.notes,...r.accounts.conflicts,...r.positions.conflicts,...r.snapshots.conflicts,...r.snapshots.sameDayDifferent,...r.positions.possibleDuplicates.slice(0,5),...(r.positions.possibleDuplicates.length>5?[`ほか ${r.positions.possibleDuplicates.length-5} 件の建玉を重複として追加しませんでした。`]:[])];}
async function importCanonical(d,{target,label}){
 const v=PAMStore.validateCanonical(d,{existingAccountIds:state.accounts.map(a=>a.accountId),existingPositionIds:state.fxPositions.map(p=>p.positionId)});
 if(v.errors.length){
  const msg=`取り込み中止：${label}に問題があります。データは一切読み込んでいません。`;
  if(target)showProblems(target,msg,v.errors,v.warnings);else alert(msg+'\n'+v.errors.slice(0,8).join('\n')+(v.errors.length>8?`\n…ほか${v.errors.length-8}件`:''));
  return false;
 }
 // 事前確認（試算：現在のデータには一切書き込まない）
 const probe=structuredClone(state);const pre=PAMStore.mergeCanonical(probe,PAMStore.convertCanonical(d));
 const lines=canonicalReportLines(pre);const warns=canonicalWarnings(pre,v);
 if(pre.totalAdded===0){const t='追加するデータはありません（すべて取り込み済みです）。データは変更していません。';if(target)showReport(target,t,lines,warns);else alert(t);return false;}
 const text=`正規化JSON（schemaVersion ${d.schemaVersion}）の検証に成功しました。\n既存のデータは上書き・削除せず、追加のみ行います。\n\n${lines.join('\n')}\n`+(warns.length?`\n確認事項：${warns.slice(0,3).join(' / ')}${warns.length>3?` …ほか${warns.length-3}件`:''}\n`:'')+'\n取り込み前の状態は、端末内に自動で控えが保存されます。\n取り込みますか？';
 if(!confirm(text))return false;
 await keepPreImportCopy(); // 控えを保存できない場合は中止
 let rep=null;
 const ok=await commitChange(draft=>{
  const now=new Date().toISOString();rep=PAMStore.mergeCanonical(draft,PAMStore.convertCanonical(d));
  const pc=Object.values(rep.preserved).reduce((s,r)=>s+r.added,0);
  draft.canonicalData.importedFiles.push({importedAt:now,schemaVersion:d.schemaVersion,createdAt:d.createdAt||null,label});
  draft.editHistory.unshift({historyId:newId('history'),timestamp:now,recordType:'importLog',recordId:newId('import'),action:'import',before:null,after:{label:'正規化JSON v'+d.schemaVersion,format:'canonical-v1',counts:{accounts:{added:rep.accounts.added,skipped:rep.accounts.skipped},positions:{added:rep.positions.added,skipped:rep.positions.skipped},snapshots:{added:rep.snapshots.added,skipped:rep.snapshots.skipped},preserved:pc}}});
 });
 if(!ok)return false;
 const done='取り込みました。（取り込み前の状態は端末内に控えとして保持しています）';
 if(target)showReport(target,done,canonicalReportLines(rep),canonicalWarnings(rep,v));else alert(done+'\n'+canonicalReportLines(rep).join('\n'));
 return true;
}

$('importBtn').onclick=async()=>{
 const f=$('importFile').files[0];const out=$('importResult');out.classList.remove('problems','report');
 if(!f){out.textContent='JSONファイルを選択してください。';return;}
 let d;try{d=JSON.parse(await f.text());}catch(e){showProblems('importResult','取り込み中止：JSONとして読み込めません。データは一切読み込んでいません。',[String(e.message)]);return;}
 try{const fmt=PAMStore.detectFormat(d).format;out.classList.remove('report');const done=await importData(d,{target:'importResult',label:'JSONファイル'});if(done&&fmt!=='canonical'){out.classList.remove('problems');out.textContent='取り込みました。（取り込み前の状態は端末内に控えとして保持しています）';}else if(!done&&!out.classList.contains('problems')&&!out.classList.contains('report'))out.textContent='取り込みを取り消しました。データは変更されていません。';}
 catch(e){out.classList.remove('problems');out.textContent='取り込み中止：'+e.message+'（データは変更されていません）';safeRender();}
};
$('importEncrypted').onclick=async()=>{
 const f=$('encryptedFile').files[0],pw=$('restorePassword').value;if(!f){alert('暗号化バックアップを選択してください。');return;}
 let d;try{const p=JSON.parse(await f.text());if(p.format!=='PAM-ENCRYPTED-BACKUP')throw Error('対応していないファイル形式です。');const from=PAMCore.base64ToBytes;const key=await deriveKey(pw,from(p.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:from(p.iv)},key,from(p.data));d=JSON.parse(new TextDecoder().decode(plain));}
 catch(e){alert('復元できません：パスワードまたはファイルを確認してください。データは変更されていません。');return;}
 try{const done=await importData(d,{target:null,label:'暗号化バックアップ'});if(done)alert('復元しました。（復元前の状態は端末内に控えとして保持しています）');}
 catch(e){alert('復元中止：'+e.message+'（データは変更されていません）');safeRender();}
};
$('resetBtn').onclick=async()=>{
 if(!confirm('端末内のすべての資産データを削除します。削除前の状態は端末内に1世代だけ控えとして保存されます。よろしいですか？'))return;
 try{await replaceState(structuredClone(EMPTY));}catch(e){alert('初期化できませんでした：'+e.message+'（データは変更されていません）');safeRender();}
};
$('manualUpdate').onclick=async()=>{if(!('serviceWorker'in navigator)){$('updateStatus').textContent='Service Worker非対応です。';return;}try{const reg=await navigator.serviceWorker.getRegistration();if(!reg){$('updateStatus').textContent='Service Workerが未登録です。';return;}await reg.update();$('updateStatus').textContent='更新確認を実行しました。新しい版があれば、現在の画面を閉じて再度開くと反映されます。';}catch(e){$('updateStatus').textContent='更新確認に失敗しました。ネットワーク接続を確認してください。';}};

// Cash movement and fee ledger (v0.5)
let editingCashId=null;
const cashTypeLabels={transfer:'口座間振替',deposit:'単独入金',withdrawal:'単独出金',fee:'手数料'};
const cashMoney=(n,c='JPY')=>c==='JPY'?yen(n):`${num(n)} ${c}`;
const feeLabels={transfer:'振込・振替手数料',deposit:'入金手数料',withdrawal:'出金手数料',trading:'売買手数料',crypto:'暗号資産取引手数料',other:'その他'};
function cashAccountOptions(select,selected=''){
 const el=$(select);el.innerHTML='';for(const a of state.accounts){const o=document.createElement('option');o.value=a.accountId;o.textContent=`${a.accountName||a.accountId}（${a.accountType||'口座'}）`;el.append(o);}if(selected)el.value=selected;
}
function cashEffect(t,accountId){return PAMFin.cashEffect(t,accountId);}
function cashNetByCurrency(accountId){return Object.entries(PAMFin.cashNetByCurrency(state.cashTransactions,accountId)).filter(([,v])=>v!==0).map(([c,v])=>cashMoney(v,c)).join(' / ')||'0円';}
function renderCash(){
 const rows=PAMFin.live(state.cashTransactions).slice().sort((a,b)=>String(b.effectiveDate).localeCompare(String(a.effectiveDate))||String(b.registeredAt).localeCompare(String(a.registeredAt)));
 const feeTotals={};for(const f of PAMFin.live(state.fees)){const c=f.currency||'JPY';feeTotals[c]=(feeTotals[c]||0)+Number(f.amount||0);}const totalFeeLabel=Object.entries(feeTotals).map(([c,v])=>cashMoney(v,c)).join(' / ')||'—';
 $('cashSummary').innerHTML=`<div class="stat"><span>資金移動・入出金</span><strong>${rows.length}件</strong></div><div class="stat"><span>手数料累計</span><strong>${esc(totalFeeLabel)}</strong></div><div class="stat"><span>管理口座</span><strong>${state.accounts.length}口座</strong></div>`;
 $('cashAccountSummary').innerHTML=state.accounts.map(a=>`<div class="kv"><span>${esc(a.accountName||a.accountId)} の登録済み資金移動差額</span><b>${esc(cashNetByCurrency(a.accountId))}</b></div>`).join('')||'<p class="muted">先に口座を登録してください。</p>';
 $('cashTransactionList').innerHTML=rows.map(t=>{
  const fee=Number(t.feeAmount||0),detail=t.transactionType==='transfer'?`${accountName(t.sourceAccountId)} → ${accountName(t.targetAccountId)}`:t.transactionType==='deposit'?`${accountName(t.targetAccountId)} ← 外部`:t.transactionType==='withdrawal'?`${accountName(t.sourceAccountId)} → 外部`:`負担口座：${accountName(t.feeAccountId)}`;
  const amt=t.transactionType==='fee'?`手数料 ${cashMoney(fee,t.currency)}`:`${cashMoney(t.amount,t.currency)}${fee?` ／ 手数料 ${cashMoney(fee,t.currency)}`:''}`;
  return `<div class="item"><div class="item-title">${esc(cashTypeLabels[t.transactionType]||t.transactionType)} ・ ${esc(t.effectiveDate)}</div><div class="item-sub">${esc(detail)}<br>${esc(amt)} ・ ${esc(t.currency||'JPY')}${fee?` ・ ${esc(feeLabels[t.feeCategory]||'手数料')}（${t.feeMode==='deducted'?'入出金額から控除':'別途差引'}）`:''}${t.memo?`<br>${esc(t.memo)}`:''}</div><div class="item-actions"><button data-cash-edit="${esc(t.transactionId)}">詳細・修正</button></div></div>`;
 }).join('')||'<p class="muted">入出金・口座間振替の記録はありません。</p>';
 $('feeCount').textContent=`${PAMFin.live(state.fees).length}件`;
 $('feeList').innerHTML=PAMFin.live(state.fees).slice().sort((a,b)=>String(b.effectiveDate).localeCompare(String(a.effectiveDate))).map(f=>`<div class="item"><div class="item-title">${esc(feeLabels[f.category]||'その他手数料')} ・ ${esc(f.effectiveDate)}</div><div class="item-sub">${esc(accountName(f.accountId))} ／ ${cashMoney(f.amount,f.currency)} ／ ${esc(f.currency||'JPY')}${f.memo?`<br>${esc(f.memo)}`:''}</div></div>`).join('')||'<p class="muted">手数料はまだありません。</p>';
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
 e.preventDefault();
 const type=$('cashType').value,transfer=type==='transfer',deposit=type==='deposit',withdrawal=type==='withdrawal',amount=Number($('cashAmount').value||0),fee=Number($('cashFee').value||0),now=new Date().toISOString();
 const source=$('cashSource').value||null,target=$('cashTarget').value||null,feeAccount=$('cashFeeAccount').value||$('cashAccount').value||source||target;
 const ok=await commitChange(()=>{
  if(!Number.isFinite(fee)||!Number.isFinite(amount)||fee<0||amount<0)throw new Invalid('金額・手数料は0以上の数値で入力してください。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test($('cashDate').value))throw new Invalid('日付を入力してください。');
  if(type==='transfer'&&(!source||!target||source===target))throw new Invalid('振替元と振替先に異なる口座を指定してください。');
  if(type==='deposit'&&!target)throw new Invalid('入金先口座を指定してください。');if(type==='withdrawal'&&!source)throw new Invalid('出金元口座を指定してください。');if(type==='fee'&&(!feeAccount||fee<=0))throw new Invalid('手数料の対象口座と金額を入力してください。');
  if(type!=='fee'&&amount<=0)throw new Invalid('入出金額を入力してください。');if(fee>0&&!feeAccount)throw new Invalid('手数料の負担口座を指定してください。');
  const before=editingCashId?state.cashTransactions.find(x=>x.transactionId===editingCashId):null;
  const record={transactionId:editingCashId||newId('cash'),transactionType:type,effectiveDate:$('cashDate').value,sourceAccountId:transfer||withdrawal?source:null,targetAccountId:transfer||deposit?target:null,amount:type==='fee'?0:amount,feeAmount:fee,feeCategory:$('cashFeeCategory').value,feeAccountId:feeAccount,feeMode:$('cashFeeMode').value,currency:$('cashCurrency').value,memo:$('cashMemo').value.trim(),transferId:type==='transfer'?(before?.transferId||newId('transfer')):null,registeredAt:before?.registeredAt||now,updatedAt:now};
  if(before){state.cashTransactions[state.cashTransactions.indexOf(before)]=record;logEdit('cashTransaction',record.transactionId,'edit',before,record);}else{state.cashTransactions.unshift(record);logEdit('cashTransaction',record.transactionId,'create',null,record);}
  const fi=state.fees.findIndex(x=>x.transactionId===record.transactionId);
  if(fee>0){const fr={feeId:before?.feeId||newId('fee'),transactionId:record.transactionId,effectiveDate:record.effectiveDate,accountId:feeAccount,category:record.feeCategory,amount:fee,currency:record.currency,memo:record.memo,registeredAt:before?.registeredAt||now,updatedAt:now};record.feeId=fr.feeId;if(fi>=0)state.fees[fi]=fr;else state.fees.unshift(fr);}
  else if(fi>=0){state.fees[fi]={...state.fees[fi],deletedAt:now,updatedAt:now};} // 手数料を0にした場合も物理削除せず論理削除
 });
 if(ok)$('cashDialog').close();
});
// 入出金・手数料は物理削除せず論理削除。削除前の内容は操作履歴に残る
$('deleteCash').onclick=async()=>{
 if(!editingCashId)return;if(!confirm('この入出金・振替記録と関連手数料を削除しますか？記録自体と変更履歴は保持され、通常の一覧・集計から除外されます。'))return;
 const ok=await commitChange(()=>{const old=state.cashTransactions.find(x=>x.transactionId===editingCashId);if(!old||old.deletedAt)throw new Invalid('対象の記録が見つかりません。');
  const before=structuredClone(old),now=new Date().toISOString();old.deletedAt=now;old.updatedAt=now;logEdit('cashTransaction',old.transactionId,'delete',before,null);
  for(const f of state.fees)if(f.transactionId===old.transactionId&&!f.deletedAt){f.deletedAt=now;f.updatedAt=now;}});
 if(ok)$('cashDialog').close();
};


const timelineTypeLabels={crypto_snapshot:'暗号資産評価',account_snapshot:'口座スナップショット',bank_balance:'銀行残高',fx_position:'FX建玉更新',fx_swap:'FXスワップ',fx_settlement:'FX決済',securities_snapshot:'証券評価額',contribution:'入出金・積立',mortgage:'住宅ローン',other:'その他'};
let editingTimelineId=null;
const localDateTimeValue=iso=>{if(!iso)return '';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const fromLocalDateTime=value=>{const d=new Date(value);if(Number.isNaN(d.getTime()))throw new Invalid('有効日時を正しく入力してください。');return d.toISOString();};
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
 e.preventDefault();
 const ok=await commitChange(()=>{
  const now=new Date().toISOString(),id=editingTimelineId;
  const before=id?state.timeSeriesRecords.find(x=>x.recordId===id):null;
  const effAt=fromLocalDateTime($('tlEffectiveAt').value),unchangedTime=!!before&&localDateTimeValue(before.effectiveAt)===$('tlEffectiveAt').value;
  const record={...(before||{}),recordId:id||newId('ts'),recordType:$('tlType').value,accountId:$('tlAccount').value||null,entityId:$('tlEntity').value.trim()||null,effectiveAt:unchangedTime?before.effectiveAt:effAt,effectiveDate:unchangedTime?PAMCore.tsDate(before):PAMCore.localDateString(new Date(effAt)),datePrecision:unchangedTime?(before.datePrecision||'datetime'):'datetime',registeredAt:before?.registeredAt||now,updatedAt:now,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Tokyo',valueKind:$('tlValueKind').value,source:$('tlSource').value,values:{...(before?.values||{}),amount:timelineNum($('tlAmount').value),quantity:timelineNum($('tlQuantity').value),rate:timelineNum($('tlRate').value),profitLoss:timelineNum($('tlProfitLoss').value),swap:timelineNum($('tlSwap').value)},memo:$('tlMemo').value.trim(),deletedAt:null};
  for(const [k,v] of Object.entries(record.values))if(v!==null&&!Number.isFinite(v))throw new Invalid('数値項目に数値以外が入力されています。');
  if(before){state.timeSeriesRecords[state.timeSeriesRecords.indexOf(before)]=record;addTimelineRevision(id,'edit',before,record,$('tlReason').value.trim());}
  else{state.timeSeriesRecords.unshift(record);addTimelineRevision(record.recordId,'create',null,record,'');}
 });
 if(ok)$('timelineDialog').close();
});
$('deleteTimeline').onclick=async()=>{
 const id=editingTimelineId;if(!id)return;if(!confirm('この履歴を論理削除しますか？記録自体と修正履歴は保持され、通常の一覧から非表示になります。'))return;
 const ok=await commitChange(()=>{const r=state.timeSeriesRecords.find(x=>x.recordId===id);if(!r||r.deletedAt)throw new Invalid('対象の記録が見つかりません。');const before=structuredClone(r);r.deletedAt=new Date().toISOString();r.updatedAt=r.deletedAt;addTimelineRevision(id,'logical_delete',before,r,'論理削除');});
 if(ok)$('timelineDialog').close();
};
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
function isBulkPayload(h){return h&&(h.recordType==='bulkHistory'||h.recordType==='importLog');}
function bulkTitle(h){const a=h.after||{};if(h.recordType==='importLog')return 'JSON取り込み（'+(a.label||'正規化JSON')+'）';return `${accountName(a.accountId)}（${PAMCore.TEMPLATES[a.templateId]?.label||'—'}）`;}
function bulkSummary(h){const a=h.after||{},c=a.counts||{};if(h.recordType==='importLog')return `口座 追加${c.accounts?.added||0}／FX建玉 追加${c.positions?.added||0}（重複除外${c.positions?.skipped||0}）／残高記録 追加${c.snapshots?.added||0}／原データ 追加${c.preserved||0}件`;return `新規${c.create||0}件／修正${c.edit||0}件／削除${c.delete||0}件・一括ID ${esc(a.batchId||'')}${a.reason?'<br>理由：'+esc(a.reason):''}`;}
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
const commaInt=str=>str.replace(/^([+-]?)(\d+)(\.\d*)?$/,(m,sg,i,f)=>sg+i.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(f||''));
$('bulkRows').addEventListener('focusout',e=>{const t=e.target,f=t.dataset?.f;if(!f||!f.startsWith('v:'))return;const raw=t.value.trim();const n=PAMCore.parseNum(raw);if(n===null||Number.isNaN(n))return;const plain=String(raw).replace(/[,，\s]/g,'');if(/^[+-]?\d+(\.\d*)?$/.test(plain)){t.value=commaInt(plain);const card=t.closest('.bulk-row');const row=card&&bulk.rows.find(r=>r.uid===card.dataset.uid);if(row){row.values[f.slice(2)]=t.value;bulkDraftSchedule();}}});
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
 const ok=await commitChange(d=>PAMCore.applyPlan(d,plan,newId)); // 複製に適用→検証→1回のput→成功後にだけ差し替え
 if(!ok){$('bulkCommit').disabled=false;return;}
 const c=plan.counts;bulk.rows=[];bulk.plan=null;await bulkSaveDraftNow();bulkRenderRows();
 $('bulkConfirm').classList.add('hidden');$('bulkEdit').classList.remove('hidden');$('bulkNotice').textContent=`保存しました：新規${c.create}件／修正${c.edit}件／削除${c.delete}件。変更前後は「時系列履歴」の各記録と「操作履歴」で確認できます。`;$('bulkNotice').classList.remove('hidden');window.scrollTo(0,0);
};
function bulkEnter(){bulkAccountOptions();bulkTemplateOptions();}
async function bulkInit(){
 for(const [v,t] of Object.entries(kindLabels))$('bulkKind').append(bulkMk('option',{value:v},t));$('bulkKind').value='manual_historical';
 bulk.accountId=state.accounts[0]?.accountId||'';bulk.templateId=PAMCore.templateIdForAccountType(state.accounts[0]?.accountType);
 try{const d=await dbGet(BULK_DRAFT_KEY);if(d&&!bulk.rows.length&&Array.isArray(d.rows)&&d.rows.length&&PAMCore.TEMPLATES[d.templateId]&&state.accounts.some(a=>a.accountId===d.accountId)){bulk.accountId=d.accountId;bulk.templateId=d.templateId;bulk.rows=d.rows;$('bulkKind').value=d.kind||'manual_historical';$('bulkReason').value=d.reason||'';$('bulkNotice').textContent=`未保存の下書き（${new Date(d.savedAt).toLocaleString('ja-JP')}、${d.rows.length}行）を復元しました。`;$('bulkNotice').classList.remove('hidden');}}catch(e){}
 bulkAccountOptions();bulkTemplateOptions();bulkRenderRows();
}


// ===== v0.6：資産サマリー・FX口座別・決済訂正・推移グラフ（欠損は補間しない） =====
const classLabels={bank:'銀行口座',fx:'FX口座',nisa:'証券・NISA',dc:'企業型DC',ideco:'iDeCo',crypto:'暗号資産',loan:'負債（ローン）',mortgage:'住宅ローン',other:'その他'};
function renderAssetSummary(){
 const s=PAMFin.summarizeAssets(state),el=$('assetSummary');
 let html=`<div class="stats"><div class="stat"><span>総資産</span><strong>${yen(s.totals.asset)}</strong></div><div class="stat"><span>総負債</span><strong>${yen(s.totals.liability)}</strong></div><div class="stat"><span>純資産</span><strong>${yen(s.totals.net)}</strong></div></div>`;
 if(s.missing)html+=`<p class="notice">評価データが未登録の口座が${s.missing}件あります。0円とは扱わず「データなし」として合計から除いています。</p>`;
 if(s.excluded)html+=`<p class="notice">円建て以外の口座が${s.excluded}件あり、円の合計には含めていません。</p>`;
 const order=['bank','fx','nisa','dc','ideco','crypto','mortgage','loan','other'];
 for(const t of order){const rs=s.rows.filter(r=>r.type===t||(t==='other'&&!order.includes(r.type)));if(!rs.length)continue;
  html+=`<h3 class="subheading">${esc(classLabels[t])}</h3>`+rs.map(r=>`<div class="item"><div class="kv"><span>${esc(r.name)}</span><b>${r.value===null?'データなし':esc(r.currency!=='JPY'?num(r.value)+' '+r.currency:yen(r.value))}</b></div><div class="item-sub">${r.asOf?esc(r.asOf)+' 時点 ・ '+esc(r.source):'残高・評価額の記録を登録すると表示されます'}</div></div>`).join('');}
 el.innerHTML=html+(state.accounts.length?'':'<p class="muted">口座を登録すると、ここに資産・負債・純資産が表示されます。</p>');
}
function fxAccountLatest(accountId){
 const c=[];
 for(const x of PAMFin.live(state.balanceSnapshots))if(x.accountId===accountId&&x.snapshotDate)c.push({date:x.snapshotDate,rank:1,nav:x.netAssetValue,pl:x.unrealizedProfitLoss,swap:x.accumulatedSwap});
 for(const r of PAMFin.live(state.timeSeriesRecords))if(r.accountId===accountId&&r.recordType==='account_snapshot'&&r.values)c.push({date:PAMCore.tsDate(r),rank:2,nav:r.values.netAssetValue??r.values.balance,pl:r.values.fxProfitLoss,swap:r.values.accumulatedSwap});
 return c.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.rank-b.rank).pop()||null;
}
function renderFxSummary(){
 const fx=state.accounts.filter(a=>a.accountType==='fx');
 $('fxSummary').innerHTML=fx.map(a=>{const n=state.fxPositions.filter(p=>p.accountId===a.accountId&&p.status!=='closed').length,l=fxAccountLatest(a.accountId);const v=x=>x===null||x===undefined?'—':yen(x);
  return `<div class="item"><div class="kv"><span>${esc(a.accountName)}</span><b>${n} 建玉</b></div><div class="item-sub">${l?`純資産 ${v(l.nav)} ・ 為替差益 ${v(l.pl)} ・ 累計スワップ ${v(l.swap)}<br>最終更新 ${esc(l.date)}`:'口座スナップショット未登録（データなし）'}</div></div>`;}).join('')||'<p class="muted">FX口座が登録されていません。</p>';
}
function renderFxCorrections(){
 const el=$('correctionList');if(!el)return;const cs=state.fxCorrections||[];
 el.innerHTML=cs.length?cs.map(c=>`<div class="item"><div class="item-title">決済の訂正 ・ ${esc(c.before?.currencyPair||c.positionId)}</div><div class="item-sub">${esc(new Date(c.at).toLocaleString('ja-JP'))}<br>決済済み → 未決済（決済日 ${esc(c.before?.settlementDate||'—')}、決済レート ${esc(c.before?.settlementRate??'—')} を取消）<br>理由：${esc(c.reason)}</div></div>`).join(''):'<p class="muted">決済の訂正はありません。</p>';
}

const trendMetrics=[['ts:balance','残高（時系列履歴）'],['ts:valuation','評価額（時系列履歴）'],['ts:netAssetValue','純資産（時系列履歴）'],['ts:unrealizedProfitLoss','含み損益（時系列履歴）'],['ts:effectivePrincipal','有効元本（時系列履歴）'],['snap:balance','残高（残高記録）'],['snap:netAssetValue','純資産（残高記録）'],['snap:evaluationAmount','評価額（残高記録）']];
function trendEnter(){
 const a=$('trendAccount'),keep=a.value;a.innerHTML='';for(const x of state.accounts)a.append(bulkMk('option',{value:x.accountId},x.accountName||x.accountId));if(keep&&state.accounts.some(x=>x.accountId===keep))a.value=keep;
 const m=$('trendMetric');if(!m.options.length)for(const [v,t] of trendMetrics)m.append(bulkMk('option',{value:v},t));
 renderTrend();
}
const axisFmt=v=>Math.abs(v)>=1e8?(v/1e8).toFixed(2)+'億':Math.abs(v)>=1e4?(v/1e4).toFixed(0)+'万':String(Math.round(v));
function svgEl(name,attrs,text){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs||{}))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function renderTrend(){
 const svg=$('trendSvg');if(!svg||!$('trendAccount').value)return;
 const acc=$('trendAccount').value,[src,key]=($('trendMetric').value||'ts:balance').split(':');
 const ents=[...new Set(PAMFin.live(state.timeSeriesRecords).filter(r=>r.accountId===acc&&r.entityId).map(r=>r.entityId))];
 const es=$('trendEntity');const keepE=es.value;es.innerHTML='';es.append(bulkMk('option',{value:''},'すべて／指定なし'));for(const x of ents)es.append(bulkMk('option',{value:x},x));es.value=ents.includes(keepE)?keepE:'';$('trendEntityWrap').classList.toggle('hidden',src!=='ts'||!ents.length);
 let records,valueOf;
 if(src==='ts'){records=state.timeSeriesRecords.filter(r=>r.accountId===acc&&(!es.value||r.entityId===es.value));valueOf=r=>r.values?.[key];}
 else{records=state.balanceSnapshots.filter(s=>s.accountId===acc).map(s=>({recordId:s.snapshotId,effectiveDate:s.snapshotDate,registeredAt:s.registeredAt||'',deletedAt:s.deletedAt,_v:s[key]}));valueOf=r=>r._v;}
 const from=$('trendFrom').value||null,to=$('trendTo').value||null,gap=$('trendGap').value===''?null:Number($('trendGap').value);
 const {points,segments,gaps}=PAMFin.buildSeries(records,{valueOf,from,to,maxGapDays:gap});
 svg.textContent='';
 if(!points.length){$('trendNote').textContent='該当する期間・項目のデータがありません。（データがない期間は0円ではなく「データなし」です）';$('trendGaps').textContent='';return;}
 const W=360,H=230,L=58,R=14,T=14,B=30,t0=points[0].date,span=Math.max(1,PAMFin.daysBetween(t0,points[points.length-1].date));
 const vals=points.map(p=>p.value);let lo=Math.min(...vals),hi=Math.max(...vals);if(lo===hi){lo-=1;hi+=1;}const padY=(hi-lo)*0.08;lo-=padY;hi+=padY;
 const X=d=>points.length===1?(L+(W-L-R)/2):L+(W-L-R)*PAMFin.daysBetween(t0,d)/span,Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
 for(const g of gaps){const x1=X(g.from),x2=X(g.to);svg.append(svgEl('rect',{x:x1,y:T,width:Math.max(1,x2-x1),height:H-T-B,fill:'#f6e3e3'}));svg.append(svgEl('text',{x:(x1+x2)/2,y:T+12,'text-anchor':'middle','font-size':'9',fill:'#a33'},'データなし'));}
 for(const v of [hi,(hi+lo)/2,lo]){svg.append(svgEl('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:'#dde5ec','stroke-width':'1'}));svg.append(svgEl('text',{x:L-4,y:Y(v)+3,'text-anchor':'end','font-size':'9',fill:'#526371'},axisFmt(v)));}
 for(const seg of segments)if(seg.length>=2)svg.append(svgEl('polyline',{points:seg.map(p=>`${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' '),fill:'none',stroke:'#1f5f99','stroke-width':'2'}));
 for(const p of points)svg.append(svgEl('circle',{cx:X(p.date).toFixed(1),cy:Y(p.value).toFixed(1),r:'3.5',fill:'#1f5f99'}));
 svg.append(svgEl('text',{x:L,y:H-10,'font-size':'9',fill:'#526371','text-anchor':'start'},points[0].date));
 if(points.length>1)svg.append(svgEl('text',{x:W-R,y:H-10,'font-size':'9',fill:'#526371','text-anchor':'end'},points[points.length-1].date));
 $('trendNote').textContent=`${points.length}点 ・ 最新 ${points[points.length-1].date}：${yen(points[points.length-1].value)} ・ 記録のない期間は線で結ばず、そのまま空白として表示します。`;
 $('trendGaps').textContent=gaps.length?'データのない期間：'+gaps.map(g=>`${g.from}〜${g.to}（${g.days}日）`).join('、'):(gap===null&&points.length>1?'欠損の判定なし（すべての点を線で結んでいます）':'');
}
['trendAccount','trendMetric','trendEntity','trendFrom','trendTo','trendGap'].forEach(id=>$(id).addEventListener('change',renderTrend));

async function boot(){
 $('appVersion').textContent=APP_VERSION;$('footerVersion').textContent='v'+APP_VERSION;
 db=await openDB();state=await dbGet();if(!state){state=structuredClone(EMPTY);await dbPut(state);}else state={...EMPTY,...state};
 validateData(state);
 const before=structuredClone(state);const mig=migrateStateData();
 if(mig.changed){
  // 移行前の状態を別キーに1世代だけ控えてから、移行結果を保存する（既存データは消去しない）
  if(mig.fromVersion<SCHEMA_VERSION){try{await dbPut({savedAt:new Date().toISOString(),fromVersion:mig.fromVersion,appVersion:APP_VERSION,state:before},'pre_migration_backup');}catch(e){console.error(e);alert('移行前の控えを保存できませんでした。通常はそのまま利用できますが、念のため先にJSONバックアップを取得してください。');}}
  await dbPut(state);
 }
 committed=structuredClone(state);
 safeRender();try{await bulkInit();}catch(e){console.error(e);}
 $('connection').textContent=navigator.onLine?'オンライン':'オフライン';window.addEventListener('online',()=>$('connection').textContent='オンライン');window.addEventListener('offline',()=>$('connection').textContent='オフライン');
 $('offlineState').textContent='Service Worker対応';
 if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js');}catch(e){$('offlineState').textContent='登録失敗（HTTPS配信を確認）';}}
}
boot().catch(e=>{document.body.innerHTML='<main><div class="panel"><h2>起動エラー</h2><p>'+esc(e.message)+'</p></div></main>';});
