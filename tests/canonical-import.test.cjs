const assert=require('node:assert/strict');
const S=require('../store-core.js');const F=require('../finance-core.js');const {build}=require('./fixtures/canonical-fixture.cjs');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
const D=()=>build();const empty=()=>({accounts:[],fxPositions:[],holdings:[],balanceSnapshots:[]});
const errs=(d,o)=>S.validateCanonical(d,o).errors;

// ---------- 形式判定とバージョン ----------
eq(S.detectFormat(D()),{format:'canonical',version:1});
eq(S.detectFormat({dataType:'personal_asset_manager',schemaVersion:5,accounts:[],fxPositions:[],holdings:[],balanceSnapshots:[]}).format,'native');
eq(S.detectFormat({accounts:[],fxPositions:[],holdings:[],balanceSnapshots:[]}).format,'native');
eq(S.detectFormat({foo:1}).format,'unknown');eq(S.detectFormat([]).format,'invalid');eq(S.detectFormat(null).format,'invalid');
{const v=S.validateImport(D());ok(v.errors.length>=3,'従来の検証では拒否される（別形式のため）');}
{const v=S.validateCanonical(D());eq(v.errors,[]);eq(v.warnings,[]);eq(v.counts.fxPositions,41);eq(v.counts.fxPositionEvents,41);eq(v.counts.accounts,4);eq(v.counts.investmentHoldings,0);}

// ---------- 検証（不正データは拒否） ----------
{let d=D();d.schemaVersion=2;ok(errs(d).some(m=>/新しいバージョン/.test(m)));
 d=D();d.schemaVersion='1';ok(errs(d).some(m=>/schemaVersion が不正/.test(m)));
 d=D();d.dataType='x';ok(errs(d).some(m=>/dataType/.test(m)));
 d=D();delete d.accounts;ok(errs(d).some(m=>/accounts/.test(m)));
 d=D();d.fxPositions='x';ok(errs(d).some(m=>/fxPositions が配列/.test(m)));
 d=D();d.fxPositions.push({...d.fxPositions[0]});ok(errs(d).some(m=>/positionId「.*」が重複/.test(m)));
 d=D();d.accounts.push({...d.accounts[0]});ok(errs(d).some(m=>/accountId「.*」が重複/.test(m)));
 d=D();d.fxPositionEvents.push({...d.fxPositionEvents[0]});ok(errs(d).some(m=>/eventId/.test(m)));
 d=D();d.fxPositions[0].accountId='ghost';ok(errs(d).some(m=>/存在しない口座/.test(m)));
 d=D();d.accountBalanceSnapshots[0].accountId='ghost';ok(errs(d).some(m=>/存在しない口座/.test(m)));
 d=D();d.fxPositionEvents[0].positionId='ghost';ok(errs(d).some(m=>/存在しない建玉/.test(m)));
 d=D();d.fxPositions[0].executionDate='2025-02-30';ok(errs(d).some(m=>/日付/.test(m)));
 d=D();d.fxPositions[0].originalQuantity='200000';ok(errs(d).some(m=>/originalQuantity/.test(m)));
 d=D();d.fxPositions[0].originalQuantity=0;ok(errs(d).some(m=>/originalQuantity/.test(m)));
 d=D();d.fxPositions[0].originalExecutionRate=-1;ok(errs(d).some(m=>/originalExecutionRate/.test(m)));
 d=D();d.fxPositions[0].side='long';ok(errs(d).some(m=>/side/.test(m)));
 d=D();d.fxPositions[0].status='partial';ok(errs(d).some(m=>/status/.test(m)));
 d=D();d.accountBalanceSnapshots[0].netAssets='100';ok(errs(d).some(m=>/netAssets が数値/.test(m)));
 d=D();d.accountBalanceSnapshots[0].effectiveDate='2026/11/05';ok(errs(d).some(m=>/effectiveDate/.test(m)));
 d=D();d.fxPositionEvents[0].swapAmount='abc';ok(errs(d).some(m=>/swapAmount/.test(m)));
 d=D();d.fxPositions[0].registeredAt='bad';ok(errs(d).some(m=>/日時として読めません/.test(m)));
 d=D();d.fxPositions.push(null);ok(errs(d).some(m=>/オブジェクトではありません/.test(m)));
 d=D();d.fxPositions[0].status='closed';d.fxPositions[0].settlementDate='2020-01-01';d.fxPositions[0].settlementRate=3;ok(errs(d).some(m=>/決済日が約定日より前/.test(m)));
 // 警告（取り込みは可能・値は変更しない）
 d=D();d.fxPositions[0].status='closed';const w=S.validateCanonical(d);eq(w.errors,[]);ok(w.warnings.some(m=>/決済日または決済レートが不明/.test(m)));
 d=D();d.accounts[0].accountType='securities_x';const w2=S.validateCanonical(d);eq(w2.errors,[]);ok(w2.warnings.some(m=>/種別にありません/.test(m)));
 d=D();d.fxPositions[0].sourceDocumentIds=['SRC-NONE'];ok(S.validateCanonical(d).warnings.some(m=>/原資料/.test(m)));
 d=D();d.unknownTop=[1];ok(S.validateCanonical(d).warnings.some(m=>/未知のキー/.test(m)));
 // 既存の口座・建玉を参照する差分JSON（段階的な追加）は、既存IDが渡されれば有効
 d=D();d.accounts=[];d.sourceDocuments=[];ok(errs(d).length>0);eq(errs(d,{existingAccountIds:['ACC-TESTA-001','ACC-TESTB-001','ACC-TESTC-001','ACC-TESTD-001']}),[]);
 // 複数の問題はすべて列挙
 d=D();d.fxPositions[0].side='x';d.fxPositions[1].originalQuantity=0;d.schemaVersion=9;ok(errs(d).length>=3);}

