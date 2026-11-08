/* 実ブラウザ総合テスト（開発用・任意）。Playwright(Chromium)が必要。
   使い方: node tests/e2e-browser.cjs <旧版alpha1のフォルダ> <新版のフォルダ>
   同じ origin(ポート) 上で旧版→新版へ切り替え、IndexedDBの既存データが保たれることを確認します。
   ※ WebKit(iPhone Safari)ではなくChromiumでの検証です。実機確認は TEST_CHECKLIST を参照。 */
const http=require('http'),fs=require('fs'),path=require('path');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'));}catch(e){({chromium}=require('/opt/npm-tools/node_modules/playwright'));}
const OLD=path.resolve(process.argv[2]||'../old'),NEW=path.resolve(process.argv[3]||'..');
const SHOTS=process.env.SHOTS_DIR||'';
let root=OLD;
const srv=http.createServer((q,s)=>{const u=q.url.split('?')[0];const p=path.join(root,u==='/'?'index.html':u);fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);return s.end();}
 const t={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json'}[path.extname(p)]||'text/plain';
 s.writeHead(200,{'Content-Type':t+'; charset=utf-8','Cache-Control':'no-cache'});s.end(d);});});
let pass=0,fail=0,phase='';const results=[],records=[];
const check=(name,cond,detail='')=>{records.push({phase,name,pass:!!cond,detail:String(detail||'')});if(cond){pass++;results.push('  ✔ '+name);}else{fail++;results.push('  ✘ '+name+(detail?'  → '+detail:''));}};
const section=t=>{phase=t;results.push(t);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const idbGet=pg=>pg.evaluate(()=>new Promise((res,rej)=>{const o=indexedDB.open('pam_local_v2');o.onsuccess=()=>{const r=o.result.transaction('state').objectStore('state').get('state');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);};o.onerror=()=>rej(o.error);}));
const idbKey=(pg,k)=>pg.evaluate(k=>new Promise((res,rej)=>{const o=indexedDB.open('pam_local_v2');o.onsuccess=()=>{const r=o.result.transaction('state').objectStore('state').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);};o.onerror=()=>rej(o.error);}),k);
const idbPut=(pg,v)=>pg.evaluate(v=>new Promise((res,rej)=>{const o=indexedDB.open('pam_local_v2');o.onsuccess=()=>{const tx=o.result.transaction('state','readwrite');tx.objectStore('state').put(v,'state');tx.oncomplete=res;tx.onerror=()=>rej(tx.error);};}),v);

