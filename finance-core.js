'use strict';
/* finance-core.js — 資金移動・資産集計・時系列・スワップ按分の計算（画面・DBに依存しない純粋関数）
   ブラウザでは window.PAMFin、Nodeでは module.exports として公開する。 */
(function(root){
const live=a=>(Array.isArray(a)?a:[]).filter(r=>r&&!r.deletedAt);

/* ---------- 資金移動・手数料 ----------
   取引種別：transfer=内部振替 / deposit=外部入金 / withdrawal=外部出金 / fee=単独の手数料
   feeMode：additional=金額とは別に手数料を支払う / deducted=金額から手数料を差し引く
   feeAccountId=手数料を負担する口座（第三の口座でもよい） */
function cashEffect(t,accountId){
 if(t.deletedAt)return 0;
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
function cashNetByCurrency(transactions,accountId){const totals={};for(const t of live(transactions)){const c=t.currency||'JPY';totals[c]=(totals[c]||0)+cashEffect(t,accountId);}return totals;}
// 管理口座全体（外部を除く）での増減。内部振替は手数料分のみ減り、金額は二重計上されない
function totalEffect(t,accountIds){return accountIds.reduce((s,id)=>s+cashEffect(t,id),0);}

/* ---------- 資産・負債・純資産の集計 ----------
   口座ごとに「最も新しい評価」を1つだけ採用する（残高記録と時系列履歴を足し合わせない＝二重計上防止）。
   データがない口座は 0 ではなく「データなし」として扱い、合計に含めない。 */
const LIABILITY_TYPES=['loan','mortgage'];
function num(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);}
function snapshotValue(type,s){
 if(type==='bank'||LIABILITY_TYPES.includes(type))return num(s.balance)??num(s.evaluationAmount);
 if(type==='fx')return num(s.netAssetValue)??num(s.balance)??num(s.evaluationAmount);
 return num(s.evaluationAmount)??num(s.balance);
}
function latest(list,dateOf){return list.slice().sort((a,b)=>String(dateOf(a)).localeCompare(String(dateOf(b)))||String(a.registeredAt||'').localeCompare(String(b.registeredAt||'')))[list.length-1];}
function tsDate(r){return r.effectiveDate||(r.effectiveAt?String(r.effectiveAt).slice(0,10):'');}
function accountCandidates(state,a){
 const out=[];
 const snaps=live(state.balanceSnapshots).filter(s=>s.accountId===a.accountId&&s.snapshotDate);
 const ls=snaps.length?latest(snaps,s=>s.snapshotDate):null;
 if(ls){const v=snapshotValue(a.accountType,ls);if(v!==null)out.push({value:v,asOf:ls.snapshotDate,source:'残高記録',rank:1});}
 const ts=live(state.timeSeriesRecords).filter(r=>r.accountId===a.accountId&&r.values);
 const pick=(types,fn)=>{const rs=ts.filter(r=>types.includes(r.recordType));if(!rs.length)return null;const l=latest(rs.filter(r=>fn(r)!==null),tsDate);return l?{rec:l,v:fn(l)}:null;};
 if(a.accountType==='bank'||LIABILITY_TYPES.includes(a.accountType)){const p=pick(['bank_balance'],r=>num(r.values.balance));if(p)out.push({value:p.v,asOf:tsDate(p.rec),source:'時系列履歴',rank:2});}
 else if(a.accountType==='fx'){const p=pick(['account_snapshot'],r=>num(r.values.netAssetValue)??num(r.values.balance));if(p)out.push({value:p.v,asOf:tsDate(p.rec),source:'時系列履歴',rank:2});}
 else if(a.accountType==='crypto'){
  const rs=ts.filter(r=>r.recordType==='crypto_snapshot'&&num(r.values.valuation)!==null);
  if(rs.length){const byAsset=new Map();for(const r of rs){const k=r.entityId||'';const o=byAsset.get(k);if(!o||tsDate(r)>=tsDate(o))byAsset.set(k,r);}
   const jpy=latest(ts.filter(r=>r.recordType==='crypto_snapshot'&&num(r.values.jpyBalance)!==null),tsDate);
   const sum=[...byAsset.values()].reduce((s,r)=>s+num(r.values.valuation),0)+(jpy?num(jpy.values.jpyBalance):0);
   out.push({value:sum,asOf:[...byAsset.values()].map(tsDate).sort().pop(),source:'時系列履歴（資産別の最新評価の合計）',rank:2});}
 }else{ // 証券・NISA・iDeCo・企業型DC・その他：評価額＋口座内現金（評価額には現金を含めない定義）
  const p=pick(['securities_snapshot'],r=>num(r.values.valuation));
  if(p)out.push({value:p.v+(num(p.rec.values.cashBalance)||0),asOf:tsDate(p.rec),source:'時系列履歴',rank:2});
 }
 if(!out.length){
  const hs=live(state.holdings).filter(h=>h.accountId===a.accountId&&num(h.currentEvaluationAmount)!==null);
  if(hs.length)out.push({value:hs.reduce((s,h)=>s+num(h.currentEvaluationAmount),0),asOf:hs.map(h=>h.confirmationDate||'').sort().pop()||'',source:'保有資産の評価額合計',rank:0});
 }
 return out;
}
function summarizeAssets(state){
 const rows=[];let asset=0,liability=0,missing=0,excluded=0;
 for(const a of live(state.accounts)){
  const isLiab=LIABILITY_TYPES.includes(a.accountType);
  const cands=accountCandidates(state,a).sort((x,y)=>String(y.asOf).localeCompare(String(x.asOf))||y.rank-x.rank);
  const best=cands[0]||null;
  const cur=a.currency||'JPY';
  const row={accountId:a.accountId,name:a.accountName||a.accountId,type:a.accountType,kind:isLiab?'liability':'asset',value:best?(isLiab?Math.abs(best.value):best.value):null,asOf:best?.asOf||null,source:best?.source||null,currency:cur};
  if(!best)missing++;
  else if(cur!=='JPY'){row.excluded=true;excluded++;}
  else if(isLiab)liability+=row.value;else asset+=row.value;
  rows.push(row);
 }
 return {rows,totals:{asset,liability,net:asset-liability},missing,excluded};
}

/* ---------- 時系列：欠損を補間しない ----------
   同じ対象日に複数の記録がある場合は、登録日時が最も新しいものを採用。
   隣り合う点の間隔が maxGapDays を超える場合、線で結ばず「欠損」として区間を分ける。 */
function daysBetween(a,b){const pa=a.split('-').map(Number),pb=b.split('-').map(Number);return Math.round((Date.UTC(pb[0],pb[1]-1,pb[2])-Date.UTC(pa[0],pa[1]-1,pa[2]))/86400000);}
function buildSeries(records,{valueOf,from=null,to=null,maxGapDays=null}){
 const byDate=new Map();
 for(const r of live(records)){const d=tsDate(r);if(!d)continue;if(from&&d<from)continue;if(to&&d>to)continue;const v=valueOf(r);if(v===null||v===undefined||!Number.isFinite(Number(v)))continue;
  const o=byDate.get(d);if(!o||String(r.registeredAt||'')>=String(o.registeredAt||''))byDate.set(d,{date:d,value:Number(v),registeredAt:r.registeredAt||'',recordId:r.recordId});}
 const points=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const segments=[],gaps=[];let cur=[];
 for(const p of points){
  if(cur.length){const g=daysBetween(cur[cur.length-1].date,p.date);if(maxGapDays!==null&&g>maxGapDays){gaps.push({from:cur[cur.length-1].date,to:p.date,days:g});segments.push(cur);cur=[];}}
  cur.push(p);
 }
 if(cur.length)segments.push(cur);
 return {points,segments,gaps};
}

/* ---------- FXスワップ按分（推定値） ----------
   配分ウェイト = 建玉数量 × 対象期間の保有日数
   建玉別推定スワップ = 口座全体の期間スワップ変動額 × ウェイト ÷ 全建玉ウェイト合計
   端数（按分できない差額）は口座単位の未配分スワップとして残す。結果は常に推定値。
   ※保有日数の数え方（ロールオーバー基準日等）は未確定のため、期間と建玉の重なり日数(終了日−開始日)で近似する。 */
function holdingDays(pos,start,end){
 const s=pos.executionDate&&pos.executionDate>start?pos.executionDate:start;
 const e=pos.status==='closed'&&pos.settlementDate&&pos.settlementDate<end?pos.settlementDate:end;
 return Math.max(0,daysBetween(s,e));
}
function allocateSwap({periodSwapDelta,positions,start,end,decimals=0}){
 const f=Math.pow(10,decimals);
 const items=positions.map(p=>({positionId:p.positionId,quantity:Number(p.originalQuantity||0),days:holdingDays(p,start,end)}));
 items.forEach(i=>{i.weight=i.quantity*i.days;});
 const total=items.reduce((s,i)=>s+i.weight,0);
 let allocated=0;
 for(const i of items){i.estimated=total>0?Math.round(periodSwapDelta*i.weight/total*f)/f:0;i.isEstimate=true;allocated+=i.estimated;}
 return {allocations:items,totalWeight:total,allocated,unallocated:Math.round((periodSwapDelta-allocated)*f)/f,kind:'estimate',periodSwapDelta};
}
const swapAmount=(unitPer10k,quantity)=>Number(unitPer10k)*Number(quantity)/10000;

const api={live,cashEffect,cashNetByCurrency,totalEffect,summarizeAssets,daysBetween,buildSeries,holdingDays,allocateSwap,swapAmount,LIABILITY_TYPES};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PAMFin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
