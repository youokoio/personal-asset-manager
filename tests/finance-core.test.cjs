const assert=require('node:assert/strict');
const F=require('../finance-core.js');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};

// ---------- 入金・出金・内部振替・手数料（架空の口座・金額） ----------
const T=(o)=>({transactionId:'c',currency:'JPY',...o});
const ids=['bank','fx','third'];
{
 // 内部振替 additional：銀行負担。銀行-100,220／FX+100,000／手数料220
 const t=T({transactionType:'transfer',sourceAccountId:'bank',targetAccountId:'fx',amount:100000,feeAmount:220,feeMode:'additional',feeAccountId:'bank'});
 eq([F.cashEffect(t,'bank'),F.cashEffect(t,'fx'),F.cashEffect(t,'third')],[-100220,100000,0]);
 eq(F.totalEffect(t,ids),-220,'内部振替は手数料分だけ減り、金額は二重計上されない');
 // deducted：金額から手数料を差し引く。銀行-100,000／FX+99,780
 const d=T({...t,feeMode:'deducted'});eq([F.cashEffect(d,'bank'),F.cashEffect(d,'fx')],[-100000,99780]);eq(F.totalEffect(d,ids),-220);
 // additional で受取側負担
 const r=T({...t,feeAccountId:'fx'});eq([F.cashEffect(r,'bank'),F.cashEffect(r,'fx')],[-100000,99780]);eq(F.totalEffect(r,ids),-220);
 // 第三の口座が手数料を負担：銀行-100,000／FX+100,000／第三-220
 const th=T({...t,feeAccountId:'third'});eq([F.cashEffect(th,'bank'),F.cashEffect(th,'fx'),F.cashEffect(th,'third')],[-100000,100000,-220]);eq(F.totalEffect(th,ids),-220);
 // 外部入金
 const dep=T({transactionType:'deposit',targetAccountId:'bank',amount:50000,feeAmount:0,feeAccountId:null});eq([F.cashEffect(dep,'bank'),F.cashEffect(dep,'fx')],[50000,0]);
 const depD=T({transactionType:'deposit',targetAccountId:'bank',amount:50000,feeAmount:110,feeMode:'deducted',feeAccountId:'bank'});eq(F.cashEffect(depD,'bank'),49890);
 const depA=T({transactionType:'deposit',targetAccountId:'bank',amount:50000,feeAmount:110,feeMode:'additional',feeAccountId:'third'});eq([F.cashEffect(depA,'bank'),F.cashEffect(depA,'third')],[50000,-110]);
 // 外部出金
 const wd=T({transactionType:'withdrawal',sourceAccountId:'fx',amount:30000,feeAmount:330,feeMode:'additional',feeAccountId:'fx'});eq(F.cashEffect(wd,'fx'),-30330);
 const wdD=T({...wd,feeMode:'deducted'});eq(F.cashEffect(wdD,'fx'),-30000);
 const wdT=T({...wd,feeAccountId:'third'});eq([F.cashEffect(wdT,'fx'),F.cashEffect(wdT,'third')],[-30000,-330]);
 // 単独の手数料
 const fee=T({transactionType:'fee',amount:0,feeAmount:550,feeAccountId:'bank'});eq([F.cashEffect(fee,'bank'),F.cashEffect(fee,'fx')],[-550,0]);
 // 論理削除した記録は集計に含まれない
 eq(F.cashEffect({...t,deletedAt:'2026-01-01T00:00:00Z'},'bank'),0);
 const net=F.cashNetByCurrency([t,{...t,transactionId:'x',deletedAt:'z'},fee],'bank');eq(net,{JPY:-100770});
 // 手数料の通貨別集計
 eq(F.cashNetByCurrency([T({...t,currency:'USD'})],'bank'),{USD:-100220});
}

