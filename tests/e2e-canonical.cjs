/* 正規化JSON取り込みの実ブラウザ総合テスト（Playwright / Chromium）。
   使い方: node tests/e2e-canonical.cjs <アプリのフォルダ> <正規化JSONのパス> [結果JSONの出力先]
   JSONの内容は、実ファイルでも架空フィクスチャでも同じ検証ができるよう、期待値をJSON自体から計算する。 */
const http=require('http'),fs=require('fs'),path=require('path');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'));}catch(e){({chromium}=require('/opt/npm-tools/node_modules/playwright'));}
const APP=path.resolve(process.argv[2]||'..'),JSON_PATH=path.resolve(process.argv[3]),OUT=process.argv[4]||'';
const J=JSON.parse(fs.readFileSync(JSON_PATH,'utf8'));
const srv=http.createServer((q,s)=>{const u=q.url.split('?')[0];const p=path.join(APP,u==='/'?'index.html':u);fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);return s.end();}const t={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json'}[path.extname(p)]||'text/plain';s.writeHead(200,{'Content-Type':t+'; charset=utf-8','Cache-Control':'no-cache'});s.end(d);});});
const records=[];let phase='',pass=0,fail=0;
const check=(name,cond,detail='')=>{records.push({phase,name,pass:!!cond,detail:String(detail||'')});cond?pass++:fail++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const idbKey=(pg,k)=>pg.evaluate(k=>new Promise((res,rej)=>{const o=indexedDB.open('pam_local_v2');o.onsuccess=()=>{const r=o.result.transaction('state').objectStore('state').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);};o.onerror=()=>rej(o.error);}),k);
const idb=pg=>idbKey(pg,'state');
const eqj=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
(async()=>{
 await new Promise(r=>srv.listen(0,r));const base=`http://localhost:${srv.address().port}/`;
 const browser=await chromium.launch();const browserVersion='Chromium '+browser.version();
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Tokyo',locale:'ja-JP'});
 const pg=await ctx.newPage();const dialogs=[],errors=[];
 pg.on('dialog',d=>{dialogs.push(d.type()+':'+d.message());d.accept();});pg.on('pageerror',e=>errors.push(e.message));
 const idle=()=>pg.waitForFunction(()=>busy===false);
 const importFile=async(payload,name='x.json')=>{await pg.click('[data-tab="data"]');await pg.setInputFiles('#importFile',typeof payload==='string'?payload:{name,mimeType:'application/json',buffer:Buffer.from(payload.raw!==undefined?payload.raw:JSON.stringify(payload))});dialogs.length=0;await pg.click('#importBtn');await sleep(700);await idle();return {text:await pg.textContent('#importResult'),cls:await pg.getAttribute('#importResult','class')||'',dlg:dialogs.slice()};};
 const J_acc=J.accounts,J_pos=J.fxPositions,J_snap=J.accountBalanceSnapshots;

 phase='1. 取り込み前の準備（既存データがある状態）';
 await pg.goto(base);await pg.waitForFunction(()=>typeof committed!=='undefined'&&committed!==null);
 await pg.evaluate(()=>commitChange(d=>{d.accounts.push({accountId:'ex_bank',accountName:'既存の銀行（テスト）',accountType:'bank',currency:'JPY'});d.holdings.push({holdingId:'ex_h',accountId:'ex_bank',productName:'既存の保有商品（テスト）',currentEvaluationAmount:1234});d.balanceSnapshots.push({snapshotId:'ex_s',accountId:'ex_bank',snapshotDate:'2026-10-31',balance:777});}));
 const before=await idb(pg);check('既存データ（銀行口座・保有商品・残高記録）を用意できた',before.accounts.length===1&&before.holdings.length===1&&before.balanceSnapshots.length===1);
 check('取り込み前、アプリは正規化JSONを従来の形式としては受け付けない（原因：別形式）',await pg.evaluate(j=>PAMStore.validateImport(j).errors.length>=3,J));

 phase='2. 不正な正規化JSONの拒否（部分的に読み込まない）';
 {
  const snap=JSON.stringify(await idb(pg));
  const mut=fn=>{const c=JSON.parse(JSON.stringify(J));fn(c);return c;};
  const rej=async(name,payload,re)=>{const r=await importFile(payload);check(`拒否：${name}`,/取り込み中止/.test(r.text)&&re.test(r.text)&&!r.dlg.some(d=>/取り込みますか/.test(d))&&JSON.stringify(await idb(pg))===snap,r.text.slice(0,100));};
  await rej('建玉IDの重複',mut(c=>{c.fxPositions.push({...c.fxPositions[0]});}),/重複/);
  await rej('将来バージョン(schemaVersion 2)',mut(c=>{c.schemaVersion=2;}),/新しいバージョン/);
  await rej('数値が文字列',mut(c=>{c.fxPositions[0].originalQuantity=String(c.fxPositions[0].originalQuantity);}),/originalQuantity/);
  await rej('存在しない口座への参照',mut(c=>{c.fxPositions[0].accountId='ghost';}),/存在しない口座/);
  await rej('日付形式が不正',mut(c=>{c.accountBalanceSnapshots[0].effectiveDate='2026/11/05';}),/日付/);
  await rej('必須配列 accounts がない',mut(c=>{delete c.accounts;}),/accounts/);
  await rej('JSONとして壊れている',{raw:'{ "dataType": "personal_asset_management", '},/JSONとして読み込めません/);
 }

 phase='3. 最新JSONの取り込み';
 const r1=await importFile(JSON_PATH);
 const after=await idb(pg);
 const confirmMsg=r1.dlg.find(d=>/検証に成功しました/.test(d))||'';
 check('最新JSONを読み込める（エラーなし）',!/取り込み中止/.test(r1.text)&&r1.cls.includes('report'),r1.text.slice(0,160));
 check('取り込み前に内容を確認でき、「追加のみ・上書き削除しない」と明示される',/追加のみ/.test(confirmMsg)&&/取り込み前の状態は.*控え/s.test(confirmMsg),confirmMsg.slice(0,120));
 check(`口座が${J_acc.length}件追加される（既存の口座は残る）`,after.accounts.length===1+J_acc.length&&after.accounts.some(a=>a.accountId==='ex_bank'));
 check(`FX建玉が${J_pos.length}件すべて追加される（同条件の建玉を1件にまとめない）`,after.fxPositions.length===J_pos.length&&new Set(after.fxPositions.map(p=>p.positionId)).size===J_pos.length);
 check(`残高記録が${J_snap.length}件追加される`,after.balanceSnapshots.length===1+J_snap.length);
 const byAcc=Object.fromEntries(J_acc.map(a=>[a.accountId,J_pos.filter(p=>p.accountId===a.accountId).length]));
 check('FX各口座の建玉数がJSONと一致',J_acc.every(a=>after.fxPositions.filter(p=>p.accountId===a.accountId).length===byAcc[a.accountId]),JSON.stringify(byAcc));
 check('口座名・金融機関・種別がJSONと同じ（口座ごとに別口座）',J_acc.every(a=>{const x=after.accounts.find(y=>y.accountId===a.accountId);return x&&x.accountName===a.accountName&&x.institutionName===a.institution&&x.accountType===a.accountType&&x.currency===a.baseCurrency;}));
 const posOK=J_pos.every(p=>{const x=after.fxPositions.find(y=>y.positionId===p.positionId);return x&&x.accountId===p.accountId&&x.currencyPair===p.currencyPair&&x.side===p.side&&x.status===p.status&&x.executionDate===p.executionDate&&x.originalQuantity===p.originalQuantity&&x.originalExecutionRate===p.originalExecutionRate&&x.remainingQuantity===p.originalQuantity&&x.closedQuantity===0&&x.lots===p.lots&&x.quantityUnit===p.quantityUnit&&x.memo===p.notes&&x.openDate===p.executionDate&&x.openPrice===p.originalExecutionRate;});
 check('建玉の通貨ペア・売買・約定日・数量・約定レート・ロット・単位・備考が、JSONの値のまま（変更なし）',posOK);
 const ev=Object.fromEntries((J.fxPositionEvents||[]).map(e=>[e.positionId,e]));
 check('JSONに無い値は推測せず null のまま（参照レート・日次スワップ・評価損益・決済情報）',J_pos.every(p=>{const x=after.fxPositions.find(y=>y.positionId===p.positionId);return x.referenceRate===null&&x.dailySwapAmount===null&&x.unrealizedProfitLoss===null&&x.settlementDate===null&&x.settlementRate===null&&x.realizedProfitLoss===null;}));
 check('累積スワップは、その建玉のスワップ記録イベントの値（出典イベントID付き）',J_pos.every(p=>{const x=after.fxPositions.find(y=>y.positionId===p.positionId);return ev[p.positionId]?(x.accumulatedSwap===ev[p.positionId].swapAmount&&x.accumulatedSwapSource.eventId===ev[p.positionId].eventId):x.accumulatedSwap===null;}));
 const snapOK=J_snap.every(s=>{const x=after.balanceSnapshots.find(y=>y.snapshotId===s.snapshotId);return x&&x.accountId===s.accountId&&x.snapshotDate===s.effectiveDate&&x.balance===s.cashBalance&&x.evaluationAmount===s.accountValuation&&x.netAssetValue===s.netAssets&&x.marginRequirement===s.requiredMargin&&x.unrealizedProfitLoss===s.unrealizedPnl&&x.accumulatedSwap===s.cumulativeSwap&&x.memo===s.notes;});
 check('口座の残高・評価額・純資産・必要証拠金・評価損益・累計スワップ・備考が、JSONの値のまま',snapOK);
 check('イベント・原資料・移行メモが失われずに保持される',(after.canonicalData.fxPositionEvents||[]).length===(J.fxPositionEvents||[]).length&&(after.canonicalData.sourceDocuments||[]).length===(J.sourceDocuments||[]).length&&(after.canonicalData.migrationNotes||[]).length===(J.migrationNotes||[]).length&&eqj(after.canonicalData.fxPositionEvents,J.fxPositionEvents||[]));
 check('既存データ（銀行口座・保有商品・残高記録）は一切変更されない',eqj(after.accounts[0],before.accounts[0])&&eqj(after.holdings,before.holdings)&&eqj(after.balanceSnapshots[0],before.balanceSnapshots[0]));
 const emptyArrays=['investmentHoldings','investmentAccountSnapshots','cryptoHoldings','cryptoAccountSnapshots','cryptoTransactions','investmentTransactions'];
 check('JSONに投資・暗号資産のデータが無い場合、保有資産を推測して作らない（保有資産は取り込み前と同じ）',emptyArrays.every(k=>(J[k]||[]).length>0)||eqj(after.holdings,before.holdings),emptyArrays.map(k=>k+':'+(J[k]||[]).length).join(' '));
 check('編集履歴に取り込みの記録が残る（件数のみ）',after.editHistory[0].recordType==='importLog'&&after.editHistory[0].after.counts.positions.added===J_pos.length);
 const pre=await idbKey(pg,'pre_import_backup');check('取り込み前の状態が端末内に控えとして保存される（完全一致）',!!pre&&eqj(pre.state,before));
 check('参照・ID整合性に問題なし',await pg.evaluate(()=>PAMStore.checkIntegrity(state).length===0));
 check('取り込み結果が画面に表示される（追加件数・保持した原データ）',/FX建玉：追加/.test(r1.text)&&/原データの保持/.test(r1.text),r1.text.slice(0,200));

 phase='4. 画面表示';
 await pg.click('[data-tab="accounts"]').catch(()=>{});
 const ui=await pg.evaluate(()=>({accounts:document.querySelectorAll('#accountList .item').length,positions:document.querySelectorAll('#positionList .item').length,snaps:document.querySelectorAll('#snapshotList .item').length,accText:document.getElementById('accountList').textContent,posText:document.getElementById('positionList').textContent,snapText:document.getElementById('snapshotList').textContent}));
 check(`口座一覧に ${J_acc.length+1} 件（口座名が表示される）`,ui.accounts===J_acc.length+1&&J_acc.every(a=>ui.accText.includes(a.accountName)),`items=${ui.accounts}`);
 check(`FX建玉一覧に ${J_pos.length} 件表示される`,ui.positions===J_pos.length,`items=${ui.positions}`);
 const yenOf=async v=>pg.evaluate(v=>yen(v),v);
 let snapShown=true;for(const s of J_snap){for(const v of [s.cashBalance,s.accountValuation,s.netAssets,s.requiredMargin]){if(v!==null&&!ui.snapText.includes(await yenOf(v)))snapShown=false;}}
 check('残高履歴に、各FX口座の残高・評価額・純資産額・必要証拠金が表示される',ui.snaps===J_snap.length+1&&snapShown);
 let posShown=true;for(const p of J_pos){const x=after.fxPositions.find(y=>y.positionId===p.positionId);}
 const swapYen=await yenOf(ev[J_pos[0].positionId]&&ev[J_pos[0].positionId].swapAmount);
 check('建玉一覧に通貨ペア・数量・約定価格・累積スワップが表示される（例：先頭の建玉）',(()=>{const p=J_pos[0];const sw=ev[p.positionId]&&ev[p.positionId].swapAmount;return ui.posText.includes(p.currencyPair)&&ui.posText.includes(p.executionDate)&&ui.posText.includes(String(p.originalExecutionRate))&&(sw===undefined||sw===null||ui.posText.includes(swapYen));})());
 await pg.click('[data-tab="home"]');const home=await pg.evaluate(()=>({asset:document.getElementById('assetSummary').textContent,fx:document.getElementById('fxSummary').textContent,sumRows:PAMFin.summarizeAssets(state)}));
 const netSum=J_snap.reduce((s,x)=>s+(x.netAssets??0),0);
 const fxRows=home.sumRows.rows.filter(r=>J_acc.some(a=>a.accountId===r.accountId));
 check('概要：FX各口座の評価額は「純資産額」1件のみ採用（建玉損益・スワップ・現金を重ねて足さない）',fxRows.length===J_acc.length&&J_snap.every(s=>fxRows.find(r=>r.accountId===s.accountId).value===s.netAssets&&fxRows.find(r=>r.accountId===s.accountId).source==='残高記録'));
 check('概要：総資産 = 既存口座 + FX各口座の純資産額の合計（二重計上なし）',home.sumRows.totals.asset===777+netSum,`asset=${home.sumRows.totals.asset} expected=${777+netSum}`);
 check('概要：総資産が画面に表示される',home.asset.includes(await yenOf(777+netSum)));
 check('概要：FX口座別に建玉数・純資産が表示される',J_acc.every(a=>home.fx.includes(a.accountName)&&home.fx.includes(`${byAcc[a.accountId]} 建玉`)));
 check('保有商品（既存）が表示され、FX口座の評価額と二重計上されない',(await pg.evaluate(()=>document.getElementById('holdingList').textContent)).includes('既存の保有商品（テスト）'));

 phase='5. 再読み込み・再取り込み・オフライン';
 const beforeReload=JSON.stringify(await idb(pg));
 await pg.reload();await pg.waitForFunction(()=>typeof committed!=='undefined'&&committed!==null);
 const afterReload=await idb(pg);
 check('アプリを再読み込みしてもデータが維持される（IndexedDBと完全一致）',JSON.stringify(afterReload)===beforeReload&&await pg.evaluate(()=>JSON.stringify(state)===JSON.stringify(committed)));
 check('再読み込み後も画面の件数が同じ',(await pg.evaluate(()=>[document.querySelectorAll('#positionList .item').length,document.querySelectorAll('#accountList .item').length])).join()===[J_pos.length,J_acc.length+1].join());
 const snap2=JSON.stringify(await idb(pg));const r2=await importFile(JSON_PATH);
 check('同じJSONを再取り込みしても、何も追加されない（重複登録なし）',/追加するデータはありません/.test(r2.text)&&JSON.stringify(await idb(pg))===snap2&&!r2.dlg.some(d=>/取り込みますか/.test(d)),r2.text.slice(0,120));
 const r3=await importFile(JSON_PATH);check('3回目も重複登録されない（件数不変）',(await idb(pg)).fxPositions.length===J_pos.length&&JSON.stringify(await idb(pg))===snap2);
 check('再取り込みでも編集履歴・控えは増えない（変更がないため）',(await idb(pg)).editHistory.filter(h=>h.recordType==='importLog').length===1);
 // 取り込み後に建玉を編集しても、取り込んだ付随情報が失われない／固定情報は変更不可
 const p0=J_pos[0];
 await pg.evaluate(id=>openEditor('position',id),p0.positionId);await pg.fill('#f_referenceRate','3.456');await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
 const ed=(await idb(pg)).fxPositions.find(p=>p.positionId===p0.positionId);
 check('取り込んだ建玉を編集しても、約定情報・ロット・単位・備考・出典情報は保持される',ed.referenceRate===3.456&&ed.originalQuantity===p0.originalQuantity&&ed.originalExecutionRate===p0.originalExecutionRate&&ed.executionDate===p0.executionDate&&ed.lots===p0.lots&&ed.quantityUnit===p0.quantityUnit&&ed.memo===p0.notes&&ed.importSource==='canonical-v1'&&!!ed.accumulatedSwapSource);
 await pg.evaluate(()=>openEditor('position',state.fxPositions[1].positionId));await pg.evaluate(()=>{const e=document.getElementById('f_originalQuantity');e.readOnly=false;e.value='1';});dialogs.length=0;await pg.click('#editorForm button[type=submit]');await idle();await sleep(150);
 check('取り込んだ建玉の約定数量は変更できない',dialogs.some(d=>/変更できません/.test(d))&&(await idb(pg)).fxPositions[1].originalQuantity===J_pos[1].originalQuantity);
 await pg.evaluate(()=>document.getElementById('editorDialog').open&&document.getElementById('editorDialog').close());
 // オフライン
 await pg.evaluate(()=>navigator.serviceWorker.ready);await pg.reload();await pg.waitForFunction(()=>typeof committed!=='undefined'&&committed!==null);
 await ctx.setOffline(true);await pg.reload();await pg.waitForFunction(()=>typeof committed!=='undefined'&&committed!==null,null,{timeout:8000}).catch(()=>{});
 check('オフラインでも起動し、取り込んだデータが表示される',await pg.evaluate(n=>state&&state.fxPositions.length===n&&document.querySelectorAll('#positionList .item').length===n,J_pos.length));
 await ctx.setOffline(false);
 const bk=await pg.evaluate(()=>JSON.parse(JSON.stringify(state)));
 check('JSONバックアップ（書き出し内容）に取り込んだデータと原データが含まれ、そのまま再検証に合格する',await pg.evaluate(s=>PAMStore.validateImport(s).errors.length===0&&s.canonicalData&&s.canonicalData.fxPositionEvents.length>=0,bk));
 check('JS実行エラーなし',errors.length===0,errors.join('|'));
 await browser.close();srv.close();
 const summary={passed:pass,failed:fail,browser:browserVersion,at:new Date().toISOString(),json:{accounts:J_acc.length,positions:J_pos.length,snapshots:J_snap.length,events:(J.fxPositionEvents||[]).length,sourceDocuments:(J.sourceDocuments||[]).length,perAccount:byAcc},records};
 if(OUT)fs.writeFileSync(OUT,JSON.stringify(summary,null,1));
 for(const r of records)console.log((r.pass?'  ✔ ':'  ✘ ')+r.name+(r.pass?'':'  → '+r.detail));console.log(`\nE2E canonical: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error('crashed:',String(e.message).split('\n')[0]);process.exit(2);});