// ---------- 変換：値を変更・補完しない ----------
const src=D();const conv=S.convertCanonical(src);
{
 eq(conv.accounts.length,4);eq(conv.positions.length,41);eq(conv.snapshots.length,4);
 src.fxPositions.forEach((p,i)=>{const c=conv.positions[i];
  eq([c.positionId,c.accountId,c.currencyPair,c.side,c.status,c.executionDate,c.originalQuantity,c.originalExecutionRate,c.lots,c.quantityUnit,c.memo],[p.positionId,p.accountId,p.currencyPair,p.side,p.status,p.executionDate,p.originalQuantity,p.originalExecutionRate,p.lots,p.quantityUnit,p.notes],'値を変えない');
  eq([c.openDate,c.openPrice],[p.executionDate,p.originalExecutionRate],'アプリ表示用の項目に同じ値を設定');
  eq([c.closedQuantity,c.remainingQuantity],[0,p.originalQuantity]);
  // JSONに無い情報は推測しない（null のまま）
  eq([c.referenceRate,c.dailySwapAmount,c.unrealizedProfitLoss,c.realizedProfitLoss,c.settlementDate,c.settlementRate,c.finalSwap],[null,null,null,null,null,null,null]);
  // 累積スワップは、その建玉の swap_recorded イベントがちょうど1件ある場合のみ、そのイベントの値を設定（出典も保持）
  const e=src.fxPositionEvents.find(x=>x.positionId===p.positionId);eq([c.accumulatedSwap,c.accumulatedSwapSource.eventId],[e.swapAmount,e.eventId]);});
 src.accountBalanceSnapshots.forEach((x,i)=>{const c=conv.snapshots[i];eq([c.snapshotId,c.accountId,c.snapshotDate,c.balance,c.evaluationAmount,c.netAssetValue,c.marginRequirement,c.unrealizedProfitLoss,c.accumulatedSwap,c.memo],[x.snapshotId,x.accountId,x.effectiveDate,x.cashBalance,x.accountValuation,x.netAssets,x.requiredMargin,x.unrealizedPnl,x.cumulativeSwap,x.notes]);});
 src.accounts.forEach((a,i)=>eq([conv.accounts[i].accountName,conv.accounts[i].institutionName,conv.accounts[i].accountType,conv.accounts[i].currency,conv.accounts[i].confirmationDate],[a.accountName,a.institution,a.accountType,a.baseCurrency,undefined],'確認日はJSONに無いので設定しない'));
 // イベントが複数ある建玉は、どれが累積か断定できないため null のまま
 const d2=D();d2.fxPositionEvents.push({...d2.fxPositionEvents[0],eventId:'FXE-EXTRA',swapAmount:5});const c2=S.convertCanonical(d2);eq(c2.positions[0].accumulatedSwap,null);ok(c2.notes.some(m=>/累積スワップは設定せず/.test(m)));
 // 決済済み建玉は数量を整合（決済数量=当初数量、残数量=0）。決済情報は元の値のまま
 const d3=D();Object.assign(d3.fxPositions[0],{status:'closed',settlementDate:'2026-01-10',settlementRate:4.1,realizedPnl:1234,finalSwap:77});const c3=S.convertCanonical(d3).positions[0];eq([c3.closedQuantity,c3.remainingQuantity,c3.settlementDate,c3.settlementRate,c3.realizedProfitLoss,c3.finalSwap],[d3.fxPositions[0].originalQuantity,0,'2026-01-10',4.1,1234,77]);
}

