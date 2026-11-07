'use strict';
/* store-core.js — データ構造・移行・検証・建玉ルール（画面・DBに依存しない純粋関数）
   ブラウザでは window.PAMStore、Nodeでは module.exports として公開する。 */
(function(root){
const SCHEMA_VERSION=5;
const REQUIRED_ARRAYS=['accounts','fxPositions','holdings','balanceSnapshots'];
const OPTIONAL_ARRAYS=['fxTransactions','fxSwapRecords','contributionRecords','cashTransactions','fees','editHistory','timeSeriesRecords','timeSeriesRevisions'];
// v5で追加する配列（将来機能のための予約。今回のUIでは fxCorrections のみ使用）
const NEW_ARRAYS_V5=['fxCorrections','swapRateHistory','liabilities','loanRepayments','cryptoTransactions','migrationHistory'];
const ALL_ARRAYS=[...REQUIRED_ARRAYS,...OPTIONAL_ARRAYS,...NEW_ARRAYS_V5];

/* ---------- 移行（冪等。既存データは削除せず、不足項目の補完のみ） ---------- */
function migrateState(state,{newId,now}){
 const steps=[];const fromVersion=Number(state.schemaVersion||0);
 for(const k of ALL_ARRAYS)if(!Array.isArray(state[k])){state[k]=[];steps.push(`配列 ${k} を追加`);}
 for(const snap of state.balanceSnapshots)if(!snap.snapshotId){snap.snapshotId=newId('snapshot');steps.push('残高記録にIDを付与');}
 for(const p of state.fxPositions){
  if(p.executionDate===undefined){p.executionDate=p.openDate||null;steps.push('建玉 executionDate を補完');}
  if(p.originalExecutionRate===undefined){p.originalExecutionRate=p.openPrice??null;steps.push('建玉 originalExecutionRate を補完');}
  if(p.dailySwapAmount===undefined){p.dailySwapAmount=null;steps.push('建玉 dailySwapAmount を補完');}
  const oq=Number(p.originalQuantity||0);
  if(p.status==='closed'){if(Number(p.closedQuantity)!==oq||Number(p.remainingQuantity)!==0)steps.push('決済済み建玉の数量を整合');p.closedQuantity=oq;p.remainingQuantity=0;}
  else{const rq=Number(p.originalQuantity||p.remainingQuantity||0);if(Number(p.closedQuantity)!==0||Number(p.remainingQuantity)!==rq)steps.push('未決済建玉の数量を整合');p.closedQuantity=0;p.remainingQuantity=rq;}
  if(!p.registeredAt){p.registeredAt=now;steps.push('建玉 registeredAt を補完');}
  if(!p.updatedAt){p.updatedAt=p.registeredAt;steps.push('建玉 updatedAt を補完');}
 }
 if(fromVersion<SCHEMA_VERSION){
  state.schemaVersion=SCHEMA_VERSION;
  state.migrationHistory.push({from:fromVersion,to:SCHEMA_VERSION,at:now,note:'データを削除せず、不足項目・予約配列のみ補完'});
  steps.push(`schemaVersion ${fromVersion} → ${SCHEMA_VERSION}`);
 }
 return {changed:steps.length>0,steps:[...new Set(steps)],fromVersion};
}

/* ---------- 参照・ID整合性チェック（保存時は「新たに増えた問題」だけを保存拒否の根拠にする） ---------- */
const ID_KEYS={accounts:'accountId',fxPositions:'positionId',holdings:'holdingId',balanceSnapshots:'snapshotId',cashTransactions:'transactionId',fees:'feeId',timeSeriesRecords:'recordId',timeSeriesRevisions:'revisionId',editHistory:'historyId',fxCorrections:'correctionId'};
function checkIntegrity(state){
 const problems=[];const add=(key,msg)=>problems.push({key,msg});
 for(const [arr,idKey] of Object.entries(ID_KEYS)){
  const seen=new Set();
  for(const r of (Array.isArray(state[arr])?state[arr]:[])){
   const id=r&&r[idKey];if(id===undefined||id===null||id==='')continue;
   if(seen.has(String(id)))add(`dup:${arr}:${id}`,`${arr} のID「${id}」が重複しています。`);seen.add(String(id));
  }
 }
 const acc=new Set((state.accounts||[]).map(a=>a.accountId));
 const refs=(arr,field,label)=>{for(const r of (state[arr]||[])){if(r&&r.deletedAt)continue;const v=r&&r[field];if(v!==null&&v!==undefined&&v!==''&&!acc.has(v))add(`ref:${arr}:${r[ID_KEYS[arr]]??''}:${field}:${v}`,`${label}が存在しない口座「${v}」を参照しています。`);}};
 refs('fxPositions','accountId','FX建玉');refs('holdings','accountId','保有資産');refs('balanceSnapshots','accountId','残高記録');
 refs('cashTransactions','sourceAccountId','入出金（元口座）');refs('cashTransactions','targetAccountId','入出金（先口座）');refs('cashTransactions','feeAccountId','入出金（手数料負担口座）');
 refs('fees','accountId','手数料');refs('timeSeriesRecords','accountId','時系列履歴');
 const tx=new Set((state.cashTransactions||[]).map(t=>t.transactionId));
 for(const f of (state.fees||[]))if(!f.deletedAt&&f.transactionId&&!tx.has(f.transactionId))add(`ref:fees:${f.feeId}:transactionId`,`手数料が存在しない入出金「${f.transactionId}」を参照しています。`);
 return problems;
}
const newProblems=(after,before)=>{const old=new Set(before.map(p=>p.key));return after.filter(p=>!old.has(p.key));};
function accountReferences(state,accountId){
 const live=a=>(state[a]||[]).filter(r=>!r.deletedAt);
 return {
  'FX建玉':live('fxPositions').filter(x=>x.accountId===accountId).length,'保有資産':live('holdings').filter(x=>x.accountId===accountId).length,'残高記録':live('balanceSnapshots').filter(x=>x.accountId===accountId).length,
  '入出金・手数料':live('cashTransactions').filter(x=>[x.sourceAccountId,x.targetAccountId,x.feeAccountId].includes(accountId)).length,'時系列履歴':live('timeSeriesRecords').filter(x=>x.accountId===accountId).length
 };
}

/* ---------- JSON取り込み検証（部分的に読み込まず、問題箇所をすべて列挙） ---------- */
const DATE_RE=/^(\d{4})-(\d{2})-(\d{2})$/;
function isDate(s){const m=DATE_RE.exec(String(s));if(!m)return false;const d=new Date(+m[1],+m[2]-1,+m[3]);return d.getFullYear()===+m[1]&&d.getMonth()===+m[2]-1&&d.getDate()===+m[3];}
const isTs=s=>typeof s==='string'&&s!==''&&!Number.isNaN(new Date(s).getTime());
const DATE_FIELDS={accounts:['confirmationDate'],fxPositions:['executionDate','openDate','settlementDate'],holdings:['confirmationDate'],balanceSnapshots:['snapshotDate'],cashTransactions:['effectiveDate'],fees:['effectiveDate'],timeSeriesRecords:['effectiveDate']};
const TS_FIELDS={fxPositions:['registeredAt','updatedAt'],cashTransactions:['registeredAt','updatedAt'],timeSeriesRecords:['effectiveAt','registeredAt','updatedAt'],timeSeriesRevisions:['changedAt'],editHistory:['timestamp']};
const NUM_FIELDS={
 fxPositions:['originalExecutionRate','openPrice','referenceRate','settlementRate','dailySwapAmount','accumulatedSwap','realizedProfitLoss','unrealizedProfitLoss','originalQuantity','closedQuantity','remainingQuantity'],
 balanceSnapshots:['balance','evaluationAmount','unrealizedProfitLoss','marginRequirement','netAssetValue','accumulatedSwap','pendingWithdrawal'],
 holdings:['holdingQuantity','averageAcquisitionPrice','acquisitionAmount','currentEvaluationAmount','evaluationProfitLoss','evaluationProfitLossRate'],
 cashTransactions:['amount','feeAmount'],fees:['amount']
};
const NONNEG={cashTransactions:['amount','feeAmount'],fees:['amount'],fxPositions:['originalQuantity','closedQuantity','remainingQuantity']};
const REQUIRED_ID={accounts:'accountId',fxPositions:'positionId',holdings:'holdingId',cashTransactions:'transactionId',fees:'feeId',timeSeriesRecords:'recordId'};
function validateImport(d,{maxVersion=SCHEMA_VERSION}={}){
 const errors=[],warnings=[];const err=m=>errors.push(m),warn=m=>warnings.push(m);
 if(!d||typeof d!=='object'||Array.isArray(d)){return {errors:['JSONの最上位がオブジェクトではありません。'],warnings,schemaVersion:null};}
 let ver=d.schemaVersion;
 if(ver===undefined||ver===null){warn('schemaVersion がありません。旧形式として扱います。');ver=0;}
 else if(!Number.isInteger(ver)||ver<0)err(`schemaVersion が不正です（${JSON.stringify(ver)}）。`);
 else if(ver>maxVersion)err(`このアプリが対応していない新しいバージョン（schemaVersion ${ver}）のデータです。アプリを更新してから取り込んでください。（対応：${maxVersion}まで）`);
 if(d.dataType!==undefined&&d.dataType!=='personal_asset_manager')err(`dataType が「personal_asset_manager」ではありません（${JSON.stringify(d.dataType)}）。`);
 for(const k of REQUIRED_ARRAYS)if(!Array.isArray(d[k]))err(`必須の配列 ${k} がありません、または配列ではありません。`);
 for(const k of [...OPTIONAL_ARRAYS,...NEW_ARRAYS_V5])if(d[k]!==undefined&&d[k]!==null&&!Array.isArray(d[k]))err(`${k} が配列ではありません。`);
 const arr=k=>Array.isArray(d[k])?d[k]:[];
 // 要素の型・ID・重複
 for(const k of ALL_ARRAYS){arr(k).forEach((r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r))err(`${k}[${i}] がオブジェクトではありません。`);});}
 for(const [k,idKey] of Object.entries(ID_KEYS)){
  const seen=new Map();
  arr(k).forEach((r,i)=>{if(!r||typeof r!=='object')return;const id=r[idKey];
   if(id===undefined||id===null||id===''){if(REQUIRED_ID[k]===idKey)err(`${k}[${i}] に ${idKey} がありません。`);return;}
   if(typeof id!=='string')err(`${k}[${i}] の ${idKey} が文字列ではありません。`);
   else if(seen.has(id))err(`${k} の ${idKey}「${id}」が重複しています（${seen.get(id)+1}件目と${i+1}件目）。`);else seen.set(id,i);});
 }
 // 日付・日時
 for(const [k,fs] of Object.entries(DATE_FIELDS))arr(k).forEach((r,i)=>{if(!r||typeof r!=='object')return;for(const f of fs){const v=r[f];if(v===undefined||v===null||v==='')continue;if(!isDate(v))err(`${k}[${i}].${f} が日付（YYYY-MM-DD）ではありません：${JSON.stringify(v)}`);}});
 for(const [k,fs] of Object.entries(TS_FIELDS))arr(k).forEach((r,i)=>{if(!r||typeof r!=='object')return;for(const f of fs){const v=r[f];if(v===undefined||v===null||v==='')continue;if(!isTs(v))err(`${k}[${i}].${f} が日時として読めません：${JSON.stringify(v)}`);}});
 // 数値
 for(const [k,fs] of Object.entries(NUM_FIELDS))arr(k).forEach((r,i)=>{if(!r||typeof r!=='object')return;for(const f of fs){const v=r[f];if(v===undefined||v===null)continue;
  if(typeof v!=='number'||!Number.isFinite(v)){err(`${k}[${i}].${f} が数値ではありません：${JSON.stringify(v)}`);continue;}
  if((NONNEG[k]||[]).includes(f)&&v<0)err(`${k}[${i}].${f} が負の値です：${v}`);}});
 arr('timeSeriesRecords').forEach((r,i)=>{if(!r||typeof r!=='object'||r.values===undefined||r.values===null)return;
  if(typeof r.values!=='object'||Array.isArray(r.values)){err(`timeSeriesRecords[${i}].values がオブジェクトではありません。`);return;}
  for(const [f,v] of Object.entries(r.values))if(v!==null&&(typeof v!=='number'||!Number.isFinite(v)))err(`timeSeriesRecords[${i}].values.${f} が数値ではありません：${JSON.stringify(v)}`);});
 // 列挙値・論理
 arr('fxPositions').forEach((p,i)=>{if(!p||typeof p!=='object')return;
  if(p.status!==undefined&&!['open','closed'].includes(p.status))err(`fxPositions[${i}].status が open/closed ではありません：${JSON.stringify(p.status)}`);
  if(p.side!==undefined&&p.side!==null&&!['buy','sell'].includes(p.side))err(`fxPositions[${i}].side が buy/sell ではありません：${JSON.stringify(p.side)}`);
  if(p.status==='closed'&&p.settlementDate&&p.executionDate&&isDate(p.settlementDate)&&isDate(p.executionDate)&&p.settlementDate<p.executionDate)err(`fxPositions[${i}] の決済日が約定日より前です。`);});
 arr('cashTransactions').forEach((t,i)=>{if(!t||typeof t!=='object')return;
  if(!['transfer','deposit','withdrawal','fee'].includes(t.transactionType))err(`cashTransactions[${i}].transactionType が不正です：${JSON.stringify(t.transactionType)}`);
  if(t.feeMode!==undefined&&t.feeMode!==null&&!['additional','deducted'].includes(t.feeMode))err(`cashTransactions[${i}].feeMode が additional/deducted ではありません：${JSON.stringify(t.feeMode)}`);
  if(t.transactionType==='transfer'&&(!t.sourceAccountId||!t.targetAccountId||t.sourceAccountId===t.targetAccountId))err(`cashTransactions[${i}] の振替元・振替先が不正です（同一または未指定）。`);
  if(t.transactionType==='deposit'&&!t.targetAccountId)err(`cashTransactions[${i}]（入金）に入金先口座がありません。`);
  if(t.transactionType==='withdrawal'&&!t.sourceAccountId)err(`cashTransactions[${i}]（出金）に出金元口座がありません。`);
  if(Number(t.feeAmount||0)>0&&!t.feeAccountId)err(`cashTransactions[${i}] に手数料があるのに負担口座がありません。`);});
 // 参照整合性：このアプリ(v5)が出力するデータは孤立参照を作らないためエラー。旧版データは過去の口座削除で孤立参照を持ち得るため警告
 {
  const probs=checkIntegrity(Object.fromEntries(ALL_ARRAYS.map(k=>[k,arr(k).filter(r=>r&&typeof r==='object'&&!Array.isArray(r))]))).filter(p=>!p.key.startsWith('dup:'));
  for(const p of probs)(ver>=SCHEMA_VERSION?err:warn)(p.msg+(ver>=SCHEMA_VERSION?'':'（旧版データのため警告）'));
 }
 return {errors,warnings,schemaVersion:ver};
}
const countsOf=s=>Object.fromEntries(['accounts','fxPositions','holdings','balanceSnapshots','cashTransactions','fees','timeSeriesRecords','timeSeriesRevisions','editHistory'].map(k=>[k,(Array.isArray(s?.[k])?s[k]:[]).length]));
// 「現在にあって取り込みデータに無い」IDの件数（置き換えで失われるもの）
function lostByReplace(current,incoming){
 const out={};
 for(const [k,idKey] of Object.entries(ID_KEYS)){
  if(['editHistory'].includes(k))continue;
  const inc=new Set((incoming[k]||[]).map(r=>r&&r[idKey]));
  const n=(current[k]||[]).filter(r=>r&&r[idKey]&&!inc.has(r[idKey])).length;if(n)out[k]=n;
 }
 return out;
}

