const assert=require('node:assert/strict');
const S=require('../store-core.js');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
let seq=0;const newId=p=>`${p}_${++seq}`;const NOW='2026-11-07T00:00:00.000Z';

// 架空データ（実在の口座・金額ではない）
const v5=()=>({schemaVersion:5,dataType:'personal_asset_manager',exportDate:'2026-11-01',
 accounts:[{accountId:'a_bank',accountName:'テスト銀行',accountType:'bank',currency:'JPY'},{accountId:'a_fx',accountName:'テストFX',accountType:'fx',currency:'JPY'},{accountId:'a_sec',accountName:'テスト証券',accountType:'nisa',currency:'JPY'}],
 fxPositions:[{positionId:'p1',accountId:'a_fx',currencyPair:'TRY/JPY',side:'buy',status:'open',executionDate:'2025-01-10',originalExecutionRate:4.5,originalQuantity:100000,closedQuantity:0,remainingQuantity:100000,dailySwapAmount:null,registeredAt:NOW,updatedAt:NOW}],
 holdings:[{holdingId:'h1',accountId:'a_sec',productName:'テスト投信',currentEvaluationAmount:500000}],
 balanceSnapshots:[{snapshotId:'s1',accountId:'a_bank',snapshotDate:'2026-10-31',balance:1000000}],
 cashTransactions:[{transactionId:'c1',transactionType:'transfer',effectiveDate:'2026-10-01',sourceAccountId:'a_bank',targetAccountId:'a_fx',amount:100000,feeAmount:220,feeMode:'additional',feeAccountId:'a_bank',currency:'JPY',registeredAt:NOW,updatedAt:NOW,feeId:'f1'}],
 fees:[{feeId:'f1',transactionId:'c1',effectiveDate:'2026-10-01',accountId:'a_bank',amount:220,currency:'JPY'}],
 timeSeriesRecords:[{recordId:'t1',recordType:'bank_balance',accountId:'a_bank',effectiveAt:'2026-09-30T15:00:00.000Z',effectiveDate:'2026-10-01',registeredAt:NOW,updatedAt:NOW,values:{balance:900000},deletedAt:null}],
 timeSeriesRevisions:[],editHistory:[],fxTransactions:[],fxSwapRecords:[],contributionRecords:[],fxCorrections:[],swapRateHistory:[],liabilities:[],loanRepayments:[],cryptoTransactions:[],migrationHistory:[]});
const errs=d=>S.validateImport(d).errors;

// ---------- 移行 ----------
{
 // v0.5.0-alpha2相当（schemaVersion 4）
 const old=v5();old.schemaVersion=4;for(const k of S.NEW_ARRAYS_V5)delete old[k];
 const before=structuredClone(old);
 const r=S.migrateState(old,{newId,now:NOW});
 ok(r.changed);eq(old.schemaVersion,5);eq(r.fromVersion,4);
 for(const k of S.NEW_ARRAYS_V5)ok(Array.isArray(old[k]),k);
 eq(old.migrationHistory.length,1);eq(old.migrationHistory[0].from,4);
 for(const k of ['accounts','fxPositions','holdings','balanceSnapshots','cashTransactions','fees','timeSeriesRecords'])eq(old[k],before[k],`${k}は変更されない`);
 // 冪等：2回目は何も変わらない
 const snap=JSON.stringify(old);const r2=S.migrateState(old,{newId,now:NOW});ok(!r2.changed);eq(JSON.stringify(old),snap);
}
{
 // 古い形式（v0.4相当：配列・登録日時・約定情報の欠落）
 const legacy={schemaVersion:3,accounts:[{accountId:'x',accountName:'旧口座'}],holdings:[],balanceSnapshots:[{accountId:'x',snapshotDate:'2024-01-01',balance:10}],fxPositions:[{positionId:'q',accountId:'x',openDate:'2024-02-02',openPrice:3.3,originalQuantity:5000,status:'closed',closedQuantity:100,remainingQuantity:200}]};
 const r=S.migrateState(legacy,{newId,now:NOW});ok(r.changed);
 const p=legacy.fxPositions[0];
 eq([p.executionDate,p.originalExecutionRate,p.closedQuantity,p.remainingQuantity],['2024-02-02',3.3,5000,0]);
 ok(p.registeredAt===NOW&&p.updatedAt===NOW);ok(legacy.balanceSnapshots[0].snapshotId.startsWith('snapshot_'));
 ok(Array.isArray(legacy.cashTransactions)&&Array.isArray(legacy.editHistory));eq(legacy.accounts.length,1);eq(legacy.schemaVersion,5);
}

