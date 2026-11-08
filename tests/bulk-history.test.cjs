process.env.TZ='Asia/Tokyo'; // 日付の扱いを端末のタイムゾーン（日本）で検証する
const assert=require('node:assert/strict');
const C=require('../history-core.js');
let n=0;const ok=(cond,msg)=>{assert.ok(cond,msg);n++;};const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);n++;};

let seq=0;const newId=p=>`${p}_${++seq}`;
const NOW='2026-11-07T01:23:45.000Z'; // 登録日時（対象日とは無関係な「今」）
const ctx=(o)=>({records:[],accountId:'acc1',templateId:'bank',rows:[],defaultKind:'manual_historical',reason:'',batchId:'batch_1',now:NOW,newId,timezone:'Asia/Tokyo',today:'2026-11-07',...o});
const row=(date,values,extra={})=>({recordId:null,base:null,date,entityId:'',values,memo:'',valueKind:'manual_historical',delete:false,...extra});

// ---------- parseNum ----------
eq(C.parseNum('１，２３４．５'),1234.5);eq(C.parseNum('−500'),-500);eq(C.parseNum('-1,000円'),-1000);eq(C.parseNum(''),null);eq(C.parseNum('  '),null);
ok(Number.isNaN(C.parseNum('abc')));ok(Number.isNaN(C.parseNum('1.2.3')));ok(Number.isNaN(C.parseNum('--5')));eq(C.parseNum('0.00000001'),1e-8);

// ---------- 日付：対象日と登録日時を区別 ----------
{
 const p=C.planBatch(ctx({rows:[row('2025-03-31',{balance:'1,000,000'})]}));
 eq(p.errors,[]);const r=p.items[0].after;
 eq(r.effectiveDate,'2025-03-31');eq(r.datePrecision,'date');eq(r.registeredAt,NOW);
 ok(r.effectiveAt!==r.registeredAt);eq(C.tsDate(r),'2025-03-31');
 ok(r.effectiveAt.startsWith('2025-03-30T15:00')); // 日本時間3/31 00:00 = UTC 3/30 15:00。UTC日付は1日ずれるため effectiveDate を別保持する
 eq(r.source,'bulk');eq(r.batchId,'batch_1');eq(r.deletedAt,null);eq(r.recordType,'bank_balance');
}
// 旧データ（effectiveDateなし）でも現地日付が導出できる
eq(C.tsDate({effectiveAt:'2025-03-30T15:00:00.000Z'}),'2025-03-31');
// 同じ日の複数行は登録可能（警告のみ）
{
 const p=C.planBatch(ctx({rows:[row('2025-04-01',{balance:'1'}),row('2025-04-01',{balance:'2'})]}));
 eq(p.errors,[]);eq(p.counts.create,2);ok(p.warnings.some(w=>/同じ対象日/.test(w.msg)));
}

// ---------- 検証 ----------
{
 let p=C.planBatch(ctx({rows:[row('2025-13-40',{balance:'1'})]}));ok(p.errors.length===1&&/対象日/.test(p.errors[0].msg));
 p=C.planBatch(ctx({rows:[row('2025-02-30',{balance:'1'})]}));ok(p.errors.length===1); // 存在しない日付
 p=C.planBatch(ctx({rows:[row('2025-01-01',{balance:'abc'})]}));ok(/数値ではありません/.test(p.errors[0].msg));
 p=C.planBatch(ctx({rows:[row('2025-01-01',{})]}));ok(/1つも入力/.test(p.errors[0].msg));
 p=C.planBatch(ctx({rows:[row('2025-01-01',{deposit:'-5',balance:'1'})]}));ok(/以上/.test(p.errors[0].msg)); // 入金は0以上
 p=C.planBatch(ctx({rows:[row('',{}),row('',{},{memo:''})]}));eq(p.errors,[]);eq(p.items.length,0); // 完全な空行は無視
 p=C.planBatch(ctx({accountId:'',rows:[row('2025-01-01',{balance:'1'})]}));ok(p.errors.some(e=>/口座/.test(e.msg)));
 p=C.planBatch(ctx({templateId:'crypto',rows:[row('2025-01-01',{quantity:'1'})]}));ok(/資産/.test(p.errors[0].msg)); // 暗号資産は資産(BTC/SOL)必須
 p=C.planBatch(ctx({rows:[row('2027-01-01',{balance:'1'})]}));eq(p.errors,[]);ok(p.warnings.some(w=>/未来/.test(w.msg)));
 // 負の値（調整額・損益）は許可
 p=C.planBatch(ctx({rows:[row('2025-01-01',{balance:'100',adjustment:'-30'})]}));eq(p.errors,[]);eq(p.items[0].after.values.adjustment,-30);
}