/* ---------- FX建玉：固定情報の保護・決済・決済の訂正 ---------- */
const LOCKED_POSITION_FIELDS=['positionId','executionDate','originalExecutionRate','originalQuantity'];
const same=(a,b)=>(a===null||a===undefined||a==='')&&(b===null||b===undefined||b==='')||(a!==null&&b!==null&&a!==undefined&&b!==undefined&&a!==''&&b!==''&&(typeof a==='number'||typeof b==='number'?Number(a)===Number(b):String(a)===String(b)));
function buildPosition(existing,input,{now,newId}){
 const errors=[];const n=v=>v===null||v===undefined||v===''?null:Number(v);
 const exec=input.executionDate,rate=n(input.originalExecutionRate),qty=n(input.originalQuantity);
 if(existing){
  for(const f of LOCKED_POSITION_FIELDS)if(!same(existing[f],input[f]))errors.push(`「${f}」は登録後に変更できません。約定情報を誤って登録した場合は、建玉を削除して登録し直してください（削除は操作履歴に残ります）。`);
  if(existing.status==='closed'&&input.status!=='closed')errors.push('決済済みの建玉を未決済に戻すには、通常の編集ではなく「決済の訂正」を使ってください（理由の入力が必要です）。');
 }else{
  if(!isDate(exec))errors.push('新規約定日を正しく入力してください。');
  if(!(rate!==null&&Number.isFinite(rate)&&rate>0))errors.push('固定約定レートは0より大きい数値で入力してください。');
  if(!(qty!==null&&Number.isFinite(qty)&&qty>0))errors.push('当初数量は0より大きい数値で入力してください。');
 }
 const status=input.status==='closed'?'closed':'open';
 const base=existing||{};const execDate=existing?existing.executionDate:exec;
 if(status==='closed'){
  if(!isDate(input.settlementDate)||!(n(input.settlementRate)>0))errors.push('全数量決済の場合は、決済日と決済レート（0より大きい値）を入力してください。');
  else if(isDate(execDate)&&input.settlementDate<execDate)errors.push('決済日が新規約定日より前です。');
 }
 for(const f of ['referenceRate','dailySwapAmount','accumulatedSwap','realizedProfitLoss','unrealizedProfitLoss','settlementRate']){const v=input[f];if(v!==null&&v!==undefined&&v!==''&&!Number.isFinite(Number(v)))errors.push(`「${f}」が数値ではありません。`);}
 if(errors.length)return {errors,position:null};
 const oq=existing?existing.originalQuantity:qty;
 const pos={...base,...input,
  positionId:existing?existing.positionId:(input.positionId||newId('position')),
  executionDate:execDate,openDate:execDate,originalExecutionRate:existing?existing.originalExecutionRate:rate,openPrice:existing?existing.originalExecutionRate:rate,originalQuantity:oq,
  status,closedQuantity:status==='closed'?oq:0,remainingQuantity:status==='closed'?0:oq,
  settlementDate:status==='closed'?input.settlementDate:null,settlementRate:status==='closed'?n(input.settlementRate):null,
  registeredAt:existing?.registeredAt||now,updatedAt:now};
 for(const f of ['referenceRate','dailySwapAmount','accumulatedSwap','realizedProfitLoss','unrealizedProfitLoss'])pos[f]=n(input[f]);
 return {errors,position:pos};
}
// 決済済み→未決済：独立した訂正操作。理由必須。変更前後を fxCorrections に残す
function reopenPosition(existing,reason,{now,newId}){
 const r=String(reason||'').trim();
 if(!existing)return {error:'対象の建玉が見つかりません。'};
 if(existing.status!=='closed')return {error:'この建玉は決済済みではありません。'};
 if(!r)return {error:'訂正の理由を入力してください。'};
 const after={...existing,status:'open',closedQuantity:0,remainingQuantity:existing.originalQuantity,settlementDate:null,settlementRate:null,realizedProfitLoss:null,updatedAt:now};
 const correction={correctionId:newId('correction'),positionId:existing.positionId,type:'reopen',reason:r,at:now,before:structuredClone(existing),after:structuredClone(after)};
 return {after,correction};
}