// ---------- 整合性チェック ----------
{
 const d=v5();eq(S.checkIntegrity(d),[]);
 d.accounts.push({accountId:'a_bank'});ok(S.checkIntegrity(d).some(p=>p.key==='dup:accounts:a_bank'));
 const e=v5();e.holdings[0].accountId='ghost';const pr=S.checkIntegrity(e);ok(pr.some(p=>/ghost/.test(p.msg)));
 // 論理削除済みの記録は参照チェックの対象外
 const f=v5();f.cashTransactions[0].deletedAt=NOW;f.fees[0].deletedAt=NOW;f.accounts=f.accounts.filter(a=>a.accountId!=='a_fx');f.fxPositions=[];eq(S.checkIntegrity(f),[]);
 // 既存の問題は「新たな問題」に数えない（旧データの孤立参照で保存が全面停止しないため）
 eq(S.newProblems(pr,pr),[]);ok(S.newProblems(pr,[]).length===pr.length);
 const refs=S.accountReferences(v5(),'a_bank');ok(refs['入出金・手数料']===1&&refs['残高記録']===1&&refs['時系列履歴']===1&&refs['FX建玉']===0);
}

// ---------- JSONインポート検証 ----------
eq(errs(v5()),[]);ok(S.validateImport(v5()).warnings.length===0);
ok(errs(null).length===1);ok(errs([]).length===1);ok(errs('x').length===1);
{const d=v5();delete d.accounts;ok(errs(d).some(m=>/accounts/.test(m)));}
{const d=v5();d.fxPositions='x';ok(errs(d).some(m=>/fxPositions/.test(m)));}
{const d=v5();d.cashTransactions={};ok(errs(d).some(m=>/cashTransactions が配列/.test(m)));}
{const d=v5();d.schemaVersion=99;ok(errs(d).some(m=>/新しいバージョン/.test(m)));}
{const d=v5();d.schemaVersion='5';ok(errs(d).some(m=>/schemaVersion が不正/.test(m)));}
{const d=v5();d.dataType='other_app';ok(errs(d).some(m=>/dataType/.test(m)));}
{const d=v5();d.accounts.push({...d.accounts[0]});ok(errs(d).some(m=>/重複/.test(m)));}
{const d=v5();d.fxPositions.push({...d.fxPositions[0]});ok(errs(d).some(m=>/positionId「p1」が重複/.test(m)));}
{const d=v5();d.accounts[0].accountId='';ok(errs(d).some(m=>/accountId がありません/.test(m)));}
{const d=v5();d.accounts.push(null);ok(errs(d).some(m=>/オブジェクトではありません/.test(m)));}
{const d=v5();d.balanceSnapshots[0].snapshotDate='2026-02-30';ok(errs(d).some(m=>/日付/.test(m)));}
{const d=v5();d.cashTransactions[0].effectiveDate='2026/10/01';ok(errs(d).some(m=>/effectiveDate/.test(m)));}
{const d=v5();d.timeSeriesRecords[0].registeredAt='not-a-date';ok(errs(d).some(m=>/日時として読めません/.test(m)));}
{const d=v5();d.cashTransactions[0].amount='100000';ok(errs(d).some(m=>/amount が数値ではありません/.test(m)));}
{const d=v5();d.cashTransactions[0].feeAmount=-1;ok(errs(d).some(m=>/負の値/.test(m)));}
{const d=v5();d.fxPositions[0].originalQuantity=NaN;ok(errs(d).some(m=>/originalQuantity/.test(m)));}
{const d=v5();d.balanceSnapshots[0].balance='abc';ok(errs(d).some(m=>/balance が数値/.test(m)));}
{const d=v5();d.timeSeriesRecords[0].values.balance='9';ok(errs(d).some(m=>/values\.balance/.test(m)));}
{const d=v5();d.fxPositions[0].status='partial';ok(errs(d).some(m=>/status/.test(m)));}
{const d=v5();d.fxPositions[0].status='closed';d.fxPositions[0].settlementDate='2024-01-01';ok(errs(d).some(m=>/決済日が約定日より前/.test(m)));}
{const d=v5();d.cashTransactions[0].transactionType='swap';ok(errs(d).some(m=>/transactionType/.test(m)));}
{const d=v5();d.cashTransactions[0].feeMode='split';ok(errs(d).some(m=>/feeMode/.test(m)));}
{const d=v5();d.cashTransactions[0].targetAccountId='a_bank';ok(errs(d).some(m=>/振替元・振替先が不正/.test(m)));}
{const d=v5();d.cashTransactions[0].feeAccountId=null;ok(errs(d).some(m=>/負担口座がありません/.test(m)));}
{const d=v5();d.fees[0].transactionId='ghost';ok(errs(d).some(m=>/存在しない入出金/.test(m)));}
{const d=v5();d.holdings[0].accountId='ghost';ok(errs(d).some(m=>/存在しない口座/.test(m)),'v5データの孤立参照はエラー');}
{const d=v5();d.schemaVersion=4;d.holdings[0].accountId='ghost';const v=S.validateImport(d);eq(v.errors,[]);ok(v.warnings.some(m=>/旧版データ/.test(m)),'旧版データの孤立参照は警告（過去の口座削除で生じ得るため取り込みは拒否しない）');}
{const d=v5();delete d.schemaVersion;const v=S.validateImport(d);ok(v.warnings.some(m=>/schemaVersion がありません/.test(m)));}
{ // 複数の問題は部分的に読み込まず、すべて列挙する
 const d=v5();d.cashTransactions[0].amount='x';d.accounts.push({...d.accounts[0]});d.balanceSnapshots[0].snapshotDate='bad';ok(errs(d).length>=3);}