// ---------- 資産・負債・純資産 ----------
const acc=(id,type,extra={})=>({accountId:id,accountName:id,accountType:type,currency:'JPY',...extra});
const ts=(o)=>({recordId:'r'+Math.random(),registeredAt:'2026-11-01T00:00:00Z',deletedAt:null,...o});
{
 const st={accounts:[acc('b','bank'),acc('f','fx'),acc('s','nisa'),acc('d','ideco'),acc('c','crypto'),acc('l','mortgage'),acc('e','bank')],
  balanceSnapshots:[{snapshotId:'1',accountId:'b',snapshotDate:'2026-09-30',balance:1000000},{snapshotId:'2',accountId:'f',snapshotDate:'2026-10-31',netAssetValue:300000,balance:290000}],
  timeSeriesRecords:[
   ts({accountId:'b',recordType:'bank_balance',effectiveDate:'2026-10-31',values:{balance:1200000}}),                 // 残高記録より新しい → こちらを採用（足さない）
   ts({accountId:'s',recordType:'securities_snapshot',effectiveDate:'2026-10-31',values:{valuation:2000000,cashBalance:50000}}),
   ts({accountId:'d',recordType:'securities_snapshot',effectiveDate:'2026-10-31',values:{valuation:800000}}),
   ts({accountId:'c',recordType:'crypto_snapshot',entityId:'BTC',effectiveDate:'2026-10-01',values:{valuation:500000,jpyBalance:1000}}),
   ts({accountId:'c',recordType:'crypto_snapshot',entityId:'BTC',effectiveDate:'2026-10-31',values:{valuation:600000,jpyBalance:2000}}),
   ts({accountId:'c',recordType:'crypto_snapshot',entityId:'SOL',effectiveDate:'2026-10-20',values:{valuation:100000,jpyBalance:2000}}),
   ts({accountId:'l',recordType:'bank_balance',effectiveDate:'2026-10-31',values:{balance:30000000}}),
   ts({accountId:'d',recordType:'securities_snapshot',effectiveDate:'2026-11-05',values:{valuation:9999999},deletedAt:'2026-11-06T00:00:00Z'}) // 論理削除は無視
  ],holdings:[]};
 const s=F.summarizeAssets(st);const by=id=>s.rows.find(r=>r.accountId===id);
 eq(by('b').value,1200000);eq(by('b').source,'時系列履歴');
 eq(by('f').value,300000);eq(by('f').source,'残高記録');
 eq(by('s').value,2050000,'証券は評価額＋口座内現金（別管理）');
 eq(by('d').value,800000);
 eq(by('c').value,600000+100000+2000,'暗号資産は資産別の最新評価の合計＋日本円残高');
 eq(by('l').kind,'liability');eq(by('l').value,30000000);
 eq(by('e').value,null,'データのない口座は0ではなくnull');eq(s.missing,1);
 eq(s.totals.asset,1200000+300000+2050000+800000+702000);eq(s.totals.liability,30000000);eq(s.totals.net,s.totals.asset-30000000);
 // 保有資産は、他の評価データがない口座の代替としてのみ使用（二重計上しない）
 const st2={accounts:[acc('s','nisa')],balanceSnapshots:[],timeSeriesRecords:[],holdings:[{holdingId:'h1',accountId:'s',currentEvaluationAmount:100},{holdingId:'h2',accountId:'s',currentEvaluationAmount:200}]};
 eq(F.summarizeAssets(st2).totals.asset,300);
 st2.balanceSnapshots=[{snapshotId:'x',accountId:'s',snapshotDate:'2026-01-01',evaluationAmount:1000}];eq(F.summarizeAssets(st2).totals.asset,1000);
 // 円建て以外は合計に含めない
 const st3={accounts:[acc('u','bank',{currency:'USD'})],balanceSnapshots:[{snapshotId:'x',accountId:'u',snapshotDate:'2026-01-01',balance:500}],timeSeriesRecords:[],holdings:[]};
 const s3=F.summarizeAssets(st3);eq(s3.totals.asset,0);eq(s3.excluded,1);
 // 同日は時系列履歴を優先
 const st4={accounts:[acc('b','bank')],balanceSnapshots:[{snapshotId:'1',accountId:'b',snapshotDate:'2026-10-31',balance:1}],timeSeriesRecords:[ts({accountId:'b',recordType:'bank_balance',effectiveDate:'2026-10-31',values:{balance:2}})],holdings:[]};eq(F.summarizeAssets(st4).totals.asset,2);
}

