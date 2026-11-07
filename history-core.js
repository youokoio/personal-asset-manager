'use strict';
/* history-core.js — 履歴一括入力の中核ロジック（画面・DBに依存しない純粋関数）
   ブラウザでは window.PAMCore、Nodeでは module.exports として公開する。 */
(function(root){
const EDIT_HISTORY_LIMIT=10000;

/* ---------- 値項目の定義（表示ラベル・書式） ---------- */
// fmt: yen=円 / num=数値 / rate=レート・単価 / qty=数量
const VALUE_LABELS={
 amount:{label:'金額',fmt:'yen'},quantity:{label:'数量',fmt:'qty'},rate:{label:'レート',fmt:'rate'},profitLoss:{label:'損益',fmt:'yen'},swap:{label:'スワップ',fmt:'yen'},
 openingBalance:{label:'開始残高',fmt:'yen'},deposit:{label:'入金',fmt:'yen'},withdrawal:{label:'出金',fmt:'yen'},adjustment:{label:'調整額',fmt:'yen'},balance:{label:'残高',fmt:'yen'},
 referenceRate:{label:'参考レート',fmt:'rate'},netAssetValue:{label:'純資産',fmt:'yen'},marginRequirement:{label:'必要証拠金',fmt:'yen'},positionQuantity:{label:'建玉数量',fmt:'qty'},fxProfitLoss:{label:'為替差損益',fmt:'yen'},accumulatedSwap:{label:'累計スワップ',fmt:'yen'},
 cumulativePrincipal:{label:'累計元本',fmt:'yen'},effectivePrincipal:{label:'有効元本',fmt:'yen'},realizedProfitLoss:{label:'累計確定損益',fmt:'yen'},unrealizedProfitLoss:{label:'含み損益',fmt:'yen'},valuation:{label:'評価額',fmt:'yen'},cashBalance:{label:'現金残高',fmt:'yen'},
 referencePrice:{label:'参考価格',fmt:'rate'},jpyBalance:{label:'取引所内日本円残高',fmt:'yen'}
};

/* ---------- 入力テンプレート ---------- */
const f=(key,label,opt={})=>Object.assign({key,label},opt);
const TEMPLATES={
 bank:{id:'bank',label:'銀行口座',recordType:'bank_balance',fields:[
  f('openingBalance','開始残高',{signed:true}),f('deposit','入金',{min:0}),f('withdrawal','出金',{min:0}),f('adjustment','調整額',{signed:true}),f('balance','終了残高',{signed:true})]},
 fx:{id:'fx',label:'FX口座スナップショット',recordType:'account_snapshot',fields:[
  f('referenceRate','参考為替レート',{min:0}),f('balance','口座残高',{signed:true}),f('netAssetValue','純資産',{signed:true}),f('marginRequirement','必要証拠金',{min:0}),f('positionQuantity','建玉数量',{min:0}),f('fxProfitLoss','為替差損益',{signed:true}),f('accumulatedSwap','累計スワップ残高',{signed:true})]},
 securities:{id:'securities',label:'証券口座（楽天証券など）',recordType:'securities_snapshot',fields:[
  f('cumulativePrincipal','累計買付元本',{min:0}),f('effectivePrincipal','有効元本',{signed:true}),f('realizedProfitLoss','累計確定損益',{signed:true}),f('unrealizedProfitLoss','含み損益',{signed:true}),f('valuation','口座評価額',{signed:true}),f('cashBalance','現金残高',{signed:true})]},
 dc:{id:'dc',label:'iDeCo・企業型DC',recordType:'securities_snapshot',fields:[
  f('cumulativePrincipal','累計拠出元本',{min:0}),f('effectivePrincipal','有効元本',{signed:true}),f('realizedProfitLoss','累計確定損益',{signed:true}),f('unrealizedProfitLoss','含み損益',{signed:true}),f('valuation','評価額',{signed:true})]},
 crypto:{id:'crypto',label:'暗号資産取引所',recordType:'crypto_snapshot',entity:{label:'資産',options:['BTC','SOL'],required:true},fields:[
  f('quantity','保有数量',{min:0}),f('referencePrice','参考価格',{min:0}),f('valuation','評価額',{signed:true}),f('effectivePrincipal','有効元本',{signed:true}),f('unrealizedProfitLoss','含み損益',{signed:true}),f('realizedProfitLoss','累計確定損益',{signed:true}),f('jpyBalance','取引所内日本円残高',{signed:true})]}
};
// 既存の口座種別から既定テンプレートを推定する（口座種別自体は変更しない）。最終的な選択は利用者が行う。
function templateIdForAccountType(t){return (t==='bank'||t==='mortgage'||t==='loan')?'bank':t==='fx'?'fx':(t==='ideco'||t==='dc')?'dc':t==='crypto'?'crypto':'securities';}

/* ---------- 数値・日付 ---------- */
function parseNum(raw){
 if(raw===null||raw===undefined)return null;
 if(typeof raw==='number')return Number.isFinite(raw)?raw:NaN;
 let s=String(raw).trim();if(s==='')return null;
 s=s.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[．]/g,'.').replace(/[，,\s]/g,'').replace(/[−－ー―‐]/g,'-').replace(/円$/,'');
 if(!/^[+-]?\d+(\.\d+)?$/.test(s)&&!/^[+-]?\.\d+$/.test(s))return NaN;
 const n=Number(s);return Number.isFinite(n)?n:NaN;
}
const round=(n,d=8)=>Number(Number(n).toFixed(d));
const pad2=n=>String(n).padStart(2,'0');
function localDateString(d){return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;}
function isValidDateString(s){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||''));if(!m)return false;
 const y=+m[1],mo=+m[2],d=+m[3],dt=new Date(y,mo-1,d);return dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d;
}
function dateToEffectiveAt(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,0,0,0,0).toISOString();}
// 記録の「対象日」（YYYY-MM-DD）。旧データ（effectiveDateなし）は effectiveAt から端末の現地日付で導出する。
function tsDate(r){if(!r)return '';if(r.effectiveDate)return r.effectiveDate;const d=new Date(r.effectiveAt);return Number.isNaN(d.getTime())?'':localDateString(d);}