// ---------- 自動計算（欠けた1項目のみ。不一致は警告のみで上書きしない） ----------
{
 let d=C.computeDerived('bank',{openingBalance:100000,deposit:50000,withdrawal:20000,adjustment:1000,balance:null});eq(d.values.balance,131000);eq(d.derived,['balance']);
 d=C.computeDerived('bank',{openingBalance:null,deposit:50000,withdrawal:20000,adjustment:1000,balance:131000});eq(d.values.openingBalance,100000);
 d=C.computeDerived('bank',{openingBalance:100000,deposit:null,withdrawal:20000,adjustment:0,balance:130000});eq(d.values.deposit,50000);
 d=C.computeDerived('bank',{openingBalance:100000,deposit:0,withdrawal:null,adjustment:0,balance:90000});eq(d.values.withdrawal,10000);
 d=C.computeDerived('bank',{openingBalance:100000,deposit:null,withdrawal:null,adjustment:null,balance:90000});eq(d.derived,[]); // 2項目以上不明なら計算しない
 d=C.computeDerived('bank',{openingBalance:100000,deposit:1,withdrawal:1,adjustment:0,balance:5});eq(d.values.balance,5);ok(d.warnings.length===1); // 上書きしない
 d=C.computeDerived('securities',{effectivePrincipal:1000000,unrealizedProfitLoss:50000,valuation:null,cashBalance:10000});eq(d.values.valuation,1060000);
 d=C.computeDerived('securities',{effectivePrincipal:null,unrealizedProfitLoss:50000,valuation:1060000,cashBalance:10000});eq(d.values.effectivePrincipal,1000000);
 d=C.computeDerived('securities',{effectivePrincipal:1000000,unrealizedProfitLoss:50000,valuation:null,cashBalance:null});eq(d.values.valuation,1050000);ok(d.warnings.some(w=>/現金0円/.test(w)));
 d=C.computeDerived('dc',{effectivePrincipal:1000000,unrealizedProfitLoss:null,valuation:1200000});eq(d.values.unrealizedProfitLoss,200000);
 d=C.computeDerived('crypto',{quantity:0.5,referencePrice:10000000,valuation:null});eq(d.values.valuation,5000000);
 d=C.computeDerived('crypto',{quantity:null,referencePrice:10000000,valuation:5000000});eq(d.values.quantity,0.5);
 d=C.computeDerived('crypto',{quantity:2,referencePrice:null,valuation:300});eq(d.values.referencePrice,150);
 d=C.computeDerived('crypto',{quantity:null,referencePrice:0,valuation:300});eq(d.derived,[]);ok(d.warnings.length===1); // 0除算しない
 // 計算した項目は record.derivedFields に残り、実績と区別できる
 const p=C.planBatch(ctx({rows:[row('2025-05-31',{openingBalance:'100',deposit:'10',withdrawal:'0',adjustment:'0'})]}));
 eq(p.items[0].after.values.balance,110);eq(p.items[0].after.derivedFields,['balance']);
}