const LEGACY_TS={recordId:'ts_legacy_1',recordType:'bank_balance',accountId:'bank1',entityId:null,effectiveAt:'2025-03-31T03:30:00.000Z',registeredAt:'2025-04-02T00:00:00.000Z',updatedAt:'2025-04-02T00:00:00.000Z',timezone:'Asia/Tokyo',valueKind:'actual',source:'manual',values:{amount:777,quantity:null,rate:null,profitLoss:null,swap:null},memo:'旧記録',deletedAt:null};
const SEED={schemaVersion:4,dataType:'personal_asset_manager',exportDate:'2026-11-01',
 accounts:[['bank1','テスト銀行','bank'],['fx1','テストFX','fx'],['ideco1','テストiDeCo','ideco'],['sec1','テスト楽天証券','nisa'],['crypto1','テスト取引所','crypto'],['dc1','テスト企業型DC','dc']].map(([accountId,accountName,accountType])=>({accountId,accountName,accountType,currency:'JPY',institutionName:'テスト'})),
 fxPositions:[{positionId:'p1',accountId:'fx1',currencyPair:'TRY/JPY',side:'buy',status:'open',openDate:'2025-01-10',openPrice:4.5,originalQuantity:100000,closedQuantity:0,remainingQuantity:100000,executionDate:'2025-01-10',originalExecutionRate:4.5,dailySwapAmount:12,registeredAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'}],
 fxTransactions:[],fxSwapRecords:[],holdings:[{holdingId:'h1',accountId:'sec1',productName:'テスト投信',currentEvaluationAmount:500000}],
 balanceSnapshots:[{snapshotId:'s1',accountId:'bank1',snapshotDate:'2026-10-31',balance:1234567}],contributionRecords:[],cashTransactions:[],fees:[],
 editHistory:[{historyId:'e1',timestamp:'2026-10-01T00:00:00.000Z',recordType:'account',recordId:'bank1',action:'create',before:null,after:{accountId:'bank1',accountName:'テスト銀行'}}],
 timeSeriesRecords:[LEGACY_TS],timeSeriesRevisions:[{revisionId:'rev_old',recordId:'ts_legacy_1',action:'create',changedAt:'2025-04-02T00:00:00.000Z',reason:'',before:null,after:LEGACY_TS}],
 importMetadata:{},excelHistoricalDatabase:{},excelSimulationDatabase:{},simulationMetadata:{}};

(async()=>{
 await new Promise(r=>srv.listen(0,r));const base=`http://localhost:${srv.address().port}/`;
 const browser=await chromium.launch();const browserVersion='Chromium '+browser.version();
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,timezoneId:'Asia/Tokyo',locale:'ja-JP'});
 const dialogs=[],errors=[];
 const hook=pg=>{pg.on('dialog',d=>{dialogs.push(d.type()+':'+d.message());d.accept();});pg.on('pageerror',e=>errors.push(e.message));};
 let pg=await ctx.newPage();hook(pg);

 // ===== Phase A: 旧版(alpha1)に実データ相当を投入 =====
 section('A. 旧版 v0.5.0-alpha1 での確認');
 await pg.goto(base);await pg.waitForFunction(()=>document.getElementById('appVersion').textContent.includes('alpha1'));
 await idbPut(pg,SEED);await pg.reload();await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6');
 const S0=await idbGet(pg);
 // 旧版の不具合の再現（入出金保存）
 await pg.click('[data-tab="cash"]');await pg.click('#addCashTransaction');await pg.selectOption('#cashSource','bank1');await pg.selectOption('#cashTarget','fx1');await pg.fill('#cashAmount','100000');await pg.fill('#cashFee','220');
 dialogs.length=0;await pg.click('#cashForm button[type=submit]');await sleep(300);
 check('【旧版の不具合再現】入出金が保存できない',dialogs.some(d=>/transfer is not defined/.test(d)));
 await pg.click('#closeCash');
 // 旧版の暗号化バックアップ：大きなデータで失敗（メモリ上のみ。保存しない）
 await pg.evaluate(()=>{for(let i=0;i<4000;i++)state.timeSeriesRecords.push({recordId:'big'+i,recordType:'other',accountId:'bank1',effectiveAt:'2025-01-01T00:00:00.000Z',registeredAt:'2025-01-01T00:00:00.000Z',values:{amount:i},memo:'x'.repeat(200),deletedAt:null});});
 await pg.click('[data-tab="data"]');await pg.fill('#backupPassword','longpassword1234');dialogs.length=0;await pg.click('#exportEncrypted');await sleep(2500);
 check('【旧版の不具合再現】大きなデータで暗号化バックアップが失敗',dialogs.some(d=>/call stack|Maximum/i.test(d)),dialogs.join('|'));
 await pg.evaluate(()=>{state.timeSeriesRecords=state.timeSeriesRecords.filter(r=>!r.recordId.startsWith('big'));});
 await pg.close();

 // ===== Phase B: 同一origin上で新版へ更新（IndexedDB維持） =====
 section('B. 新版 v0.6.x へ更新（同じ端末データ・schemaVersion 4→5）');
 root=NEW;let cycles=0,version='';
 for(;cycles<6;cycles++){pg=await ctx.newPage();hook(pg);await pg.goto(base);await pg.waitForFunction(()=>document.getElementById('appVersion').textContent!=='—');version=await pg.textContent('#appVersion');if(version.includes('0.6.'))break;await pg.close();await sleep(1200);}
 check('更新後に新版が表示される（画面を閉じて開き直す手順）',version.includes('0.6.'),`version=${version}, 開き直し回数=${cycles}`);
 results.push(`    （新版が表示されるまでの開き直し回数: ${cycles}）`);
 await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6');
 const S1=await idbGet(pg);
 const keysSame=Object.keys(S0).filter(k=>!['schemaVersion','exportDate'].includes(k)).every(k=>JSON.stringify(S0[k])===JSON.stringify(S1[k]));
 check('旧バージョン(v4)のデータを移行しても、既存の全項目が変わらない',keysSame);
 check('移行：schemaVersion 4→5、予約配列を追加、移行履歴を記録',S1.schemaVersion===5&&['fxCorrections','swapRateHistory','liabilities','loanRepayments','cryptoTransactions'].every(k=>Array.isArray(S1[k]))&&S1.migrationHistory.length===1&&S1.migrationHistory[0].from===4);
 const preMig=await idbKey(pg,'pre_migration_backup');
 check('移行前の状態が別キーに控えとして保存される（完全一致）',!!preMig&&preMig.fromVersion===4&&JSON.stringify(preMig.state)===JSON.stringify(S0));
 await pg.reload();await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6');const S1b=await idbGet(pg);
 check('再起動しても移行は重複実行されない（冪等）',S1b.migrationHistory.length===1&&JSON.stringify(S1b)===JSON.stringify(S1));
 check('JS実行エラーなし（起動）',errors.length===0,errors.join('|'));
 const caches=await pg.evaluate(async()=>(await caches.keys()));
 check('旧キャッシュが削除され新キャッシュのみ',caches.length===1&&caches[0]==='pam-shell-v0.6.1-alpha1',caches.join(','));
 const cached=await pg.evaluate(async()=>(await (await caches.open('pam-shell-v0.6.1-alpha1')).keys()).map(r=>new URL(r.url).pathname));
 check('必要なアプリファイルだけがオフライン用キャッシュに入る',['/history-core.js','/store-core.js','/finance-core.js','/app.js','/index.html'].every(f=>cached.includes(f))&&cached.every(f=>['/','/index.html','/styles.css','/app.js','/history-core.js','/store-core.js','/finance-core.js','/manifest.webmanifest'].includes(f)),cached.join(','));

 // ===== Phase C: 入出金の不具合修正 =====
 section('C. 入出金（不具合修正）');
 await pg.click('[data-tab="cash"]');await pg.click('#addCashTransaction');await pg.selectOption('#cashSource','bank1');await pg.selectOption('#cashTarget','fx1');await pg.fill('#cashAmount','100000');await pg.fill('#cashFee','220');await pg.selectOption('#cashFeeAccount','bank1');
 dialogs.length=0;await pg.click('#cashForm button[type=submit]');await sleep(400);
 let st=await idbGet(pg);
 check('口座間振替が保存できる',st.cashTransactions.length===1&&dialogs.length===0,dialogs.join('|'));
 check('手数料が1件だけ登録される',st.fees.length===1&&st.fees[0].amount===220);
 const eff=await pg.evaluate(()=>[cashEffect(state.cashTransactions[0],'bank1'),cashEffect(state.cashTransactions[0],'fx1')]);
 check('銀行 -100,220円 / FX +100,000円',eff[0]===-100220&&eff[1]===100000,eff.join(','));
 await pg.click('[data-cash-edit]');await pg.fill('#cashMemo','編集テスト');await pg.click('#cashForm button[type=submit]');await sleep(300);
 st=await idbGet(pg);check('入出金の編集も保存でき、修正履歴が残る',st.cashTransactions[0].memo==='編集テスト'&&st.editHistory.some(h=>h.recordType==='cashTransaction'&&h.action==='edit'&&h.before&&h.after));
 await pg.click('[data-cash-edit]');await pg.click('#deleteCash');await sleep(300);
 st=await idbGet(pg);check('入出金の削除は論理削除（記録・関連手数料は残り、集計から除外、操作履歴に削除前の内容）',st.cashTransactions.length===1&&!!st.cashTransactions[0].deletedAt&&!!st.fees[0].deletedAt&&st.editHistory.some(h=>h.recordType==='cashTransaction'&&h.action==='delete'&&h.before&&h.before.deletedAt===undefined));
 check('論理削除した入出金は一覧・手数料一覧・残高差額に出ない',(await pg.textContent('#cashSummary')).includes('0件')&&(await pg.textContent('#feeCount'))==='0件'&&(await pg.evaluate(()=>cashNetByCurrency('bank1')))==='0円');
 const openCash=async(o)=>{await pg.click('#addCashTransaction');await pg.selectOption('#cashType',o.type);if(o.src)await pg.selectOption('#cashSource',o.src);if(o.dst)await pg.selectOption('#cashTarget',o.dst);if(o.type!=='fee')await pg.fill('#cashAmount',String(o.amount));await pg.fill('#cashFee',String(o.fee));if(o.feeAcc)await pg.selectOption('#cashFeeAccount',o.feeAcc);if(o.mode)await pg.selectOption('#cashFeeMode',o.mode);await pg.click('#cashForm button[type=submit]');await sleep(350);};
 await openCash({type:'transfer',src:'bank1',dst:'fx1',amount:100000,fee:220,feeAcc:'bank1',mode:'deducted'});
 await openCash({type:'transfer',src:'bank1',dst:'fx1',amount:100000,fee:220,feeAcc:'sec1',mode:'additional'});
 await openCash({type:'deposit',dst:'bank1',amount:50000,fee:0});
 await openCash({type:'withdrawal',src:'fx1',amount:30000,fee:330,feeAcc:'fx1',mode:'additional'});
 await openCash({type:'fee',fee:550,feeAcc:'bank1'});
 st=await idbGet(pg);const live=st.cashTransactions.filter(t=>!t.deletedAt);
 const effs=await pg.evaluate(()=>state.cashTransactions.filter(t=>!t.deletedAt).map(t=>({t:t.transactionType,mode:t.feeMode,b:cashEffect(t,'bank1'),f:cashEffect(t,'fx1'),s:cashEffect(t,'sec1')})).reverse());
 check('手数料deducted：銀行-100,000／FX+99,780',effs[0].b===-100000&&effs[0].f===99780,JSON.stringify(effs[0]));
 check('手数料additional・第三口座(sec1)が負担：銀行-100,000／FX+100,000／第三-220',effs[1].b===-100000&&effs[1].f===100000&&effs[1].s===-220,JSON.stringify(effs[1]));
 check('外部入金・外部出金・単独手数料',effs[2].b===50000&&effs[3].f===-30330&&effs[4].b===-550,JSON.stringify(effs.slice(2)));
 check('保存された入出金5件に対し手数料レコードは手数料のある4件のみ',live.length===5&&st.fees.filter(f=>!f.deletedAt).length===4);

 // ===== Phase D: 履歴一括入力（新規） =====
 section('D. 履歴一括入力：新規登録');
 await pg.click('[data-tab="bulk"]');await pg.selectOption('#bulkAccount','bank1');
 check('銀行口座を選ぶと「銀行口座」の入力項目セットになる',(await pg.inputValue('#bulkTemplate'))==='bank');
 for(let i=0;i<4;i++)await pg.click('#bulkAddRow');
 const rowsN=await pg.locator('.bulk-row').count();check('行を追加できる',rowsN===4);
 const setRow=async(i,date,vals)=>{const r=pg.locator('.bulk-row').nth(i);await r.locator('[data-f="date"]').fill(date);for(const [k,v] of Object.entries(vals))await r.locator(`[data-f="v:${k}"]`).fill(v);};
 await setRow(0,'2025-01-31',{openingBalance:'100,000',deposit:'50000',withdrawal:'20000',adjustment:'1000'});
 await setRow(1,'2025-02-28',{balance:'200000'});
 await setRow(2,'2025-02-28',{balance:'210000'});
 await setRow(3,'2025-03-31',{balance:'abc'});
 await pg.fill('#bulkReason','通帳から転記');
 await pg.click('#bulkPreview');
 check('エラー行があると確認画面で保存ボタンが無効',await pg.isDisabled('#bulkCommit')&&(await pg.textContent('#bulkPlanSummary')).includes('数値ではありません'));
 await pg.click('#bulkBack');
 await pg.locator('.bulk-row').nth(3).locator('[data-bulk-act="del"]').click();
 check('新規行を消せる',await pg.locator('.bulk-row').count()===3);
 // 下書き自動保存→再起動で復元
 await sleep(900);const draft=await idbKey(pg,'bulk_draft');check('入力途中の下書きが端末内に自動保存される',draft&&draft.rows.length===3);
 const dbefore=JSON.stringify(await idbGet(pg));
 await pg.reload();await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6');
 check('再読み込み後に下書きが復元される',(await pg.locator('#bulkNotice').textContent()).includes('下書き')&&(await pg.evaluate(()=>bulk.rows.length))===3);
 check('下書き保存は資産データ(state)を変更しない',dbefore===JSON.stringify(await idbGet(pg)));
 await pg.click('[data-tab="bulk"]');
 await pg.click('#bulkPreview');
 const sum=await pg.textContent('#bulkPlanSummary');
 check('確認画面に新規3件・同日複数行の注意・自動計算が表示',sum.includes('新規')&&(await pg.textContent('#bulkPlanList')).includes('自動計算：終了残高')&&sum.includes('同じ対象日'));
 if(SHOTS){await pg.screenshot({path:path.join(SHOTS,'confirm.png'),fullPage:false});}
 if(await pg.isDisabled('#bulkCommit'))results.push('    DIAG: '+(await pg.textContent('#bulkPlanSummary')).replace(/\s+/g,' ')+' / rows='+JSON.stringify(await pg.evaluate(()=>bulk.rows)));
 await pg.click('#bulkCommit',{timeout:3000});await sleep(500);
 st=await idbGet(pg);
 const recs=st.timeSeriesRecords.filter(r=>r.batchId);
 check('3件がtimeSeriesRecordsに保存される',recs.length===3&&st.timeSeriesRecords.length===4);
 const r1=recs.find(r=>r.effectiveDate==='2025-01-31');
 check('対象日(effectiveDate)と登録日時(registeredAt)が別々',!!r1&&r1.registeredAt.startsWith('2026-')&&r1.datePrecision==='date'&&r1.source==='bulk');
 check('自動計算した終了残高=131,000と derivedFields',r1.values.balance===131000&&r1.derivedFields[0]==='balance');
 check('各行に新規の修正履歴(batchId・理由付き)',st.timeSeriesRevisions.filter(x=>x.action==='create'&&x.batchId===r1.batchId&&x.reason==='通帳から転記').length===3);
 check('操作履歴に一括操作が1件',st.editHistory[0].recordType==='bulkHistory'&&st.editHistory[0].after.counts.create===3);
 check('保存後に下書きが消える',(await idbKey(pg,'bulk_draft'))===null);
 check('既存データ(口座・建玉・保有・残高・旧時系列)が不変',['accounts','fxPositions','holdings','balanceSnapshots'].every(k=>JSON.stringify(st[k])===JSON.stringify(S0[k]))&&JSON.stringify(st.timeSeriesRecords.find(r=>r.recordId==='ts_legacy_1'))===JSON.stringify(LEGACY_TS));
 await pg.click('[data-tab="timeline"]');const tlText=await pg.textContent('#timelineList');
 check('時系列履歴一覧に表示され、新旧の項目名で値が出る',tlText.includes('終了残高')||tlText.includes('残高'));
 check('日付のみの記録は「日付のみ」と表示',tlText.includes('2025-01-31（日付のみ）'));
 await pg.click('[data-tab="history"]');check('操作履歴に一括操作が表示され、誤った「編集」ボタンが出ない',(await pg.textContent('#historyList')).includes('履歴一括入力')&&!(await pg.locator('#historyList .item').first().locator('[data-history-view]').count()));

 // ===== Phase E: 一括編集・論理削除 =====
 section('E. 履歴一括入力：既存の一括編集・論理削除');
 await pg.click('[data-tab="bulk"]');await pg.click('#bulkLoad');
 check('既存4件（一括入力3件＋旧形式1件）が対象日順に読み込まれる',(await pg.locator('.bulk-row').count())===4&&(await pg.locator('.bulk-row').nth(0).locator('[data-f="date"]').inputValue())==='2025-01-31'&&(await pg.locator('.bulk-row').nth(3).locator('[data-f="date"]').inputValue())==='2025-03-31');
 check('旧形式の記録の「ほかの保存値(金額777円)」が表示される',(await pg.locator('.bulk-row').nth(3).textContent()).includes('金額 777円'));
 await pg.locator('.bulk-row').nth(1).locator('[data-f="v:balance"]').fill('205000');
 await pg.locator('.bulk-row').nth(2).locator('[data-bulk-act="del"]').click();
 await pg.fill('#bulkReason','誤記訂正');
 await pg.click('#bulkPreview');
 const lst=await pg.textContent('#bulkPlanList');
 check('確認画面に 修正前→修正後 と論理削除が表示',lst.includes('200,000円 → 205,000円')&&lst.includes('論理削除'));
 await pg.click('#bulkCommit');await sleep(500);st=await idbGet(pg);
 const edited=st.timeSeriesRecords.find(r=>r.effectiveDate==='2025-02-28'&&r.values.balance===205000);
 const rev=st.timeSeriesRevisions.find(x=>x.action==='edit'&&x.recordId===edited.recordId);
 check('修正前後(200,000→205,000)が修正履歴に残る',rev&&rev.before.values.balance===200000&&rev.after.values.balance===205000&&rev.reason==='誤記訂正');
 check('登録日時は不変・最終変更日時のみ更新',edited.registeredAt===rev.before.registeredAt&&edited.updatedAt!==rev.before.updatedAt);
 const del=st.timeSeriesRecords.find(r=>r.deletedAt);
 check('削除は論理削除（記録は残り、前後の履歴あり）',!!del&&st.timeSeriesRevisions.some(x=>x.action==='logical_delete'&&x.recordId===del.recordId&&x.before.deletedAt===null));
 await pg.click('[data-tab="timeline"]');check('論理削除した記録は通常一覧から非表示',!(await pg.textContent('#timelineList')).includes('210,000'));
 await pg.click('[data-tab="bulk"]');await pg.click('#bulkLoad');check('再読み込みで論理削除した行は出ない（残り3件）',(await pg.locator('.bulk-row').count())===3);
 await pg.click('#bulkDiscard');

 // ===== Phase F: 既存の個別編集が一括入力の値を壊さない =====
 section('F. 既存の個別編集との共存');
 await pg.click('[data-tab="timeline"]');
 const bulkId=edited.recordId;await pg.click(`[data-timeline-open="${bulkId}"]`);await pg.fill('#tlReason','個別画面で保存');await pg.click('#timelineForm button[type=submit]');await sleep(400);
 st=await idbGet(pg);const after=st.timeSeriesRecords.find(r=>r.recordId===bulkId);
 check('個別編集画面で保存しても一括入力の値(終了残高)が消えない',after.values.balance===205000&&!!after.batchId&&after.source==='bulk');
 check('個別編集で日時を触らなければ対象日が保たれる',after.effectiveDate==='2025-02-28'&&after.datePrecision==='date');
 await pg.click(`[data-timeline-open="ts_legacy_1"]`);await pg.click('#timelineForm button[type=submit]');await sleep(400);
 st=await idbGet(pg);const lg=st.timeSeriesRecords.find(r=>r.recordId==='ts_legacy_1');
 check('旧記録を個別画面で保存しても値・登録日時が保たれる',lg.values.amount===777&&lg.registeredAt===LEGACY_TS.registeredAt&&lg.effectiveAt===LEGACY_TS.effectiveAt);

 // ===== Phase G: 各口座種別のテンプレート =====
 section('G. 各口座種別');
 const tplCheck=async(acc,tplId,fields,entity)=>{await pg.click('[data-tab="bulk"]');await pg.selectOption('#bulkAccount',acc);const t=await pg.inputValue('#bulkTemplate');await pg.click('#bulkAddRow');const r=pg.locator('.bulk-row').nth(0);await r.locator('[data-f="date"]').fill('2025-06-30');for(const [k,v] of Object.entries(fields))await r.locator(`[data-f="v:${k}"]`).fill(v);if(entity)await r.locator('[data-f="entityId"]').selectOption(entity);await pg.click('#bulkPreview');const ok=!(await pg.isDisabled('#bulkCommit'));if(ok){await pg.click('#bulkCommit');await sleep(350);}else{await pg.click('#bulkBack');await pg.click('#bulkDiscard');}return {t,ok};};
 let x=await tplCheck('fx1','fx',{referenceRate:'4.52',balance:'300000',netAssetValue:'310000',marginRequirement:'50000',positionQuantity:'100000',fxProfitLoss:'-12,000',accumulatedSwap:'8000'});check('FX口座：テンプレート自動選択と保存',x.t==='fx'&&x.ok);
 x=await tplCheck('sec1','securities',{effectivePrincipal:'1000000',unrealizedProfitLoss:'50000',cashBalance:'10000'});check('楽天証券(nisa種別)：証券テンプレートで保存',x.t==='securities'&&x.ok);
 x=await tplCheck('ideco1','dc',{effectivePrincipal:'500000',valuation:'560000'});check('iDeCo：DCテンプレートで保存（含み損益を逆算）',x.t==='dc'&&x.ok);
 x=await tplCheck('dc1','dc',{cumulativePrincipal:'800000',effectivePrincipal:'800000',unrealizedProfitLoss:'40000'});check('企業型DC：DCテンプレートで保存',x.t==='dc'&&x.ok);
 x=await tplCheck('crypto1','crypto',{quantity:'0.5',referencePrice:'10000000'},'BTC');check('暗号資産取引所：BTCで保存（評価額を計算）',x.t==='crypto'&&x.ok);
 st=await idbGet(pg);
 const sec=st.timeSeriesRecords.find(r=>r.accountId==='sec1'&&r.batchId),dc=st.timeSeriesRecords.find(r=>r.accountId==='ideco1'&&r.batchId),cr=st.timeSeriesRecords.find(r=>r.accountId==='crypto1'&&r.batchId);
 check('計算値：証券1,060,000 / iDeCo含み損益60,000 / BTC評価額5,000,000',sec.values.valuation===1060000&&dc.values.unrealizedProfitLoss===60000&&cr.values.valuation===5000000&&cr.entityId==='BTC'&&cr.recordType==='crypto_snapshot');

 // ===== Phase J: 保存の安全性 =====
 section('J. 保存の安全性（ロールバック・描画失敗・二重送信）');
 const idle=()=>pg.waitForFunction(()=>busy===false);
 const editName=async(acc,name)=>{await pg.evaluate(a=>openEditor('account',a),acc);await pg.fill('#f_accountName',name);await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);};
 {
  const before=JSON.stringify(await idbGet(pg));const nameBefore=await pg.evaluate(()=>state.accounts.find(a=>a.accountId==='bank1').accountName);
  await pg.evaluate(()=>{window.__put=window.dbPut;window.dbPut=()=>Promise.reject(new Error('disk full (simulated)'));});
  dialogs.length=0;await editName('bank1','保存失敗テスト名');
  check('IndexedDB保存失敗時：エラーが表示され「反映されていません」と明示',dialogs.some(d=>/保存できませんでした.*反映されていません/s.test(d)),dialogs.join('|'));
  check('保存失敗時：メモリ上のデータは変更前のまま',(await pg.evaluate(()=>state.accounts.find(a=>a.accountId==='bank1').accountName))===nameBefore);
  check('保存失敗時：IndexedDBも変更なし（不一致なし）',JSON.stringify(await idbGet(pg))===before);
  check('保存失敗時：画面の一覧は変更前のまま・入力ダイアログは開いたまま（入力を失わない）',!(await pg.textContent('#accountList')).includes('保存失敗テスト名')&&await pg.evaluate(()=>document.getElementById('editorDialog').open));
  check('保存失敗時：保存状態が「保存失敗」と表示される',(await pg.textContent('#lastSaved')).includes('保存失敗'));
  await pg.evaluate(()=>{window.dbPut=window.__put;});
  await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
  check('復旧後は同じ入力でそのまま保存できる',(await idbGet(pg)).accounts.find(a=>a.accountId==='bank1').accountName==='保存失敗テスト名'&&(await pg.textContent('#lastSaved')).includes('保存 '));
  // 描画失敗でも保存済みデータは整合
  await pg.evaluate(()=>{window.__render=window.render;window.render=()=>{throw new Error('render boom (simulated)');};});
  const e0=errors.length;dialogs.length=0;await editName('bank1','描画失敗テスト名');
  const idb=await idbGet(pg),mem=await pg.evaluate(()=>JSON.parse(JSON.stringify(state)));
  check('描画失敗時：データはIndexedDBに保存され、メモリ上のデータと完全に一致',idb.accounts.find(a=>a.accountId==='bank1').accountName==='描画失敗テスト名'&&JSON.stringify(idb)===JSON.stringify(mem));
  check('描画失敗時：未処理エラーにならず、画面更新の失敗が通知される（データは保存済み）',errors.length===e0&&(await pg.textContent('#lastSaved')).includes('画面更新に失敗'));
  await pg.evaluate(()=>{window.render=window.__render;safeRender();});await pg.evaluate(()=>document.getElementById('editorDialog').open&&document.getElementById('editorDialog').close());
  // 入力エラーは状態を変えず、保存失敗とも表示しない
  const b2=JSON.stringify(await idbGet(pg));await pg.click('[data-tab="cash"]');await pg.click('#addCashTransaction');await pg.selectOption('#cashType','deposit');await pg.fill('#cashAmount','0');dialogs.length=0;await pg.click('#cashForm button[type=submit]');await sleep(300);
  check('入力エラー：メッセージ表示のみで、データは変更されない',dialogs.some(d=>/入出金額/.test(d))&&JSON.stringify(await idbGet(pg))===b2&&!(await pg.textContent('#lastSaved')).includes('保存失敗'));
  await pg.click('#closeCash');
  // 二重送信
  await pg.evaluate(()=>openEditor('account'));await pg.fill('#f_accountName','二重送信テスト');await pg.evaluate(()=>{const f=document.getElementById('editorForm');f.requestSubmit();f.requestSubmit();});await idle();await sleep(300);
  check('二重送信しても1件だけ登録される',(await idbGet(pg)).accounts.filter(a=>a.accountName==='二重送信テスト').length===1);
  await pg.evaluate(()=>{const d=document.getElementById('editorDialog');if(d.open)d.close();});
  // 想定外エラーで「画面上だけの未保存の変更」が残らない
  const e1=errors.length;dialogs.length=0;
  await pg.evaluate(()=>{state.accounts[0].accountName='未保存のまま残る名前';Promise.reject(new Error('unexpected'));});await sleep(400);errors.length=e1;
  check('想定外エラー時：保存されていない変更を取り消し、IndexedDBと一致させる',(await pg.evaluate(()=>state.accounts[0].accountName))!=='未保存のまま残る名前'&&dialogs.some(d=>/取り消しました/.test(d)));
  check('保存した口座情報の整合性（IDの重複・孤立参照なし）',await pg.evaluate(()=>PAMStore.checkIntegrity(state).length===0));
 }

 // ===== Phase K: IDと固定情報の保護 =====
 section('K. ID・固定情報の保護');
 {
  const snapshot=async()=>JSON.stringify(await idbGet(pg));
  await pg.evaluate(()=>openEditor('account','bank1'));
  check('口座IDの入力欄は編集不可',await pg.evaluate(()=>document.getElementById('f_accountId').readOnly));
  await pg.evaluate(()=>{const e=document.getElementById('f_accountId');e.readOnly=false;e.value='hacked_id';document.getElementById('f_accountName').value='ID改ざん試験';});
  await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
  let st=await idbGet(pg);
  check('入力欄を改ざんしても口座IDは変わらない（参照が壊れない）',st.accounts.some(a=>a.accountId==='bank1'&&a.accountName==='ID改ざん試験')&&!st.accounts.some(a=>a.accountId==='hacked_id')&&st.balanceSnapshots.some(x=>x.accountId==='bank1'));
  await pg.evaluate(()=>document.getElementById('editorDialog').open&&document.getElementById('editorDialog').close());
  await pg.evaluate(()=>openEditor('position','p1'));
  const ro=await pg.evaluate(()=>['f_positionId','f_executionDate','f_originalExecutionRate','f_originalQuantity','f_closedQuantity','f_remainingQuantity'].map(i=>document.getElementById(i).readOnly));
  check('建玉ID・約定日・約定レート・当初数量・決済/残数量は編集不可',ro.every(Boolean),ro.join(','));
  const base=await snapshot();
  for(const [id,val,label] of [['f_originalQuantity','5','約定数量'],['f_executionDate','2025-02-02','約定日'],['f_originalExecutionRate','9.9','約定レート'],['f_positionId','p_hacked','建玉ID']]){
   await pg.evaluate(([i,v])=>{const e=document.getElementById(i);e.readOnly=false;e.value=v;},[id,val]);dialogs.length=0;
   await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
   check(`建玉の${label}を改ざんしても保存されない（変更不可のメッセージ）`,dialogs.some(d=>/変更できません/.test(d))&&await snapshot()===base,dialogs.join('|'));
   await pg.evaluate(()=>{document.getElementById('editorDialog').close();});await pg.evaluate(()=>openEditor('position','p1'));
  }
  await pg.evaluate(()=>document.getElementById('editorDialog').close());
  await pg.evaluate(()=>openEditor('holding','h1'));check('保有資産IDは編集不可',await pg.evaluate(()=>document.getElementById('f_holdingId').readOnly));await pg.evaluate(()=>document.getElementById('editorDialog').close());
 }

 // ===== Phase L: FX建玉の決済・訂正・削除 =====
 section('L. FX建玉の決済・決済の訂正・削除の保護');
 {
  await pg.evaluate(()=>openEditor('position','p1'));await pg.selectOption('#f_status','closed');await pg.fill('#f_settlementDate','2026-03-01');await pg.fill('#f_settlementRate','4.9');await pg.fill('#f_realizedProfitLoss','40000');
  await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
  let st=await idbGet(pg);let p=st.fxPositions.find(x=>x.positionId==='p1');
  check('全数量決済：決済数量=当初数量、残数量=0、約定情報は不変',p.status==='closed'&&p.closedQuantity===100000&&p.remainingQuantity===0&&p.originalQuantity===100000&&p.originalExecutionRate===4.5&&p.executionDate==='2025-01-10'&&p.settlementRate===4.9);
  await pg.evaluate(()=>openEditor('position','p1'));
  check('決済済み建玉：状態は通常編集で変更不可、「決済の訂正」ボタンのみ表示',await pg.evaluate(()=>document.getElementById('f_status').disabled)&&await pg.isVisible('#reopenPosition'));
  const base=JSON.stringify(await idbGet(pg));
  await pg.evaluate(()=>{const e=document.getElementById('f_status');e.disabled=false;e.value='open';});dialogs.length=0;await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
  check('決済済みを通常編集で未決済に戻そうとしても拒否される',dialogs.some(d=>/決済の訂正/.test(d))&&JSON.stringify(await idbGet(pg))===base);
  await pg.evaluate(()=>document.getElementById('editorDialog').close());await pg.evaluate(()=>openEditor('position','p1'));
  await pg.click('#reopenPosition');await pg.click('#reopenForm button[type=submit]');await sleep(200);
  check('決済の訂正：理由が空だと送信できない',JSON.stringify(await idbGet(pg))===base&&await pg.evaluate(()=>document.getElementById('reopenDialog').open));
  await pg.evaluate(()=>{const t=document.getElementById('reopenReason');t.required=false;t.value='   ';});dialogs.length=0;await pg.click('#reopenForm button[type=submit]');await idle();await sleep(150);
  check('決済の訂正：空白だけの理由も拒否',dialogs.some(d=>/理由/.test(d))&&JSON.stringify(await idbGet(pg))===base);
  await pg.fill('#reopenReason','決済レートの入力ミス');await pg.click('#reopenForm button[type=submit]');await idle();await sleep(200);
  st=await idbGet(pg);p=st.fxPositions.find(x=>x.positionId==='p1');const c=st.fxCorrections[0];
  check('決済の訂正：未決済に戻り、約定日・約定数量・約定レートは不変',p.status==='open'&&p.closedQuantity===0&&p.remainingQuantity===100000&&p.settlementDate===null&&p.originalQuantity===100000&&p.originalExecutionRate===4.5&&p.executionDate==='2025-01-10');
  check('決済の訂正：理由・変更前後・日時を訂正履歴と操作履歴に記録',st.fxCorrections.length===1&&c.reason==='決済レートの入力ミス'&&c.before.status==='closed'&&c.before.settlementRate===4.9&&c.after.status==='open'&&!!c.at&&st.editHistory.some(h=>h.recordType==='position'&&h.action==='correction'&&h.before&&h.after));
  check('決済の訂正履歴がFX画面に表示される',(await pg.textContent('#correctionList')).includes('決済レートの入力ミス'));
  // 口座削除の保護
  await pg.evaluate(()=>openEditor('account','fx1'));dialogs.length=0;await pg.click('#deleteRecord');await sleep(250);
  check('参照されている口座は削除できない（内訳を表示）',dialogs.some(d=>/参照されているため削除できません/.test(d)&&/FX建玉/.test(d))&&(await idbGet(pg)).accounts.some(a=>a.accountId==='fx1'));
  await pg.evaluate(()=>document.getElementById('editorDialog').close());
  // 建玉の新規登録→削除（削除前の内容が操作履歴に残る）
  await pg.evaluate(()=>openEditor('position'));await pg.selectOption('#f_accountId','fx1');await pg.fill('#f_executionDate','2026-02-01');await pg.fill('#f_originalExecutionRate','4.4');await pg.fill('#f_originalQuantity','10000');
  await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);st=await idbGet(pg);const np=st.fxPositions.find(x=>x.originalQuantity===10000);
  check('建玉の新規登録（ID自動採番・当初数量=残数量）',!!np&&np.positionId.startsWith('position_')&&np.remainingQuantity===10000&&np.status==='open');
  await pg.evaluate(id=>openEditor('position',id),np.positionId);dialogs.length=0;await pg.click('#deleteRecord');await idle();await sleep(200);st=await idbGet(pg);
  check('建玉の削除：削除前の内容が操作履歴に残る',!st.fxPositions.some(x=>x.positionId===np.positionId)&&st.editHistory.some(h=>h.recordType==='position'&&h.action==='delete'&&h.before&&h.before.positionId===np.positionId&&h.before.originalQuantity===10000));
 }

 // ===== Phase N: 重複防止・過去日付・二重保存 =====
 section('N. 履歴の重複防止・過去日付・二重保存');
 {
  const bulkRow=async(i,date,vals)=>{const r=pg.locator('.bulk-row').nth(i);await r.locator('[data-f="date"]').fill(date);for(const [k,v] of Object.entries(vals))await r.locator(`[data-f="v:${k}"]`).fill(v);};
  await pg.click('[data-tab="bulk"]');await pg.selectOption('#bulkAccount','bank1');await pg.click('#bulkAddRow');await bulkRow(0,'2024-01-31',{balance:'500'});await pg.click('#bulkPreview');await pg.click('#bulkCommit');await idle();await sleep(250);
  await pg.click('#bulkAddRow');await bulkRow(0,'2024-01-31',{balance:'500'});await pg.click('#bulkPreview');
  check('同じ内容の履歴は重複登録できない（確認画面で保存不可）',(await pg.textContent('#bulkPlanSummary')).includes('重複登録を防ぐため')&&await pg.isDisabled('#bulkCommit'));
  await pg.click('#bulkBack');await pg.click('#bulkDiscard');
  // 同日でも別の値なら登録可・保存ボタン連打でも1回だけ
  const batchesBefore=(await idbGet(pg)).editHistory.filter(h=>h.recordType==='bulkHistory').length;
  await pg.click('#bulkAddRow');await bulkRow(0,'2024-02-29',{balance:'600'});await pg.click('#bulkPreview');
  await pg.evaluate(()=>{const b=document.getElementById('bulkCommit');b.click();b.click();});await idle();await sleep(300);
  st=await idbGet(pg);
  check('保存ボタンを連打しても一括保存は1回だけ',st.timeSeriesRecords.filter(r=>r.effectiveDate==='2024-02-29'&&r.values.balance===600).length===1&&st.editHistory.filter(h=>h.recordType==='bulkHistory').length===batchesBefore+1);
  // 過去日付
  await pg.click('#bulkAddRow');await bulkRow(0,'2019-04-30',{balance:'1'});await pg.click('#bulkPreview');
  const warn=await pg.textContent('#bulkPlanSummary');await pg.click('#bulkCommit');await idle();await sleep(250);st=await idbGet(pg);const old=st.timeSeriesRecords.find(r=>r.effectiveDate==='2019-04-30');
  check('過去日付の履歴を後から登録でき、対象日と登録日時が区別される',!!old&&old.registeredAt.startsWith('2026-')&&old.effectiveAt.startsWith('2019-04-29'),JSON.stringify(old&&{e:old.effectiveAt,r:old.registeredAt}));
  check('過去日付の登録時、後続データへの影響確認が表示される',warn.includes('より後に')&&warn.includes('後続'));
  // 入出金の二重送信
  await pg.click('[data-tab="cash"]');const nBefore=(await idbGet(pg)).cashTransactions.length;await pg.click('#addCashTransaction');await pg.selectOption('#cashType','deposit');await pg.selectOption('#cashTarget','bank1');await pg.fill('#cashAmount','7777');await pg.fill('#cashFee','0');
  await pg.evaluate(()=>{const f=document.getElementById('cashForm');f.requestSubmit();f.requestSubmit();});await idle();await sleep(300);
  check('入出金の二重送信でも1件だけ登録される',(await idbGet(pg)).cashTransactions.length===nBefore+1);
 }

 // ===== Phase O: ダッシュボード・推移（欠損を補間しない） =====
 section('O. 資産サマリー・FX口座別表示・推移グラフ');
 {
  await pg.click('[data-tab="home"]');const home=await pg.textContent('#assetSummary');
  check('総資産・総負債・純資産が表示される',home.includes('総資産')&&home.includes('総負債')&&home.includes('純資産'));
  check('評価データのない口座は0円ではなく「データなし」',home.includes('データなし')&&home.includes('合計から除いています'));
  const fxs=await pg.textContent('#fxSummary');check('FX口座別に建玉数・純資産・為替差益・累計スワップ・最終更新日を表示',fxs.includes('建玉')&&fxs.includes('純資産')&&fxs.includes('為替差益')&&fxs.includes('累計スワップ')&&fxs.includes('最終更新 2025-06-30'),fxs.replace(/\s+/g,' ').slice(0,200));
  check('最終保存日時とオンライン状態が表示される',(await pg.textContent('#storageStatus')).includes('最終保存')&&(await pg.textContent('#connection')).includes('オンライン'));
  if(SHOTS)await pg.screenshot({path:path.join(SHOTS,'home.png')});
  await pg.click('[data-tab="trend"]');await pg.selectOption('#trendAccount','bank1');await pg.selectOption('#trendMetric','ts:balance');await pg.selectOption('#trendGap','35');
  const cnt=async sel=>pg.locator('#trendSvg '+sel).count();
  const pts=await cnt('circle'),lines=await cnt('polyline'),gapRects=await cnt('rect');
  check('推移グラフ：記録のある点だけを描画し、欠損期間に点を作らない',pts===5,`circle=${pts}`);
  check('推移グラフ：欠損の前後で線を分け、欠損区間を「データなし」として表示',lines===2&&gapRects===2&&(await pg.textContent('#trendSvg')).includes('データなし'),`polyline=${lines}, gap=${gapRects}`);
  check('欠損期間が一覧表示される',(await pg.textContent('#trendGaps')).includes('2024-02-29〜2025-01-31'));
  await pg.selectOption('#trendGap','');check('「判定しない」を選んだ場合のみ、すべての点を線で結ぶ',(await cnt('polyline'))===1&&(await cnt('rect'))===0);
  await pg.selectOption('#trendGap','35');await pg.fill('#trendFrom','2024-01-01');await pg.fill('#trendTo','2024-12-31');
  check('期間を指定して推移を確認できる',(await cnt('circle'))===2);await pg.fill('#trendFrom','');await pg.fill('#trendTo','');
  if(SHOTS)await pg.screenshot({path:path.join(SHOTS,'trend.png')});
 }

 // ===== Phase M: JSONインポートの検証 =====
 section('M. JSONインポート検証・復元前バックアップ');
 {
  await pg.click('[data-tab="data"]');
  const cur=await idbGet(pg);const snapJson=JSON.stringify(cur);
  const tryImport=async(payload,name='x.json')=>{await pg.setInputFiles('#importFile',{name,mimeType:'application/json',buffer:Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload))});dialogs.length=0;await pg.click('#importBtn');await sleep(350);return {text:await pg.textContent('#importResult'),dlg:dialogs.slice()};};
  const rejected=async(name,payload,re)=>{const r=await tryImport(payload);check(`不正データを拒否：${name}`,/取り込み中止/.test(r.text)&&re.test(r.text)&&!r.dlg.some(d=>/置き換えますか/.test(d))&&JSON.stringify(await idbGet(pg))===snapJson,r.text.slice(0,120));};
  const good=()=>({schemaVersion:5,dataType:'personal_asset_manager',accounts:[{accountId:'z1',accountName:'試験口座',accountType:'bank'}],fxPositions:[],holdings:[],balanceSnapshots:[]});
  await rejected('JSONとして壊れている','{ "accounts": [',/JSONとして読み込めません/);
  await rejected('必須配列がない',{schemaVersion:5,accounts:[]},/必須の配列/);
  await rejected('未対応の将来バージョン',{...good(),schemaVersion:99},/新しいバージョン/);
  await rejected('口座IDの重複',{...good(),accounts:[good().accounts[0],good().accounts[0]]},/重複/);
  await rejected('日付形式が不正',{...good(),balanceSnapshots:[{snapshotId:'s',accountId:'z1',snapshotDate:'2026-02-30',balance:1}]},/日付/);
  await rejected('数値が文字列',{...good(),cashTransactions:[{transactionId:'t',transactionType:'deposit',targetAccountId:'z1',effectiveDate:'2026-01-01',amount:'1000',feeAmount:0}]},/数値ではありません/);
  await rejected('負の手数料',{...good(),cashTransactions:[{transactionId:'t',transactionType:'deposit',targetAccountId:'z1',effectiveDate:'2026-01-01',amount:1000,feeAmount:-5}]},/負の値/);
  await rejected('存在しない口座への参照（v5）',{...good(),holdings:[{holdingId:'h',accountId:'ghost'}]},/存在しない口座/);
  await rejected('配列に空要素',{...good(),holdings:[null]},/オブジェクトではありません/);
  const multi=await tryImport({...good(),schemaVersion:99,accounts:[good().accounts[0],good().accounts[0]],balanceSnapshots:[{snapshotId:'s',accountId:'z1',snapshotDate:'bad'}]});
  check('問題が複数ある場合は、すべて列挙して部分的に読み込まない',(multi.text.match(/・/g)||[]).length>=3&&JSON.stringify(await idbGet(pg))===snapJson);
  // 暗号化バックアップの中身が不正な場合も拒否
  const encBad=await pg.evaluate(async()=>{const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await deriveKey('longpassword1234',salt);const bad={schemaVersion:99,accounts:[],fxPositions:[],holdings:[],balanceSnapshots:[]};const c=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(bad)));return JSON.stringify({format:'PAM-ENCRYPTED-BACKUP',version:1,salt:PAMCore.bytesToBase64(salt),iv:PAMCore.bytesToBase64(iv),data:PAMCore.bytesToBase64(new Uint8Array(c))});});
  await pg.click('[data-tab="data"]');await pg.setInputFiles('#encryptedFile',{name:'bad.pamenc',mimeType:'application/octet-stream',buffer:Buffer.from(encBad)});await pg.fill('#restorePassword','longpassword1234');dialogs.length=0;await pg.click('#importEncrypted');await sleep(2500);
  check('暗号化バックアップの中身が不正な場合も復元を中止し、データは変更されない',dialogs.some(d=>/取り込み中止/.test(d))&&JSON.stringify(await idbGet(pg))===snapJson,dialogs.join('|').slice(0,150));
  // 正常な旧形式(v0.4相当・schemaVersion 3)の取り込みと移行
  const legacy={schemaVersion:3,accounts:[{accountId:'old1',accountName:'旧口座',accountType:'fx'}],fxPositions:[{positionId:'oldp',accountId:'old1',status:'open',openDate:'2024-02-02',openPrice:3.3,originalQuantity:5000}],holdings:[],balanceSnapshots:[{accountId:'old1',snapshotDate:'2024-01-01',balance:10}]};
  const ok1=await tryImport(legacy);
  const afterImp=await idbGet(pg);
  check('正常な旧形式データ(v3)を検証・確認のうえ取り込める',ok1.dlg.some(d=>/検証に成功しました/.test(d)&&/取り込み後/.test(d)&&/現在のデータにあり/.test(d)),ok1.dlg.join('|').slice(0,200));
  check('旧形式データは移行されて保存される（schemaVersion 5・約定情報補完・移行履歴）',afterImp.schemaVersion===5&&afterImp.accounts.length===1&&afterImp.fxPositions[0].executionDate==='2024-02-02'&&afterImp.fxPositions[0].originalExecutionRate===3.3&&afterImp.migrationHistory.length>=1&&afterImp.balanceSnapshots[0].snapshotId);
  check('取り込み前の状態が端末内に控えとして保存される（完全一致）',JSON.stringify((await idbKey(pg,'pre_import_backup')).state)===snapJson);
  check('取り込みデータに操作履歴がない場合、現在の操作履歴を引き継ぐ',afterImp.editHistory.length===cur.editHistory.length);
  // 控えを書き出して復元（元に戻す）
  const [dlb]=await Promise.all([pg.waitForEvent('download'),pg.click('#exportPreImport')]);const prePath=await dlb.path();
  await pg.setInputFiles('#importFile',prePath);dialogs.length=0;await pg.click('#importBtn');await sleep(700);
  const back=await idbGet(pg);
  check('控えのJSONから元の状態に復元できる（口座・建玉・履歴・時系列がすべて一致）',['accounts','fxPositions','holdings','balanceSnapshots','cashTransactions','fees','timeSeriesRecords','timeSeriesRevisions','fxCorrections','editHistory'].every(k=>JSON.stringify(back[k])===JSON.stringify(cur[k])),'');
 }

 // ===== Phase H: バックアップ・復元（データ量が増えても動く） =====
 section('H. バックアップ・復元');
 await pg.evaluate(async()=>{for(let i=0;i<4000;i++)state.timeSeriesRecords.push({recordId:'big'+i,recordType:'other',accountId:'bank1',effectiveAt:'2025-01-01T00:00:00.000Z',registeredAt:'2025-01-01T00:00:00.000Z',values:{amount:i},memo:'x'.repeat(200),deletedAt:null});await save();});
 await pg.click('[data-tab="data"]');await pg.fill('#backupPassword','longpassword1234');
 dialogs.length=0;const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:20000}),pg.click('#exportEncrypted')]);const encPath=await dl.path();
 check('大きなデータでも暗号化バックアップを書き出せる',fs.statSync(encPath).size>1000000&&!dialogs.some(d=>/call stack/i.test(d)),`size=${fs.statSync(encPath).size}`);
 const [dl2]=await Promise.all([pg.waitForEvent('download'),pg.click('#exportJson')]);const jsonTxt=fs.readFileSync(await dl2.path(),'utf8');const bk=JSON.parse(jsonTxt);
 check('通常JSONバックアップに新旧すべての配列が含まれる',['accounts','fxPositions','holdings','balanceSnapshots','timeSeriesRecords','timeSeriesRevisions','cashTransactions','fees','editHistory'].every(k=>Array.isArray(bk[k]))&&bk.timeSeriesRecords.some(r=>r.batchId));
 // 復元：暗号化 → 現在の状態を一旦変更してから復元
 const before=await idbGet(pg);
 const nameBefore=before.accounts[0].accountName;
 await pg.evaluate(async()=>{state.accounts[0].accountName='復元前の別状態';await save();});
 check('整合性ゲート：口座を減らして参照が孤立する保存は拒否される（保存失敗時はメモリも元に戻る）',await pg.evaluate(async()=>{const n=state.accounts.length;state.accounts=state.accounts.slice(0,1);const ok=await save();return ok===false&&state.accounts.length===n;}));
 await pg.setInputFiles('#encryptedFile',encPath);await pg.fill('#restorePassword','longpassword1234');dialogs.length=0;await pg.click('#importEncrypted');await sleep(3500);
 const restored=await idbGet(pg);
 check('暗号化バックアップから復元できる',restored.accounts.length===before.accounts.length&&restored.accounts[0].accountName===nameBefore&&restored.timeSeriesRecords.length===before.timeSeriesRecords.length&&dialogs.some(d=>/復元しました/.test(d)),dialogs.join('|'));
 check('復元後も一括入力の履歴・修正履歴が残る',restored.timeSeriesRevisions.length===before.timeSeriesRevisions.length&&restored.timeSeriesRecords.some(r=>r.batchId));
 const pre=await idbKey(pg,'pre_import_backup');check('復元前の状態が控えとして端末内に残る',pre&&pre.state.accounts[0].accountName==='復元前の別状態');
 const [dl3]=await Promise.all([pg.waitForEvent('download'),pg.click('#exportPreImport')]);const preJson=JSON.parse(fs.readFileSync(await dl3.path(),'utf8'));check('控えをJSONとして書き出せる',preJson.accounts[0].accountName==='復元前の別状態');
 // 通常JSON取り込み（旧形式＝alpha1のS0）
 fs.writeFileSync('/tmp/alpha1_backup.json',JSON.stringify(S0));
 await pg.setInputFiles('#importFile','/tmp/alpha1_backup.json');dialogs.length=0;await pg.click('#importBtn');await sleep(600);
 st=await idbGet(pg);
 check('alpha1形式のJSON取り込みができる（新配列は補完）',st.accounts.length===6&&st.timeSeriesRecords.length===1&&Array.isArray(st.cashTransactions)&&st.schemaVersion===5);

 // ===== Phase I: オフライン・画面幅 =====
 section('I. オフライン・iPhone幅');
 await pg.evaluate(()=>navigator.serviceWorker.ready);await pg.reload();await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6');
 await ctx.setOffline(true);await pg.reload();await pg.waitForFunction(()=>document.getElementById('accountCount').textContent==='6',null,{timeout:8000}).catch(()=>{});
 check('機内モード相当でも起動し、データを参照できる',(await pg.textContent('#accountCount'))==='6'&&(await pg.textContent('#appVersion')).includes('0.6.'));
 await pg.click('[data-tab="bulk"]');await pg.click('#bulkAddRow');
 check('オフラインでも一括入力画面が使える',await pg.locator('.bulk-row').count()===1);
 await ctx.setOffline(false);
 for(const tab of ['bulk','timeline','history','data','cash']){await pg.click(`[data-tab="${tab}"]`);}
 await pg.click('[data-tab="bulk"]');for(let i=0;i<3;i++)await pg.click('#bulkAddRow');
 const overflow=await pg.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
 check('幅390pxで横スクロールが発生しない（一括入力）',overflow<=0,`overflow=${overflow}px`);
 const fs16=await pg.evaluate(()=>{const e=document.querySelector('.bulk-row input');return parseFloat(getComputedStyle(e).fontSize);});
 check('入力欄の文字が16px以上（iOSのフォーカス時ズーム防止）',fs16>=16,`fontSize=${fs16}`);
 if(SHOTS){await pg.locator('.bulk-row').nth(0).scrollIntoViewIfNeeded();await pg.screenshot({path:path.join(SHOTS,'bulk.png')});}
 check('テスト全体でJS実行エラーなし',errors.length===0,errors.join('|'));

 await browser.close();srv.close();
 console.log(results.join('\n'));console.log(`\nE2E: ${pass} passed, ${fail} failed`);if(process.env.RESULTS_JSON)fs.writeFileSync(process.env.RESULTS_JSON,JSON.stringify({passed:pass,failed:fail,browser:browserVersion,node:process.version,at:new Date().toISOString(),records},null,1));process.exit(fail?1:0);
})().catch(e=>{console.log(results.join('\n'));console.error('E2E crashed:',String(e.message).split('\n')[0]);process.exit(2);});