/* ---------- 自動計算（欠けた1項目を補完。全項目が揃っていて不一致なら警告のみで上書きしない） ---------- */
function computeDerived(templateId,values){
 const v={...values},derived=[],warnings=[];const has=k=>v[k]!==null&&v[k]!==undefined;
 const tol=0.5;
 if(templateId==='bank'){
  const ks=['openingBalance','deposit','withdrawal','adjustment','balance'];const miss=ks.filter(k=>!has(k));
  const sum=()=>v.openingBalance+v.deposit-v.withdrawal+v.adjustment;
  if(miss.length===1){const k=miss[0];
   if(k==='balance')v.balance=sum();
   else if(k==='openingBalance')v.openingBalance=v.balance-v.deposit+v.withdrawal-v.adjustment;
   else if(k==='deposit')v.deposit=v.balance-v.openingBalance+v.withdrawal-v.adjustment;
   else if(k==='withdrawal')v.withdrawal=v.openingBalance+v.deposit+v.adjustment-v.balance;
   else if(k==='adjustment')v.adjustment=v.balance-v.openingBalance-v.deposit+v.withdrawal;
   v[k]=round(v[k]);derived.push(k);
   if(k==='deposit'&&v.deposit<0)warnings.push('逆算した入金額がマイナスです。入力値を確認してください。');
   if(k==='withdrawal'&&v.withdrawal<0)warnings.push('逆算した出金額がマイナスです。入力値を確認してください。');
  }else if(miss.length===0&&Math.abs(sum()-v.balance)>tol)warnings.push(`終了残高が「開始残高＋入金−出金＋調整額」(${round(sum())})と一致しません。`);
 }
 if(templateId==='securities'||templateId==='dc'){
  const cash=templateId==='securities'&&has('cashBalance')?v.cashBalance:0;
  const ks=['effectivePrincipal','unrealizedProfitLoss','valuation'];const miss=ks.filter(k=>!has(k));
  if(miss.length===1){const k=miss[0];
   if(k==='valuation')v.valuation=v.effectivePrincipal+v.unrealizedProfitLoss+cash;
   else if(k==='effectivePrincipal')v.effectivePrincipal=v.valuation-cash-v.unrealizedProfitLoss;
   else v.unrealizedProfitLoss=v.valuation-cash-v.effectivePrincipal;
   v[k]=round(v[k]);derived.push(k);
   if(templateId==='securities'&&!has('cashBalance'))warnings.push('現金残高が未入力のため、現金0円として計算しました。');
  }else if(miss.length===0&&Math.abs(v.effectivePrincipal+v.unrealizedProfitLoss+cash-v.valuation)>tol)warnings.push(`評価額が「有効元本＋含み損益${templateId==='securities'?'＋現金残高':''}」(${round(v.effectivePrincipal+v.unrealizedProfitLoss+cash)})と一致しません。`);
 }
 if(templateId==='crypto'){
  const ks=['quantity','referencePrice','valuation'];const miss=ks.filter(k=>!has(k));
  if(miss.length===1){const k=miss[0];
   if(k==='valuation')v.valuation=round(v.quantity*v.referencePrice,4);
   else if(k==='quantity'){if(v.referencePrice===0){warnings.push('参考価格が0のため保有数量を計算できません。');}else{v.quantity=round(v.valuation/v.referencePrice,8);derived.push(k);}}
   else{if(v.quantity===0){warnings.push('保有数量が0のため参考価格を計算できません。');}else{v.referencePrice=round(v.valuation/v.quantity,4);derived.push(k);}}
   if(k==='valuation')derived.push(k);
  }else if(miss.length===0&&Math.abs(v.quantity*v.referencePrice-v.valuation)>Math.max(tol,Math.abs(v.valuation)*0.001))warnings.push(`評価額が「保有数量×参考価格」(${round(v.quantity*v.referencePrice,2)})と一致しません。`);
 }
 return {values:v,derived,warnings};
}