// 取り込みで失われるもの
{const cur=v5(),inc=v5();inc.accounts=inc.accounts.slice(0,1);inc.cashTransactions=[];const l=S.lostByReplace(cur,inc);eq(l.accounts,2);eq(l.cashTransactions,1);ok(!('holdings' in l));}
eq(S.countsOf(v5()).accounts,3);

// ---------- FX建玉：固定情報・決済・訂正 ----------
const form=(o={})=>({positionId:'p1',accountId:'a_fx',currencyPair:'TRY/JPY',side:'buy',status:'open',executionDate:'2025-01-10',originalExecutionRate:4.5,originalQuantity:100000,referenceRate:4.6,dailySwapAmount:12,accumulatedSwap:null,realizedProfitLoss:null,unrealizedProfitLoss:null,settlementDate:null,settlementRate:null,...o});
const ctxp={now:NOW,newId};
{
 let r=S.buildPosition(null,{...form(),positionId:null},ctxp);eq(r.errors,[]);ok(r.position.positionId.startsWith('position_'));
 eq([r.position.closedQuantity,r.position.remainingQuantity,r.position.openDate,r.position.openPrice],[0,100000,'2025-01-10',4.5]);
 for(const [k,v] of [['executionDate',''],['executionDate','2025-13-01'],['originalExecutionRate',0],['originalExecutionRate',null],['originalQuantity',0],['originalQuantity',-5]])ok(S.buildPosition(null,form({[k]:v}),ctxp).errors.length>0,`新規 ${k}=${v}`);
 const ex=v5().fxPositions[0];
 // 固定情報の変更は拒否（ID・約定日・約定数量・約定レート）
 for(const [k,v] of [['positionId','p9'],['executionDate','2025-02-01'],['originalExecutionRate',4.6],['originalQuantity',50000]]){const rr=S.buildPosition(ex,form({[k]:v}),ctxp);ok(rr.errors.length===1&&rr.errors[0].includes(k),`固定:${k}`);}
 // 通常項目の編集は可能で、固定情報・登録日時・IDは保たれる
 r=S.buildPosition(ex,form({referenceRate:4.8,dailySwapAmount:15}),ctxp);eq(r.errors,[]);
 eq([r.position.referenceRate,r.position.dailySwapAmount,r.position.originalQuantity,r.position.originalExecutionRate,r.position.executionDate,r.position.positionId,r.position.registeredAt],[4.8,15,100000,4.5,'2025-01-10','p1',NOW]);
 // 決済：全数量のみ（部分決済なし）。日付・レート必須。決済日は約定日以降
 r=S.buildPosition(ex,form({status:'closed',settlementDate:'2025-03-01',settlementRate:4.9,realizedProfitLoss:40000}),ctxp);eq(r.errors,[]);
 eq([r.position.status,r.position.closedQuantity,r.position.remainingQuantity,r.position.originalQuantity],['closed',100000,0,100000]);
 ok(S.buildPosition(ex,form({status:'closed'}),ctxp).errors.length>0);
 ok(S.buildPosition(ex,form({status:'closed',settlementDate:'2024-12-31',settlementRate:4.9}),ctxp).errors.length>0);
 ok(S.buildPosition(ex,form({status:'closed',settlementDate:'2025-03-01',settlementRate:0}),ctxp).errors.length>0);
 // 決済済みを通常編集で未決済に戻すことはできない
 const closed=r.position;const back=S.buildPosition(closed,form({status:'open',executionDate:'2025-01-10'}),ctxp);ok(back.errors.some(m=>/決済の訂正/.test(m)));
 // 独立した訂正操作：理由必須、変更前後を記録、約定情報は不変
 ok(S.reopenPosition(closed,'',ctxp).error&&S.reopenPosition(closed,'   ',ctxp).error);
 ok(S.reopenPosition(ex,'x',ctxp).error,'未決済は訂正対象外');
 const ro=S.reopenPosition(closed,'決済レートの入力ミス',ctxp);ok(!ro.error);
 eq([ro.after.status,ro.after.closedQuantity,ro.after.remainingQuantity,ro.after.settlementDate,ro.after.settlementRate],['open',0,100000,null,null]);
 eq([ro.after.originalQuantity,ro.after.originalExecutionRate,ro.after.executionDate,ro.after.positionId],[100000,4.5,'2025-01-10','p1']);
 eq([ro.correction.type,ro.correction.reason,ro.correction.before.status,ro.correction.after.status,ro.correction.positionId],['reopen','決済レートの入力ミス','closed','open','p1']);
 ok(ro.correction.before.settlementRate===4.9,'訂正前の決済レートが記録に残る');
}
console.log(`store-core tests: ${n} assertions passed`);