// ---------- 新規登録の適用：修正履歴・操作履歴 ----------
const baseState=()=>({schemaVersion:4,accounts:[{accountId:'acc1',accountName:'銀行A',accountType:'bank'}],timeSeriesRecords:[],timeSeriesRevisions:[],editHistory:[{historyId:'old',recordType:'account',recordId:'x',action:'edit'}]});
{
 const st=baseState();
 const p=C.planBatch(ctx({reason:'通帳から転記',rows:[row('2025-01-31',{balance:'100'}),row('2025-02-28',{balance:'200'})]}));
 C.applyPlan(st,p,newId);
 eq(st.timeSeriesRecords.length,2);eq(st.timeSeriesRevisions.length,2);
 ok(st.timeSeriesRevisions.every(r=>r.action==='create'&&r.before===null&&r.after&&r.batchId==='batch_1'&&r.reason==='通帳から転記'&&r.changedAt===NOW));
 eq(st.editHistory[0].recordType,'bulkHistory');eq(st.editHistory[0].after.counts.create,2);eq(st.editHistory[0].after.reason,'通帳から転記');
 ok(st.editHistory.some(h=>h.historyId==='old')); // 既存の操作履歴は保持
}

// ---------- 既存記録の一括編集：変更前後の追跡 ----------
const legacy=()=>({recordId:'ts_legacy',recordType:'bank_balance',accountId:'acc1',entityId:null,effectiveAt:'2025-03-31T03:30:00.000Z',registeredAt:'2025-04-02T00:00:00.000Z',updatedAt:'2025-04-02T00:00:00.000Z',timezone:'Asia/Tokyo',valueKind:'actual',source:'manual',values:{amount:777,quantity:null,rate:null,profitLoss:null,swap:null,balance:1000},memo:'旧',deletedAt:null});
{
 const st=baseState();st.timeSeriesRecords=[legacy()];
 // 値を変更：旧5項目(amount)など未知キーは保持、時刻も保持（日付が同じ）
 let p=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[row('2025-03-31',{balance:'1500'},{recordId:'ts_legacy',base:'2025-04-02T00:00:00.000Z',valueKind:'actual',memo:'旧'})]}));
 eq(p.errors,[]);eq(p.items[0].action,'edit');eq(p.items[0].changes.map(c=>c.key),['終了残高']);
 eq(p.items[0].after.values.amount,777);eq(p.items[0].after.effectiveAt,'2025-03-31T03:30:00.000Z');eq(p.items[0].after.datePrecision,'datetime');
 eq(p.items[0].after.registeredAt,'2025-04-02T00:00:00.000Z'); // 登録日時は不変
 eq(p.items[0].after.updatedAt,NOW);
 C.applyPlan(st,p,newId);
 const rev=st.timeSeriesRevisions[0];eq(rev.action,'edit');eq(rev.before.values.balance,1000);eq(rev.after.values.balance,1500);eq(rev.batchId,'batch_1');
 eq(st.timeSeriesRecords.length,1);
 // 変更なし → 保存対象外・履歴を作らない
 const st2=baseState();st2.timeSeriesRecords=[legacy()];
 p=C.planBatch(ctx({records:st2.timeSeriesRecords,rows:[row('2025-03-31',{balance:'1000'},{recordId:'ts_legacy',base:'2025-04-02T00:00:00.000Z',valueKind:'actual',memo:'旧'})]}));
 eq(p.items[0].action,'unchanged');eq(p.counts.unchanged,1);C.applyPlan(st2,p,newId);eq(st2.timeSeriesRevisions.length,0);eq(st2.timeSeriesRecords[0],legacy());
 // 日付を変更 → effectiveAt/effectiveDate更新、registeredAtは不変
 p=C.planBatch(ctx({records:[legacy()],rows:[row('2025-04-30',{balance:'1000'},{recordId:'ts_legacy',valueKind:'actual',memo:'旧'})]}));
 eq(p.items[0].after.effectiveDate,'2025-04-30');eq(p.items[0].after.datePrecision,'date');eq(p.items[0].changes[0].key,'対象日');eq(p.items[0].after.registeredAt,'2025-04-02T00:00:00.000Z');
}
// 旧データを読み込んだ行が正しい対象日になる
eq(C.tsDate(legacy()),'2025-03-31');