// ---------- 時系列：欠損を補間しない ----------
{
 const R=(d,v,reg='2026-11-01')=>({recordId:d+v,effectiveDate:d,registeredAt:reg,deletedAt:null,values:{valuation:v}});
 const rec=[R('2026-01-31',100),R('2026-02-28',110),R('2026-06-30',150),R('2026-07-31',160),R('2026-02-28',111,'2026-11-05'),{...R('2026-03-31',999),deletedAt:'x'}];
 const vo=r=>r.values.valuation;
 let s=F.buildSeries(rec,{valueOf:vo,maxGapDays:35});
 eq(s.points.map(p=>p.date),['2026-01-31','2026-02-28','2026-06-30','2026-07-31']);
 eq(s.points[1].value,111,'同じ対象日は登録日時が最新の記録を採用');
 eq(s.segments.map(g=>g.map(p=>p.date)),[['2026-01-31','2026-02-28'],['2026-06-30','2026-07-31']],'欠損の前後で線を分ける');
 eq(s.gaps,[{from:'2026-02-28',to:'2026-06-30',days:122}]);
 ok(!s.points.some(p=>p.date==='2026-03-31'||p.date==='2026-04-30'),'欠損期間にゼロや補間値の点を作らない');
 s=F.buildSeries(rec,{valueOf:vo,maxGapDays:null});eq(s.segments.length,1);eq(s.gaps,[]);
 s=F.buildSeries(rec,{valueOf:vo,from:'2026-02-01',to:'2026-06-30',maxGapDays:35});eq(s.points.map(p=>p.date),['2026-02-28','2026-06-30']);
 eq(F.buildSeries([],{valueOf:vo}).points,[]);
 eq(F.buildSeries([{...R('2026-01-01',1),values:{valuation:null}},{...R('2026-01-02',2),values:{}}],{valueOf:vo}).points,[],'値のない記録は点にしない（0にしない）');
 eq(F.daysBetween('2026-02-28','2026-03-01'),1);
}

// ---------- FXスワップ按分（推定値） ----------
{
 const P=(id,q,ex,st='open',sd=null)=>({positionId:id,originalQuantity:q,executionDate:ex,status:st,settlementDate:sd});
 eq(F.swapAmount(70,10000),70);eq(F.swapAmount(70,25000),175);
 eq(F.holdingDays(P('a',1,'2026-01-01'),'2026-01-01','2026-01-31'),30);
 eq(F.holdingDays(P('a',1,'2026-01-11'),'2026-01-01','2026-01-31'),20,'期間途中に約定した建玉');
 eq(F.holdingDays(P('a',1,'2025-12-01','closed','2026-01-16'),'2026-01-01','2026-01-31'),15,'期間途中に決済した建玉');
 eq(F.holdingDays(P('a',1,'2026-03-01'),'2026-01-01','2026-01-31'),0);
 // ウェイト＝数量×日数。A:10000×30=300000 / B:20000×15=300000 → 半々
 const r=F.allocateSwap({periodSwapDelta:1000,positions:[P('A',10000,'2026-01-01'),P('B',20000,'2026-01-16')],start:'2026-01-01',end:'2026-01-31'});
 eq(r.totalWeight,600000);eq(r.allocations.map(a=>a.estimated),[500,500]);eq(r.unallocated,0);eq(r.kind,'estimate');ok(r.allocations.every(a=>a.isEstimate));
 // 端数は口座単位の未配分として残す（合計が実際の累計スワップ変動額と一致）
 const r2=F.allocateSwap({periodSwapDelta:100,positions:[P('A',1,'2026-01-01'),P('B',1,'2026-01-01'),P('C',1,'2026-01-01')],start:'2026-01-01',end:'2026-01-31'});
 eq(r2.allocations.map(a=>a.estimated),[33,33,33]);eq(r2.unallocated,1);eq(r2.allocated+r2.unallocated,100);
 // 配分できない（建玉なし・保有日数0）場合はすべて未配分
 const r3=F.allocateSwap({periodSwapDelta:500,positions:[],start:'2026-01-01',end:'2026-01-31'});eq(r3.unallocated,500);
 const r4=F.allocateSwap({periodSwapDelta:500,positions:[P('Z',1000,'2026-02-01')],start:'2026-01-01',end:'2026-01-31'});eq([r4.allocations[0].estimated,r4.unallocated],[0,500]);
 // マイナスのスワップ（支払い）も同様
 const r5=F.allocateSwap({periodSwapDelta:-600,positions:[P('A',1,'2026-01-01'),P('B',2,'2026-01-01')],start:'2026-01-01',end:'2026-01-31'});eq(r5.allocations.map(a=>a.estimated),[-200,-400]);
}
console.log(`finance-core tests: ${n} assertions passed`);