/* ================= 正規化JSON（dataType: personal_asset_management / schemaVersion 1）の取り込み =================
   一次資料の照合を前提に段階的に作られた中間形式。アプリ本来の形式とは別形式のため、検証→変換→「追加のみ」の統合を行う。
   原則：値は一切変更しない／JSONに無い情報は推測せず null のまま／既存データは上書き・削除しない／重複登録しない。 */
const CANON_VERSION=1;
const CANON_PASSTHROUGH_ID={sourceDocuments:'sourceDocumentId',fxPositionEvents:'eventId'};
const CANON_PASSTHROUGH=['sourceDocuments','fxPositionEvents','fxSwapRateHistory','fxAccountSwapSnapshots','investmentHoldings','investmentAccountSnapshots','investmentTransactions','cryptoHoldings','cryptoTransactions','cryptoAccountSnapshots','mortgageContracts','mortgageRateHistory','mortgageRepayments','mortgageBalanceSnapshots','auditLogs','migrationNotes','cashTransactions','fees'];
const CANON_MAPPED=['accounts','accountBalanceSnapshots','fxPositions'];
const CANON_META=['schemaVersion','dataType','formatStatus','createdAt','description','rules'];
const ACCOUNT_TYPES=['fx','bank','nisa','dc','ideco','crypto','mortgage','loan','other'];
function detectFormat(d){
 if(!d||typeof d!=='object'||Array.isArray(d))return {format:'invalid'};
 if(d.dataType==='personal_asset_management')return {format:'canonical',version:d.schemaVersion};
 if(d.dataType==='personal_asset_manager'||REQUIRED_ARRAYS.every(k=>Array.isArray(d[k])))return {format:'native',version:d.schemaVersion};
 return {format:'unknown'};
}
const isNumOrNull=v=>v===null||v===undefined||(typeof v==='number'&&Number.isFinite(v));
function validateCanonical(d,{existingAccountIds=[],existingPositionIds=[]}={}){
 const errors=[],warnings=[];const err=m=>errors.push(m),warn=m=>warnings.push(m);
 if(!d||typeof d!=='object'||Array.isArray(d))return {errors:['JSONの最上位がオブジェクトではありません。'],warnings,counts:{}};
 if(d.dataType!=='personal_asset_management')err(`dataType が「personal_asset_management」ではありません（${JSON.stringify(d.dataType)}）。`);
 if(!Number.isInteger(d.schemaVersion)||d.schemaVersion<1)err(`schemaVersion が不正です（${JSON.stringify(d.schemaVersion)}）。`);
 else if(d.schemaVersion>CANON_VERSION)err(`この形式の新しいバージョン（schemaVersion ${d.schemaVersion}）です。このアプリは正規化JSONの schemaVersion ${CANON_VERSION} までに対応しています。アプリを更新してから取り込んでください。`);
 if(!Array.isArray(d.accounts))err('必須の配列 accounts がありません、または配列ではありません。');
 for(const k of [...CANON_MAPPED,...CANON_PASSTHROUGH])if(d[k]!==undefined&&d[k]!==null&&!Array.isArray(d[k]))err(`${k} が配列ではありません。`);
 const arr=k=>Array.isArray(d[k])?d[k].filter(r=>r&&typeof r==='object'&&!Array.isArray(r)):[];
 for(const k of [...CANON_MAPPED,...CANON_PASSTHROUGH])(Array.isArray(d[k])?d[k]:[]).forEach((r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r))err(`${k}[${i}] がオブジェクトではありません。`);});
 const uniq=(k,idKey,required)=>{const seen=new Map();arr(k).forEach((r,i)=>{const id=r[idKey];if(id===undefined||id===null||id===''){if(required)err(`${k}[${i}] に ${idKey} がありません。`);return;}if(typeof id!=='string'){err(`${k}[${i}] の ${idKey} が文字列ではありません。`);return;}if(seen.has(id))err(`${k} の ${idKey}「${id}」が重複しています（${seen.get(id)+1}件目と${i+1}件目）。`);else seen.set(id,i);});return new Set(seen.keys());};
 const accIds=uniq('accounts','accountId',true),snapIds=uniq('accountBalanceSnapshots','snapshotId',true),posIds=uniq('fxPositions','positionId',true);uniq('fxPositionEvents','eventId',true);const srcIds=uniq('sourceDocuments','sourceDocumentId',true);
 const knownAcc=new Set([...accIds,...existingAccountIds]),knownPos=new Set([...posIds,...existingPositionIds]);
 const date=(k,i,f,v,nullable=true)=>{if(v===undefined||v===null||v===''){if(!nullable)err(`${k}[${i}].${f} がありません。`);return;}if(!isDate(v))err(`${k}[${i}].${f} が日付（YYYY-MM-DD）ではありません：${JSON.stringify(v)}`);};
 const ts=(k,i,f,v)=>{if(v===undefined||v===null||v==='')return;if(!isTs(v))err(`${k}[${i}].${f} が日時として読めません：${JSON.stringify(v)}`);};
 const num=(k,i,f,v)=>{if(!isNumOrNull(v))err(`${k}[${i}].${f} が数値ではありません：${JSON.stringify(v)}`);};
 const srcRefs=(k,i,r)=>{if(r.sourceDocumentIds===undefined||r.sourceDocumentIds===null)return;if(!Array.isArray(r.sourceDocumentIds)){err(`${k}[${i}].sourceDocumentIds が配列ではありません。`);return;}for(const s of r.sourceDocumentIds)if(!srcIds.has(s))warn(`${k}[${i}] が参照する原資料「${s}」が sourceDocuments にありません。`);};
 arr('accounts').forEach((a,i)=>{
  if(typeof a.accountName!=='string'||!a.accountName.trim())err(`accounts[${i}].accountName がありません。`);
  if(typeof a.accountType!=='string'||!a.accountType)err(`accounts[${i}].accountType がありません。`);else if(!ACCOUNT_TYPES.includes(a.accountType))warn(`accounts[${i}] の口座種別「${a.accountType}」はこのアプリの種別にありません。値は変更せずそのまま保持します。`);
  ts('accounts',i,'registeredAt',a.registeredAt);ts('accounts',i,'updatedAt',a.updatedAt);srcRefs('accounts',i,a);
 });
 arr('accountBalanceSnapshots').forEach((x,i)=>{
  if(!knownAcc.has(x.accountId))err(`accountBalanceSnapshots[${i}] が存在しない口座「${x.accountId}」を参照しています。`);
  date('accountBalanceSnapshots',i,'effectiveDate',x.effectiveDate,false);ts('accountBalanceSnapshots',i,'registeredAt',x.registeredAt);
  for(const f of ['cashBalance','accountValuation','netAssets','requiredMargin','unrealizedPnl','cumulativeSwap'])num('accountBalanceSnapshots',i,f,x[f]);srcRefs('accountBalanceSnapshots',i,x);
 });
 arr('fxPositions').forEach((p,i)=>{
  if(!knownAcc.has(p.accountId))err(`fxPositions[${i}] が存在しない口座「${p.accountId}」を参照しています。`);
  if(typeof p.currencyPair!=='string'||!p.currencyPair.trim())err(`fxPositions[${i}].currencyPair がありません。`);
  if(!['buy','sell'].includes(p.side))err(`fxPositions[${i}].side が buy/sell ではありません：${JSON.stringify(p.side)}`);
  if(!['open','closed'].includes(p.status))err(`fxPositions[${i}].status が open/closed ではありません：${JSON.stringify(p.status)}`);
  date('fxPositions',i,'executionDate',p.executionDate,false);date('fxPositions',i,'settlementDate',p.settlementDate);
  if(!(typeof p.originalQuantity==='number'&&Number.isFinite(p.originalQuantity)&&p.originalQuantity>0))err(`fxPositions[${i}].originalQuantity が0より大きい数値ではありません：${JSON.stringify(p.originalQuantity)}`);
  if(!(typeof p.originalExecutionRate==='number'&&Number.isFinite(p.originalExecutionRate)&&p.originalExecutionRate>0))err(`fxPositions[${i}].originalExecutionRate が0より大きい数値ではありません：${JSON.stringify(p.originalExecutionRate)}`);
  for(const f of ['lots','settlementRate','realizedPnl','finalSwap'])num('fxPositions',i,f,p[f]);
  if(p.status==='closed'){if(!p.settlementDate||p.settlementRate===null||p.settlementRate===undefined)warn(`fxPositions[${i}] は決済済みですが、決済日または決済レートが不明（null）です。不明のまま保持します。`);else if(isDate(p.settlementDate)&&isDate(p.executionDate)&&p.settlementDate<p.executionDate)err(`fxPositions[${i}] の決済日が約定日より前です。`);}
  else if(p.settlementDate||p.settlementRate)warn(`fxPositions[${i}] は未決済ですが決済日・決済レートが入力されています。値は変更せず保持します。`);
  ts('fxPositions',i,'registeredAt',p.registeredAt);ts('fxPositions',i,'updatedAt',p.updatedAt);srcRefs('fxPositions',i,p);
 });
 arr('fxPositionEvents').forEach((e,i)=>{
  if(!knownPos.has(e.positionId))err(`fxPositionEvents[${i}] が存在しない建玉「${e.positionId}」を参照しています。`);
  date('fxPositionEvents',i,'effectiveDate',e.effectiveDate,false);num('fxPositionEvents',i,'referenceRate',e.referenceRate);num('fxPositionEvents',i,'swapAmount',e.swapAmount);ts('fxPositionEvents',i,'registeredAt',e.registeredAt);
 });
 const known=new Set([...CANON_META,...CANON_MAPPED,...CANON_PASSTHROUGH]);
 for(const k of Object.keys(d))if(!known.has(k))warn(`未知のキー「${k}」があります。内容は取り込まず、変更もしません。`);
 const counts=Object.fromEntries([...CANON_MAPPED,...CANON_PASSTHROUGH].map(k=>[k,Array.isArray(d[k])?d[k].length:0]));
 return {errors,warnings,counts};
}