// ---------- 旧形式の既存記録（テンプレート項目が空）が一括編集の保存を妨げない ----------
{
 const old5=()=>({...legacy(),values:{amount:777,quantity:null,rate:null,profitLoss:null,swap:null}}); // balance を持たない旧形式
 const st=baseState();st.timeSeriesRecords=[old5()];
 const p=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[row('2025-03-31',{},{recordId:'ts_legacy',base:'2025-04-02T00:00:00.000Z',valueKind:'actual',memo:'旧'}),row('2025-04-30',{balance:'5'})]}));
 eq(p.errors,[]);eq(p.items[0].action,'unchanged');eq(p.items[1].action,'create');
 C.applyPlan(st,p,newId);eq(st.timeSeriesRecords.find(r=>r.recordId==='ts_legacy'),old5()); // 旧記録は1バイトも変わらない
 // 他の保存値もなく、数値が空の既存行は従来どおりエラー
 const p2=C.planBatch(ctx({records:[{...legacy(),values:{balance:null}}],rows:[row('2025-03-31',{},{recordId:'ts_legacy'})]}));ok(p2.errors.length===1);
 // 値を意図的に消した場合（balance 1000 → 空）は修正として扱う
 const p3=C.planBatch(ctx({records:[legacy()],rows:[row('2025-03-31',{},{recordId:'ts_legacy',valueKind:'actual',memo:'旧'})]}));eq(p3.items[0].action,'edit');
}
// ---------- 入力した行の順序が保存後も保たれる（同日複数行） ----------
{
 const st=baseState();
 const p=C.planBatch(ctx({rows:[row('2025-02-28',{balance:'1'}),row('2025-02-28',{balance:'2'}),row('2025-02-28',{balance:'3'})]}));C.applyPlan(st,p,newId);
 eq(st.timeSeriesRecords.map(r=>r.values.balance),[1,2,3]);
}