// ---------- 統合：追加のみ・重複登録なし ----------
const clean=()=>S.convertCanonical(D());
{
 const st=empty();const r=S.mergeCanonical(st,clean());
 eq([st.accounts.length,st.fxPositions.length,st.balanceSnapshots.length],[4,41,4]);
 eq([r.accounts.added,r.positions.added,r.snapshots.added,r.positions.skipped],[4,41,4,0]);
 ok(st.fxPositions.filter(p=>p.accountId==='ACC-TESTA-001').length===19&&st.fxPositions.filter(p=>p.accountId==='ACC-TESTB-001').length===12&&st.fxPositions.filter(p=>p.accountId==='ACC-TESTC-001').length===4&&st.fxPositions.filter(p=>p.accountId==='ACC-TESTD-001').length===6,'口座別の建玉数');
 // 同条件の建玉（同日・同レート・同数量）を1件にまとめない
 const keys=new Set(st.fxPositions.map(p=>[p.accountId,p.executionDate,p.originalQuantity,p.originalExecutionRate].join('|')));ok(keys.size<41,'同条件の建玉が存在する前提');eq(new Set(st.fxPositions.map(p=>p.positionId)).size,41);
 // 原データの保持
 eq([st.canonicalData.sourceDocuments.length,st.canonicalData.fxPositionEvents.length,st.canonicalData.migrationNotes.length],[4,41,1]);eq(r.unsupportedNonEmpty,[]);
 eq(S.checkIntegrity(st).filter(p=>!p.key.startsWith('x')),[],'参照・ID整合性に問題なし');
 // 再取り込みしても重複しない（冪等）
 const snap=JSON.stringify(st);const r2=S.mergeCanonical(st,clean());eq(r2.totalAdded,0);eq(JSON.stringify(st),snap);eq([r2.accounts.skipped,r2.positions.skipped,r2.snapshots.skipped],[4,41,4]);
 // 3回目も同じ
 eq(S.mergeCanonical(st,clean()).totalAdded,0);
}
{ // 既存データは1バイトも変えない
 const st=empty();st.accounts.push({accountId:'my_bank',accountName:'既存の銀行',accountType:'bank',currency:'JPY'});st.holdings.push({holdingId:'h1',accountId:'my_bank',productName:'既存の商品',currentEvaluationAmount:5});st.balanceSnapshots.push({snapshotId:'s0',accountId:'my_bank',snapshotDate:'2026-10-31',balance:100});st.fxPositions.push({positionId:'old_p',accountId:'my_bank',currencyPair:'USD/JPY',side:'buy',status:'open',executionDate:'2024-01-01',originalQuantity:1000,originalExecutionRate:140});
 const before=JSON.stringify({a:st.accounts,h:st.holdings,s:st.balanceSnapshots,p:st.fxPositions});
 S.mergeCanonical(st,clean());
 eq(JSON.stringify({a:st.accounts.slice(0,1),h:st.holdings,s:st.balanceSnapshots.slice(0,1),p:st.fxPositions.slice(0,1)}),JSON.stringify({a:JSON.parse(before).a,h:JSON.parse(before).h,s:JSON.parse(before).s,p:JSON.parse(before).p}),'既存レコードは不変');
 eq([st.accounts.length,st.fxPositions.length,st.balanceSnapshots.length],[5,42,5]);
}
{ // 同名・同種別の既存口座には、新しい口座を作らず紐付ける（重複口座を作らない）
 const st=empty();st.accounts.push({accountId:'legacy-1',accountName:' TEST FX-A ',accountType:'fx',currency:'JPY'});
 const r=S.mergeCanonical(st,clean());
 eq(st.accounts.length,4);eq(r.accounts.aliased,1);ok(st.accounts.some(a=>a.accountId==='legacy-1'));ok(!st.accounts.some(a=>a.accountId==='ACC-TESTA-001'));
 eq(st.fxPositions.filter(p=>p.accountId==='legacy-1').length,19,'建玉は既存口座に紐付く');eq(st.balanceSnapshots.filter(x=>x.accountId==='legacy-1').length,1);
 eq(S.checkIntegrity(st),[]);
 // 同名でも種別が違えば別口座
 const st2=empty();st2.accounts.push({accountId:'x',accountName:'TEST FX-A',accountType:'bank'});S.mergeCanonical(st2,clean());eq(st2.accounts.length,5);
}
{ // 同じIDで内容が違う場合は、上書きせず競合として報告
 const st=empty();S.mergeCanonical(st,clean());
 st.accounts[0].accountName='手で直した名前';st.fxPositions[0].originalQuantity=999;st.balanceSnapshots[0].netAssetValue=1;
 const r=S.mergeCanonical(st,clean());
 eq(r.totalAdded,0);ok(r.accounts.conflicts.length===1&&r.positions.conflicts.length===1&&r.snapshots.conflicts.length===1);
 eq([st.accounts[0].accountName,st.fxPositions[0].originalQuantity,st.balanceSnapshots[0].netAssetValue],['手で直した名前',999,1],'既存の値を維持');
}
{ // ID違いでも既存と同条件の建玉は、既存の件数分だけ重複として追加しない
 const st=empty();st.accounts.push({accountId:'ACC-TESTA-001',accountName:'TEST FX-A',accountType:'fx'});
 const p=clean().positions.filter(x=>x.accountId==='ACC-TESTA-001');const first=p[0];
 st.fxPositions.push({positionId:'manual-1',accountId:'ACC-TESTA-001',currencyPair:first.currencyPair,side:'buy',status:'open',executionDate:first.executionDate,originalQuantity:first.originalQuantity,originalExecutionRate:first.originalExecutionRate});
 const sameKey=p.filter(x=>x.executionDate===first.executionDate&&x.originalExecutionRate===first.originalExecutionRate&&x.originalQuantity===first.originalQuantity).length;
 const r=S.mergeCanonical(st,clean());
 eq(r.positions.possibleDuplicates.length,1);eq(st.fxPositions.length,1+41-1);ok(sameKey>=2,'同条件の建玉が複数あるケース');
}
{ // 同日・数値違いの残高記録は別記録として追加（上書きしない）。全く同じなら追加しない
 const st=empty();st.accounts.push({accountId:'ACC-TESTA-001',accountName:'TEST FX-A',accountType:'fx'});st.balanceSnapshots.push({snapshotId:'mine',accountId:'ACC-TESTA-001',snapshotDate:'2026-11-05',balance:1,netAssetValue:2});
 const r=S.mergeCanonical(st,clean());eq(r.snapshots.sameDayDifferent.length,1);eq(st.balanceSnapshots.length,1+4);eq(st.balanceSnapshots[0].netAssetValue,2);
 const st2=empty();S.mergeCanonical(st2,clean());st2.balanceSnapshots[0].snapshotId='renamed';const r2=S.mergeCanonical(st2,clean());eq(r2.snapshots.added,0,'ID違いでも全数値が同じなら重複として追加しない');
}
{ // 表示項目のない形式の配列は、内容を失わずそのまま保持し、報告する
 const d=D();d.investmentHoldings=[{holdingId:'H1',name:'テスト投信'}];d.cryptoHoldings=[{asset:'BTC',quantity:0.5}];
 ok(S.validateCanonical(d).errors.length===0);const st=empty();const r=S.mergeCanonical(st,S.convertCanonical(d));
 eq(st.canonicalData.investmentHoldings,[{holdingId:'H1',name:'テスト投信'}]);eq(st.canonicalData.cryptoHoldings,[{asset:'BTC',quantity:0.5}]);ok(r.unsupportedNonEmpty.length===2);eq(st.holdings??[],[],'推測して保有資産へ変換しない');
 eq(S.mergeCanonical(st,S.convertCanonical(d)).totalAdded,0,'保持した原データも再取り込みで重複しない');
}
{ // 段階的な追加：既存の口座に新しい建玉・残高記録だけを足すJSON
 const st=empty();S.mergeCanonical(st,clean());
 const d=D();d.fxPositions.push({...d.fxPositions[0],positionId:'FXP-T-NEW',executionDate:'2026-02-02'});d.fxPositionEvents.push({...d.fxPositionEvents[0],eventId:'FXE-T-NEW',positionId:'FXP-T-NEW',swapAmount:5});
 d.accountBalanceSnapshots.push({...d.accountBalanceSnapshots[0],snapshotId:'ABS-T-NEW',effectiveDate:'2026-12-01',netAssets:123});
 const r=S.mergeCanonical(st,S.convertCanonical(d));eq([r.positions.added,r.snapshots.added,r.accounts.added,r.preserved.fxPositionEvents.added],[1,1,0,1]);eq(st.fxPositions.length,42);
}