/* ---------- 一括登録・編集の計画作成 ---------- */
const VALUE_KINDS=['actual','manual_historical','estimate','calculated','simulation'];
const norm=x=>x===undefined||x===''?null:x;
function sameNum(a,b){a=a==null?null:Number(a);b=b==null?null:Number(b);return a===b;}
/* rows: [{recordId|null, base(updatedAt), date, entityId, values:{key:rawString}, memo, valueKind, delete}]
   ctx: {records, accountId, templateId, rows, defaultKind, reason, batchId, now, newId, today}
   戻り値: {errors, warnings, items, counts}。DB・stateは一切変更しない。 */
function planBatch(ctx){
 const tpl=TEMPLATES[ctx.templateId];const errors=[],warnings=[],items=[];
 if(!tpl)return {errors:[{row:-1,msg:'入力テンプレートが不正です。'}],warnings,items,counts:{create:0,edit:0,delete:0,unchanged:0}};
 if(!ctx.accountId)errors.push({row:-1,msg:'口座を選択してください。'});
 const byId=new Map((ctx.records||[]).map(r=>[r.recordId,r]));
 const today=ctx.today||localDateString(new Date());
 const seen=new Map();const touched=new Set();
 const sigOf=(rec,fieldKeys)=>JSON.stringify([rec.recordType,rec.accountId,rec.entityId||'',tsDate(rec),fieldKeys.map(k=>{const v=rec.values?.[k];return v===null||v===undefined?null:Number(v);})]);
 const fkeys=tpl.fields.map(fd=>fd.key);
 const liveSame=(ctx.records||[]).filter(r=>!r.deletedAt&&r.accountId===ctx.accountId&&r.recordType===tpl.recordType);
 const batchSigs=new Map();
 (ctx.rows||[]).forEach((row,i)=>{
  const raw=row.values||{};const date=String(row.date||'').trim();
  const anyValue=tpl.fields.some(fd=>String(raw[fd.key]??'').trim()!=='');
  const existing=row.recordId?byId.get(row.recordId):null;
  if(row.recordId&&!existing){errors.push({row:i,msg:'編集対象の記録が見つかりません。再読み込みしてください。'});return;}
  if(existing){
   touched.add(existing.recordId);
   if(existing.deletedAt){errors.push({row:i,msg:'この記録は既に削除されています。'});return;}
   if(existing.accountId!==ctx.accountId||existing.recordType!==tpl.recordType){errors.push({row:i,msg:'選択中の口座・テンプレートと記録が一致しません。'});return;}
   if(row.base&&existing.updatedAt&&row.base!==existing.updatedAt){errors.push({row:i,msg:'読み込み後に他の操作でこの記録が更新されています。再読み込みしてください。'});return;}
  }
  if(row.delete){
   if(!existing){return;} // 新規行の削除フラグは単に無視（行ごと破棄）
   items.push({row:i,action:'delete',recordId:existing.recordId,before:structuredClone(existing),after:null,changes:[],derived:[]});return;
  }
  if(!existing&&date===''&&!anyValue&&String(row.memo||'').trim()==='')return; // 完全な空行は無視
  if(!isValidDateString(date)){errors.push({row:i,msg:'対象日を正しく入力してください。'});return;}
  const parsed={};let bad=false;
  for(const fd of tpl.fields){
   const n=parseNum(raw[fd.key]);
   if(Number.isNaN(n)){errors.push({row:i,msg:`「${fd.label}」が数値ではありません。`});bad=true;continue;}
   if(n!==null&&fd.min!==undefined&&n<fd.min){errors.push({row:i,msg:`「${fd.label}」は${fd.min}以上で入力してください。`});bad=true;continue;}
   parsed[fd.key]=n;
  }
  if(bad)return;
  const entityId=tpl.entity?(norm(row.entityId)):(norm(row.entityId)??existing?.entityId??null);
  if(tpl.entity?.required&&!entityId){errors.push({row:i,msg:`「${tpl.entity.label}」を選択してください。`});return;}
  if(tpl.entity&&entityId&&!tpl.entity.options.includes(entityId)){errors.push({row:i,msg:`「${tpl.entity.label}」が不正です。`});return;}
  const hasOther=!!existing&&Object.entries(existing.values||{}).some(([k,v])=>!tpl.fields.some(fd=>fd.key===k)&&v!==null&&v!==undefined);
  if(!hasOther&&!tpl.fields.some(fd=>parsed[fd.key]!==null)){errors.push({row:i,msg:'数値が1つも入力されていません。（削除する場合は削除を選択）'});return;}
  const calc=computeDerived(tpl.id,parsed);
  calc.warnings.forEach(m=>warnings.push({row:i,msg:m}));
  const kind=VALUE_KINDS.includes(row.valueKind)?row.valueKind:(existing?.valueKind||ctx.defaultKind||'manual_historical');
  const memo=String(row.memo||'').trim();
  { // 重複登録の防止：同じ口座・種別・対象日・資産・数値の記録が既にある／同じ一括内に重複がある場合は保存させない
   const probe={recordType:tpl.recordType,accountId:ctx.accountId,entityId:entityId||null,effectiveDate:date,values:calc.values};const sig=sigOf(probe,fkeys);
   const dupExisting=liveSame.find(r=>r.recordId!==(existing&&existing.recordId)&&sigOf(r,fkeys)===sig);
   if(dupExisting){errors.push({row:i,msg:`同じ内容の記録が既に登録されています（対象日 ${date}）。重複登録を防ぐため保存できません。`});return;}
   if(batchSigs.has(sig)){errors.push({row:i,msg:`${batchSigs.get(sig)+1}行目と同じ内容です。重複登録を防ぐため保存できません。`});return;}
   batchSigs.set(sig,i);
  }
  if(date>today)warnings.push({row:i,msg:'対象日が未来の日付です。'});
  const dupKey=`${date}|${entityId||''}`;if(seen.has(dupKey))warnings.push({row:i,msg:`同じ対象日（${date}）の行が${seen.get(dupKey)+1}行目にもあります。（同日に複数回の登録は可能です）`});else seen.set(dupKey,i);
  if(existing){
   const keep=tsDate(existing)===date; // 日付が同じなら元の日時（時刻を含む）を保持
   const after={...existing,entityId,valueKind:kind,memo,values:{...(existing.values||{}),...calc.values},derivedFields:calc.derived.length?calc.derived:undefined,
    effectiveAt:keep?existing.effectiveAt:dateToEffectiveAt(date),effectiveDate:date,datePrecision:keep?(existing.datePrecision||'datetime'):'date',updatedAt:ctx.now,batchId:ctx.batchId};
   if(after.derivedFields===undefined)delete after.derivedFields;
   const changes=[];
   if(tsDate(existing)!==date)changes.push({key:'対象日',from:tsDate(existing),to:date});
   if((existing.entityId||null)!==(entityId||null))changes.push({key:'資産',from:existing.entityId||'—',to:entityId||'—'});
   for(const fd of tpl.fields)if(!sameNum(existing.values?.[fd.key],after.values[fd.key]))changes.push({key:fd.label,from:existing.values?.[fd.key]??null,to:after.values[fd.key]??null,fmt:VALUE_LABELS[fd.key]?.fmt});
   if(existing.valueKind!==kind)changes.push({key:'区分',from:existing.valueKind,to:kind});
   if((existing.memo||'')!==memo)changes.push({key:'メモ',from:existing.memo||'',to:memo});
   if(!changes.length){items.push({row:i,action:'unchanged',recordId:existing.recordId,before:existing,after:existing,changes:[],derived:calc.derived});return;}
   items.push({row:i,action:'edit',recordId:existing.recordId,before:structuredClone(existing),after,changes,derived:calc.derived,baseUpdatedAt:existing.updatedAt||null});
  }else{
   const rec={recordId:ctx.newId('ts'),recordType:tpl.recordType,accountId:ctx.accountId,entityId:entityId||null,effectiveAt:dateToEffectiveAt(date),effectiveDate:date,datePrecision:'date',
    registeredAt:ctx.now,updatedAt:ctx.now,timezone:ctx.timezone||'Asia/Tokyo',valueKind:kind,source:'bulk',values:calc.values,memo,deletedAt:null,batchId:ctx.batchId};
   if(calc.derived.length)rec.derivedFields=calc.derived;
   items.push({row:i,action:'create',recordId:rec.recordId,before:null,after:rec,changes:[],derived:calc.derived});
  }
 });
 // 過去日付の登録・修正：その日より後に記録がある場合は、後続データへの影響を確認できるよう通知する
 for(const it of items.filter(x=>x.action==='create'||x.action==='edit'||x.action==='delete')){
  const rec=it.after||it.before,d=tsDate(rec);
  const later=(ctx.records||[]).filter(r=>!r.deletedAt&&r.accountId===ctx.accountId&&r.recordType===tpl.recordType&&(r.entityId||null)===(rec.entityId||null)&&tsDate(r)>d&&r.recordId!==it.recordId);
  it.laterCount=later.length;
  if(later.length)warnings.push({row:it.row,msg:`対象日 ${d} より後に ${later.length} 件の記録があります（最新 ${tsDate(later.sort((a,b)=>tsDate(a).localeCompare(tsDate(b))).pop())}）。この変更が後続の残高・評価額の連続性に影響しないか確認してください。`});
 }
 // 同じ口座・種別・対象日に、今回の一覧に含まれない既存記録がある場合の情報
 const inGrid=new Set((ctx.rows||[]).map(r=>r.recordId).filter(Boolean));
 for(const it of items.filter(x=>x.action==='create'||x.action==='edit')){
  const d=tsDate(it.after);
  const others=(ctx.records||[]).filter(r=>!r.deletedAt&&r.accountId===ctx.accountId&&r.recordType===tpl.recordType&&!inGrid.has(r.recordId)&&tsDate(r)===d&&(r.entityId||null)===(it.after.entityId||null));
  if(others.length)warnings.push({row:it.row,msg:`同じ対象日に既存の記録が${others.length}件あります。（同日に複数回の登録は可能です）`});
 }
 const counts={create:0,edit:0,delete:0,unchanged:0};items.forEach(x=>counts[x.action]++);
 return {errors,warnings,items,counts,accountId:ctx.accountId,templateId:ctx.templateId,batchId:ctx.batchId,reason:ctx.reason||'',now:ctx.now};
}