// ---------- 重複登録の防止・過去日付・後続データへの影響 ----------
{
 const st=baseState();
 const p1=C.planBatch(ctx({rows:[row('2025-05-31',{balance:'1000'})]}));C.applyPlan(st,p1,newId);
 // 既存と同じ内容（口座・種別・対象日・数値）は保存させない
 const p2=C.planBatch(ctx({batchId:'batch_2',records:st.timeSeriesRecords,rows:[row('2025-05-31',{balance:'1,000'})]}));
 eq(p2.items.length,0);ok(p2.errors.length===1&&/重複/.test(p2.errors[0].msg));
 // 同日でも数値が異なれば登録できる（同じ日に複数の記録）
 const p3=C.planBatch(ctx({batchId:'batch_3',records:st.timeSeriesRecords,rows:[row('2025-05-31',{balance:'1001'})]}));eq(p3.errors,[]);eq(p3.counts.create,1);
 // 同じ一括内の完全重複も拒否
 const p4=C.planBatch(ctx({batchId:'batch_4',rows:[row('2025-06-30',{balance:'5'}),row('2025-06-30',{balance:'5'})]}));ok(p4.errors.length===1&&/2行目|1行目/.test(p4.errors[0].msg));
 // 論理削除済みと同じ内容は再登録できる
 const st2=baseState();C.applyPlan(st2,C.planBatch(ctx({rows:[row('2025-05-31',{balance:'1000'})]})),newId);st2.timeSeriesRecords[0].deletedAt=NOW;
 eq(C.planBatch(ctx({batchId:'b9',records:st2.timeSeriesRecords,rows:[row('2025-05-31',{balance:'1000'})]})).errors,[]);
 // 既存行を編集して別の既存記録と同一になる場合も拒否
 const st3=baseState();C.applyPlan(st3,C.planBatch(ctx({rows:[row('2025-01-31',{balance:'1'}),row('2025-02-28',{balance:'2'})]})),newId);
 const [a,b]=st3.timeSeriesRecords;
 const p5=C.planBatch(ctx({batchId:'b10',records:st3.timeSeriesRecords,rows:[row('2025-02-28',{balance:'1'},{recordId:b.recordId,base:b.updatedAt,valueKind:b.valueKind,memo:''}),row('2025-01-31',{balance:'1'},{recordId:a.recordId,base:a.updatedAt,valueKind:a.valueKind,memo:''})]}));
 eq(p5.errors,[]); // 2行とも入れ替わるだけで日付が違うため重複しない
 // 過去日付の登録：登録日時は「今」、対象日は過去。後続の記録がある場合は影響確認の注意が出る
 const st4=baseState();C.applyPlan(st4,C.planBatch(ctx({rows:[row('2025-12-31',{balance:'100'})]})),newId);
 const p6=C.planBatch(ctx({batchId:'b11',records:st4.timeSeriesRecords,rows:[row('2020-01-15',{balance:'50'})]}));
 eq(p6.errors,[]);eq(p6.items[0].after.effectiveDate,'2020-01-15');eq(p6.items[0].after.registeredAt,NOW);eq(p6.items[0].laterCount,1);
 ok(p6.warnings.some(w=>/より後に 1 件の記録/.test(w.msg)));
 // 修正・削除でも後続への影響を通知
 const rec=st4.timeSeriesRecords[0];
 const st5=baseState();C.applyPlan(st5,C.planBatch(ctx({rows:[row('2025-01-31',{balance:'1'}),row('2025-12-31',{balance:'9'})]})),newId);
 const early=st5.timeSeriesRecords.find(r=>r.effectiveDate==='2025-01-31');
 const p7=C.planBatch(ctx({batchId:'b12',records:st5.timeSeriesRecords,rows:[row('2025-01-31',{balance:'2'},{recordId:early.recordId,base:early.updatedAt,valueKind:early.valueKind,memo:''})]}));
 eq(p7.items[0].laterCount,1);ok(p7.warnings.some(w=>/後続/.test(w.msg)));
 // 同じ一括操作IDの二重適用を拒否（二重保存の防止）
 const st6=baseState();const pp=C.planBatch(ctx({batchId:'dup_batch',rows:[row('2025-03-31',{balance:'7'})]}));C.applyPlan(st6,pp,newId);
 const snap=JSON.stringify(st6);assert.throws(()=>C.applyPlan(st6,pp,newId),/既に保存済み/);n++;eq(JSON.stringify(st6),snap);
}

// ---------- 論理削除 ----------
{
 const st=baseState();st.timeSeriesRecords=[legacy()];
 const p=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[row('2025-03-31',{},{recordId:'ts_legacy',delete:true})]}));
 eq(p.counts.delete,1);C.applyPlan(st,p,newId);
 eq(st.timeSeriesRecords.length,1);eq(st.timeSeriesRecords[0].deletedAt,NOW); // 物理削除しない
 const rev=st.timeSeriesRevisions[0];eq(rev.action,'logical_delete');eq(rev.before.deletedAt,null);eq(rev.after.deletedAt,NOW);
 // 削除済みを再度編集しようとするとエラー
 const p2=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[row('2025-03-31',{balance:'1'},{recordId:'ts_legacy'})]}));ok(p2.errors.length===1);
}