// ---------- 資産合計に二重計上がない ----------
{
 const st=empty();S.mergeCanonical(st,clean());st.timeSeriesRecords=[];
 const sum=F.summarizeAssets(st);const D0=D();
 eq(sum.totals.asset,D0.accountBalanceSnapshots.reduce((s,x)=>s+x.netAssets,0),'FX各口座は純資産額（口座単位の評価）のみを集計');
 eq(sum.rows.length,4);ok(sum.rows.every(r=>r.source==='残高記録'));
 // 建玉の評価損益・スワップ・口座の現金残高を別途足していない
 ok(sum.totals.asset!==D0.accountBalanceSnapshots.reduce((s,x)=>s+x.netAssets+x.cashBalance+x.unrealizedPnl+x.cumulativeSwap,0));
 // 再取り込みしても合計は変わらない
 const before=sum.totals.asset;S.mergeCanonical(st,clean());eq(F.summarizeAssets(st).totals.asset,before);
 // 口座全体の評価額がある口座では、商品別（保有資産）の評価額を使わない
 st.holdings.push({holdingId:'hh',accountId:'ACC-TESTA-001',productName:'商品',currentEvaluationAmount:99999999});eq(F.summarizeAssets(st).totals.asset,before,'保有資産の評価額は口座の評価額と二重計上されない');
}
console.log(`canonical-import tests: ${n} assertions passed`);