/* ---------- 計画の適用（stateの複製に対して実行すること） ---------- */
function applyPlan(state,plan,newId){
 if(plan.errors.length)throw Error('エラーのある計画は適用できません。');
 state.timeSeriesRecords=Array.isArray(state.timeSeriesRecords)?state.timeSeriesRecords:[];
 state.timeSeriesRevisions=Array.isArray(state.timeSeriesRevisions)?state.timeSeriesRevisions:[];
 state.editHistory=Array.isArray(state.editHistory)?state.editHistory:[];
 if(state.editHistory.some(h=>h.recordType==='bulkHistory'&&h.recordId===plan.batchId))throw Error('この一括操作は既に保存済みです（二重保存の防止）。');
 const act=plan.items.filter(x=>x.action!=='unchanged');
 // 1) すべて検証してから、2) 変更する（途中失敗で半端な状態にしない）
 for(const it of act){
  if(it.action==='create')continue;
  const cur=state.timeSeriesRecords.find(r=>r.recordId===it.recordId);
  if(!cur||cur.deletedAt)throw Error('対象の記録が見つからないか、既に削除されています。再読み込みしてください。');
  if((cur.updatedAt||null)!==(it.baseUpdatedAt!==undefined?it.baseUpdatedAt:it.before.updatedAt||null))throw Error('他の操作で記録が更新されています。再読み込みしてください。');
 }
 const reasonFor=a=>plan.reason||(a==='create'?'一括登録':a==='edit'?'一括編集':'一括削除');
 const revs=[],created=[];
 const rev=(a,recordId,before,after)=>revs.push({revisionId:newId('rev'),recordId,action:a,changedAt:plan.now,reason:reasonFor(a),before:before?structuredClone(before):null,after:after?structuredClone(after):null,batchId:plan.batchId});
 for(const it of act){
  if(it.action==='create'){created.push(it.after);rev('create',it.recordId,null,it.after);}
  else if(it.action==='edit'){const i=state.timeSeriesRecords.findIndex(r=>r.recordId===it.recordId);state.timeSeriesRecords[i]=it.after;rev('edit',it.recordId,it.before,it.after);}
  else{const i=state.timeSeriesRecords.findIndex(r=>r.recordId===it.recordId);const before=structuredClone(state.timeSeriesRecords[i]);const r=state.timeSeriesRecords[i];r.deletedAt=plan.now;r.updatedAt=plan.now;r.batchId=plan.batchId;rev('logical_delete',it.recordId,before,r);}
 }
 state.timeSeriesRecords=[...created,...state.timeSeriesRecords]; // 入力した行の順を保ったまま先頭へ
 state.timeSeriesRevisions=[...revs,...state.timeSeriesRevisions];
 state.editHistory.unshift({historyId:newId('history'),timestamp:plan.now,recordType:'bulkHistory',recordId:plan.batchId,action:'bulk',before:null,
  after:{batchId:plan.batchId,accountId:plan.accountId,templateId:plan.templateId,reason:plan.reason||'',counts:plan.counts,recordIds:act.map(x=>x.recordId)}});
 if(state.editHistory.length>EDIT_HISTORY_LIMIT)state.editHistory.length=EDIT_HISTORY_LIMIT;
 return state;
}

/* ---------- base64（大きなバイト列でも安全な分割変換。展開引数の上限を回避） ---------- */
function bytesToBase64(u8){let s='';const CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}
function base64ToBytes(b64){return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}

const api={EDIT_HISTORY_LIMIT,VALUE_LABELS,VALUE_KINDS,TEMPLATES,templateIdForAccountType,parseNum,localDateString,isValidDateString,dateToEffectiveAt,tsDate,computeDerived,planBatch,applyPlan,bytesToBase64,base64ToBytes};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PAMCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