// ---------- 原子性・競合検出（途中失敗で半端な状態にしない） ----------
{
 const st=baseState();st.timeSeriesRecords=[legacy(),{...legacy(),recordId:'ts_b'}];
 const p=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[
  row('2025-03-31',{balance:'1'},{recordId:'ts_legacy',valueKind:'actual',memo:'旧'}),
  row('2025-03-31',{balance:'2'},{recordId:'ts_b',valueKind:'actual',memo:'旧'}),
  row('2025-06-30',{balance:'3'})]}));
 eq(p.errors,[]);
 // 計画作成後に別操作で ts_b が更新された
 st.timeSeriesRecords[1].updatedAt='2026-11-07T00:00:00.000Z';
 const snapshot=JSON.stringify(st);
 assert.throws(()=>C.applyPlan(st,p,newId),/他の操作/);n++;
 eq(JSON.stringify(st),snapshot); // 1件も変更されていない
 // 読み込み後に他で更新されていた場合は計画作成時点で検出
 const p3=C.planBatch(ctx({records:st.timeSeriesRecords,rows:[row('2025-03-31',{balance:'2'},{recordId:'ts_b',base:'2025-04-02T00:00:00.000Z'})]}));ok(/更新されています/.test(p3.errors[0].msg));
 // エラーのある計画は適用不可
 assert.throws(()=>C.applyPlan(baseState(),{errors:[{row:0,msg:'x'}],items:[]},newId));n++;
}

// ---------- 暗号資産：資産別・同日複数 ----------
{
 const p=C.planBatch(ctx({templateId:'crypto',rows:[row('2025-06-30',{quantity:'0.5',referencePrice:'10,000,000'},{entityId:'BTC'}),row('2025-06-30',{quantity:'10',valuation:'250000'},{entityId:'SOL'})]}));
 eq(p.errors,[]);eq(p.items[0].after.values.valuation,5000000);eq(p.items[1].after.values.referencePrice,25000);
 eq(p.items[0].after.recordType,'crypto_snapshot');eq(p.items[1].after.entityId,'SOL');
 ok(!p.warnings.some(w=>/同じ対象日/.test(w.msg))); // 資産が違えば重複扱いしない
}

// ---------- 履歴上限：10,000件まで切り捨てない（旧2,000件では監査履歴が失われた） ----------
{
 const st=baseState();st.editHistory=Array.from({length:3000},(_, i)=>({historyId:'h'+i,recordType:'account',recordId:'a',action:'edit'}));
 const p=C.planBatch(ctx({rows:[row('2025-01-01',{balance:'1'})]}));C.applyPlan(st,p,newId);
 eq(st.editHistory.length,3001);eq(C.EDIT_HISTORY_LIMIT,10000);
}

// ---------- base64：大きなデータでも失敗しない（旧実装はスプレッド展開で上限超過） ----------
{
 const big=new Uint8Array(300000);for(let i=0;i<big.length;i++)big[i]=i%251;
 let oldFails=false;try{btoa(String.fromCharCode(...big));}catch(e){oldFails=true;}
 ok(oldFails,'旧実装の上限超過を再現');
 const b64=C.bytesToBase64(big);const back=C.base64ToBytes(b64);
 eq(back.length,big.length);ok(Buffer.compare(Buffer.from(back),Buffer.from(big))===0);
 eq(C.bytesToBase64(new Uint8Array([1,2,3])),'AQID');
}

// ---------- テンプレート ----------
eq(C.templateIdForAccountType('bank'),'bank');eq(C.templateIdForAccountType('fx'),'fx');eq(C.templateIdForAccountType('ideco'),'dc');eq(C.templateIdForAccountType('dc'),'dc');
eq(C.templateIdForAccountType('crypto'),'crypto');eq(C.templateIdForAccountType('nisa'),'securities');eq(C.templateIdForAccountType(undefined),'securities');
for(const t of Object.values(C.TEMPLATES))for(const f of t.fields)ok(C.VALUE_LABELS[f.key],`表示ラベル未定義: ${f.key}`);

console.log(`bulk-history tests: ${n} assertions passed`);