/* 変換：値は変更しない。JSONに無い項目は null/未設定のまま（推測しない）。 */
function convertCanonical(d,{importedAt}={}){
 const nz=v=>v===undefined?null:v;
 const events=(Array.isArray(d.fxPositionEvents)?d.fxPositionEvents:[]);
 const swapEvents=new Map();
 for(const e of events)if(e&&e.eventType==='swap_recorded'&&e.swapAmount!==null&&e.swapAmount!==undefined){if(!swapEvents.has(e.positionId))swapEvents.set(e.positionId,[]);swapEvents.get(e.positionId).push(e);}
 const notes=[];
 const accounts=(d.accounts||[]).map(a=>({accountId:a.accountId,accountName:a.accountName,institutionName:nz(a.institution),accountType:a.accountType,currency:nz(a.baseCurrency),status:nz(a.status),registeredAt:nz(a.registeredAt),updatedAt:nz(a.updatedAt),sourceDocumentIds:a.sourceDocumentIds||[],verificationStatus:nz(a.verificationStatus),importSource:'canonical-v1'}));
 const snapshots=(d.accountBalanceSnapshots||[]).map(x=>({snapshotId:x.snapshotId,accountId:x.accountId,snapshotDate:x.effectiveDate,currency:nz(x.currency),
  balance:nz(x.cashBalance),evaluationAmount:nz(x.accountValuation),netAssetValue:nz(x.netAssets),marginRequirement:nz(x.requiredMargin),unrealizedProfitLoss:nz(x.unrealizedPnl),accumulatedSwap:nz(x.cumulativeSwap),
  memo:nz(x.notes),registeredAt:nz(x.registeredAt),sourceDocumentIds:x.sourceDocumentIds||[],verificationStatus:nz(x.verificationStatus),importSource:'canonical-v1'}));
 const positions=(d.fxPositions||[]).map(p=>{
  const closed=p.status==='closed';const ev=swapEvents.get(p.positionId)||[];
  let acc=null,accSrc=null;
  if(ev.length===1){acc=ev[0].swapAmount;accSrc={eventId:ev[0].eventId,effectiveDate:ev[0].effectiveDate};}
  else if(ev.length>1)notes.push(`建玉 ${p.positionId} には swap_recorded イベントが${ev.length}件あるため、累積スワップは設定せず null のままにしました。`);
  return {positionId:p.positionId,accountId:p.accountId,currencyPair:p.currencyPair,side:p.side,status:p.status,
   executionDate:p.executionDate,openDate:p.executionDate,originalExecutionRate:p.originalExecutionRate,openPrice:p.originalExecutionRate,
   originalQuantity:p.originalQuantity,closedQuantity:closed?p.originalQuantity:0,remainingQuantity:closed?0:p.originalQuantity,
   settlementDate:nz(p.settlementDate),settlementRate:nz(p.settlementRate),realizedProfitLoss:nz(p.realizedPnl),
   referenceRate:null,dailySwapAmount:null,unrealizedProfitLoss:null,accumulatedSwap:acc,accumulatedSwapSource:accSrc,
   finalSwap:nz(p.finalSwap),quantityUnit:nz(p.quantityUnit),lots:nz(p.lots),memo:nz(p.notes),
   registeredAt:nz(p.registeredAt),updatedAt:nz(p.updatedAt),sourceDocumentIds:p.sourceDocumentIds||[],verificationStatus:nz(p.verificationStatus),importSource:'canonical-v1'};
 });
 const passthrough={};for(const k of CANON_PASSTHROUGH)passthrough[k]=Array.isArray(d[k])?d[k]:[];
 const meta=Object.fromEntries(CANON_META.filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
 return {accounts,snapshots,positions,passthrough,meta,notes,importedAt:importedAt||null};
}

/* 統合（追加のみ）。既存のデータは上書き・削除しない。
   - 口座：ID一致→同一口座として追加しない（内容が違えば競合として報告）／IDが違っても「口座名＋種別」が同じなら同一口座とみなし既存口座へ紐付け
   - 建玉：IDが同じなら追加しない。ID違いで「口座・通貨ペア・売買・約定日・数量・約定レート」が既存と一致する場合は、既存の件数分だけ重複とみなして追加しない
     （同じ日・同じレート・同じ数量の別建玉が複数ある実データがあるため、取り込みデータ内の同条件の建玉は1件にまとめない）
   - 残高記録：IDが同じ、または同じ口座・日付・全数値が同一なら追加しない。同日で数値が違えば別記録として追加（同日複数記録は許容） */
const normName=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const posKey=p=>JSON.stringify([p.accountId,p.currencyPair,p.side,p.executionDate||p.openDate||null,Number(p.originalQuantity),Number(p.originalExecutionRate??p.openPrice)]);
const SNAP_FIELDS=['balance','evaluationAmount','netAssetValue','marginRequirement','unrealizedProfitLoss','accumulatedSwap'];
const snapKey=x=>JSON.stringify([x.accountId,x.snapshotDate,...SNAP_FIELDS.map(f=>x[f]===undefined?null:x[f])]);
const deepEq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function mergeCanonical(state,conv){
 const rep={accounts:{added:0,skipped:0,aliased:0,conflicts:[]},positions:{added:0,skipped:0,possibleDuplicates:[],conflicts:[]},snapshots:{added:0,skipped:0,sameDayDifferent:[],conflicts:[]},preserved:{},unsupportedNonEmpty:[],notes:[...conv.notes]};
 for(const k of ['accounts','fxPositions','balanceSnapshots'])if(!Array.isArray(state[k]))state[k]=[];
 const alias=new Map();
 for(const a of conv.accounts){
  const byId=state.accounts.find(x=>x.accountId===a.accountId);
  if(byId){alias.set(a.accountId,a.accountId);rep.accounts.skipped++;
   const diff=['accountName','accountType'].filter(f=>String(byId[f]??'')!==String(a[f]??''));if(diff.length)rep.accounts.conflicts.push(`口座ID「${a.accountId}」は既に存在し、${diff.join('・')}が異なります。既存の値を維持し、上書きしませんでした。`);continue;}
  const byName=state.accounts.find(x=>normName(x.accountName)===normName(a.accountName)&&x.accountType===a.accountType);
  if(byName){alias.set(a.accountId,byName.accountId);rep.accounts.aliased++;rep.accounts.skipped++;rep.notes.push(`口座「${a.accountName}」は、既存の同名・同種別の口座（ID ${byName.accountId}）と同一とみなし、新しい口座は作成せず既存口座へ紐付けました。`);continue;}
  state.accounts.push(structuredClone(a));alias.set(a.accountId,a.accountId);rep.accounts.added++;
 }
 const importIds=new Set(conv.positions.map(p=>p.positionId));
 const fresh=[];
 for(const p0 of conv.positions){
  const p={...p0,accountId:alias.get(p0.accountId)||p0.accountId};
  const byId=state.fxPositions.find(x=>x.positionId===p.positionId);
  if(byId){rep.positions.skipped++;
   const diff=['currencyPair','side','executionDate','originalQuantity','originalExecutionRate'].filter(f=>String(byId[f]??'')!==String(p[f]??''));
   if(diff.length)rep.positions.conflicts.push(`建玉ID「${p.positionId}」は既に存在し、${diff.join('・')}が異なります。既存の値を維持しました。`);continue;}
  fresh.push(p);
 }
 const groups=new Map();for(const p of fresh){const k=posKey(p);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
 for(const [k,list] of groups){
  const existing=state.fxPositions.filter(x=>!importIds.has(x.positionId)&&posKey(x)===k);
  const skip=Math.min(list.length,existing.length);
  list.forEach((p,i)=>{if(i<skip){rep.positions.skipped++;rep.positions.possibleDuplicates.push(`建玉「${p.positionId}」は、既存の建玉「${existing[i].positionId}」と口座・通貨ペア・約定日・数量・約定レートが一致するため、重複として追加しませんでした。`);}
   else{state.fxPositions.push(structuredClone(p));rep.positions.added++;}});
 }
 for(const x0 of conv.snapshots){
  const x={...x0,accountId:alias.get(x0.accountId)||x0.accountId};
  const byId=state.balanceSnapshots.find(y=>y.snapshotId===x.snapshotId);
  if(byId){rep.snapshots.skipped++;if(snapKey(byId)!==snapKey(x))rep.snapshots.conflicts.push(`残高記録ID「${x.snapshotId}」は既に存在し、数値が異なります。既存の値を維持しました。`);continue;}
  if(state.balanceSnapshots.some(y=>snapKey(y)===snapKey(x))){rep.snapshots.skipped++;continue;}
  if(state.balanceSnapshots.some(y=>y.accountId===x.accountId&&y.snapshotDate===x.snapshotDate))rep.snapshots.sameDayDifferent.push(`口座「${x.accountId}」の${x.snapshotDate}には数値の異なる既存の残高記録があります。上書きせず、別の記録として追加しました。`);
  state.balanceSnapshots.push(structuredClone(x));rep.snapshots.added++;
 }
 // 原データの保持：アプリに表示用の項目が無い配列も、JSONに含まれる内容は失わない（canonicalData に追加のみで保持）
 const cd=state.canonicalData&&typeof state.canonicalData==='object'?state.canonicalData:(state.canonicalData={});
 for(const [k,list] of Object.entries(conv.passthrough)){
  const idKey=CANON_PASSTHROUGH_ID[k];const cur=Array.isArray(cd[k])?cd[k]:(cd[k]=[]);const r={added:0,skipped:0,conflicts:[]};
  for(const item of list){
   if(idKey&&item[idKey]){const ex=cur.find(y=>y[idKey]===item[idKey]);if(ex){r.skipped++;if(!deepEq(ex,item))r.conflicts.push(`${k} の ${idKey}「${item[idKey]}」は既に存在し内容が異なります。既存を維持しました。`);continue;}}
   else if(cur.some(y=>deepEq(y,item))){r.skipped++;continue;}
   cur.push(structuredClone(item));r.added++;
  }
  rep.preserved[k]=r;
  if(list.length&&!['sourceDocuments','fxPositionEvents','migrationNotes'].includes(k))rep.unsupportedNonEmpty.push(`${k}（${list.length}件）`);
 }
 if(!cd.meta)cd.meta=structuredClone(conv.meta);
 if(!Array.isArray(cd.importedFiles))cd.importedFiles=[];
 rep.totalAdded=rep.accounts.added+rep.positions.added+rep.snapshots.added+Object.values(rep.preserved).reduce((s,r)=>s+r.added,0);
 return rep;
}

const api={CANON_VERSION,detectFormat,validateCanonical,convertCanonical,mergeCanonical,SCHEMA_VERSION,REQUIRED_ARRAYS,OPTIONAL_ARRAYS,NEW_ARRAYS_V5,ALL_ARRAYS,ID_KEYS,LOCKED_POSITION_FIELDS,migrateState,checkIntegrity,newProblems,accountReferences,validateImport,countsOf,lostByReplace,isDate,buildPosition,reopenPosition};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PAMStore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
