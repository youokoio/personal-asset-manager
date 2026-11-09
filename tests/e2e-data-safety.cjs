/* データ保護ガードの実ブラウザテスト（Playwright/Chromiumが必要）。
   実行: node tests/e2e-data-safety.cjs
   テストデータは架空データのみ。既存の e2e-browser.cjs は変更しない。 */
const http=require('http'),fs=require('fs'),path=require('path');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'));}catch(e){console.error('Playwrightが見つかりません。プロジェクトで playwright をインストールするか、PLAYWRIGHT_PATH に playwright のモジュールパスを指定してください。');process.exit(2);}
const ROOT=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];const file=path.join(ROOT,url==='/'?'index.html':url);fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/plain';res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(data);});});
const checks=[];const check=(name,ok,detail='')=>{checks.push({name,ok:!!ok,detail:String(detail||'')});};
const raw=(version=5)=>({...(version===undefined?{}:{schemaVersion:version}),dataType:'personal_asset_manager',accounts:[],fxPositions:[],holdings:[],balanceSnapshots:[]});
const putState=(page,value)=>page.evaluate(value=>new Promise((resolve,reject)=>{const req=indexedDB.open('pam_local_v2',2);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('state','readwrite');tx.objectStore('state').put(value,'state');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);};}),value);
const getState=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('pam_local_v2',2);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('state');const r=tx.objectStore('state').get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);};}));
const getKey=(page,key)=>page.evaluate(key=>new Promise((resolve,reject)=>{const req=indexedDB.open('pam_local_v2',2);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const r=req.result.transaction('state').objectStore('state').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);};}),key);
(async()=>{
 await new Promise(resolve=>server.listen(0,resolve));const base=`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch();let context=await browser.newContext();
 const isolatedContexts=[context];
 const isolatedPage=async()=>{const isolated=await browser.newContext();isolatedContexts.push(isolated);return isolated.newPage();};
 try{
  // 旧DB v1を開いたタブが残っている場合、新DB v2への更新を止め、旧タブ終了後にだけ起動する。
  let oldPage=await context.newPage();
  await oldPage.route('**/app.js',route=>route.abort());
  await oldPage.goto(base);
  await oldPage.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pam_local_v2',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,tx=d.transaction('state','readwrite');tx.objectStore('state').put({schemaVersion:5,dataType:'personal_asset_manager',accounts:[{accountId:'fake-preserved-account',accountName:'テスト口座'}],fxPositions:[],holdings:[],balanceSnapshots:[]},'state');tx.oncomplete=()=>{window.__oldDb=d;resolve();};tx.onerror=()=>reject(tx.error);};}));
  let newPage=await context.newPage();await newPage.goto(base);await newPage.waitForSelector('#bootBlocked');
  check('旧DB接続中は新バージョンの起動を停止する',await newPage.locator('#bootBlocked').count()===1);
  check('旧DB接続中の停止理由を表示する',(await newPage.locator('#bootBlocked').innerText()).includes('旧バージョン'));
  await oldPage.evaluate(()=>window.__oldDb.close());await oldPage.close();await newPage.reload();await newPage.waitForSelector('#accountCount');
  const preservedAfterUpgrade=await getState(newPage);
  check('DBバージョン更新後も既存データを保持する',preservedAfterUpgrade.accounts.some(a=>a.accountId==='fake-preserved-account'));
  const oldVersionOpen=await newPage.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pam_local_v2',1);r.onsuccess=()=>{r.result.close();resolve(false);};r.onerror=()=>resolve(r.error&&r.error.name==='VersionError');}));
  check('DB v2更新後は旧コードのDB v1接続を拒否する',oldVersionOpen);
  await newPage.close();

  // 将来バージョンは起動時点で停止し、元データを維持する。
  let page=await isolatedPage();await page.goto(base);await putState(page,raw(6));const future=await getState(page);await page.reload();
  await page.waitForSelector('#bootBlocked');const futureAfter=await getState(page);
  check('schemaVersion 6 は起動を停止する',await page.locator('#bootBlocked').count()===1);
  check('将来バージョンの state は一切変更しない',JSON.stringify(futureAfter)===JSON.stringify(future));
  check('将来バージョンでは移行前バックアップ以外の書込をしない',await getKey(page,'pre_migration_backup')===undefined);
  await page.close();

  // 不正値は数値に暗黙変換せず停止する。
  for(const invalidValue of ['5',true,5.5,-1]){
   page=await isolatedPage();await page.goto(base);await putState(page,raw(invalidValue));const invalid=await getState(page);await page.reload();await page.waitForSelector('#bootBlocked');
   check(`不正 schemaVersion ${String(invalidValue)} は起動を停止する`,await page.locator('#bootBlocked').count()===1);
   check(`不正 schemaVersion ${String(invalidValue)} の state は変更しない`,JSON.stringify(await getState(page))===JSON.stringify(invalid));
   await page.close();
  }

  // schemaVersion 5でも不足配列を補完する場合、rawのままバックアップする。
  page=await isolatedPage();await page.goto(base);const v5Incomplete=raw(5);await putState(page,v5Incomplete);await page.reload();await page.waitForFunction(()=>document.getElementById('accountCount')&&document.getElementById('accountCount').textContent!=='—');
  const v5After=await getState(page),v5Backup=await getKey(page,'pre_migration_backup');
  check('schemaVersion 5の不足配列を補完する',Array.isArray(v5After.fxCorrections)&&Array.isArray(v5After.migrationHistory));
  check('schemaVersion 5の補完前rawもバックアップする',!!v5Backup&&JSON.stringify(v5Backup.state)===JSON.stringify(v5Incomplete));
  await page.close();

  // v4移行：控えは補完前のrawと完全一致し、控え成功後にv5を書き込む。
  page=await isolatedPage();await page.goto(base);const v4=raw(4);await putState(page,v4);await page.reload();await page.waitForFunction(()=>document.getElementById('accountCount')&&document.getElementById('accountCount').textContent!=='—');
  const migrated=await getState(page),backup=await getKey(page,'pre_migration_backup');
  check('v4→v5 の通常移行が完了する',migrated.schemaVersion===5&&Array.isArray(migrated.migrationHistory)&&migrated.migrationHistory.length===1);
  check('移行前バックアップが補完前のrawデータと完全一致する',!!backup&&JSON.stringify(backup.state)===JSON.stringify(v4));
  await page.close();

  // schemaVersion欠落/nullは旧形式0として扱う。
  for(const value of [raw(undefined),{...raw(5),schemaVersion:null}]){
   page=await isolatedPage();await page.goto(base);await putState(page,value);await page.reload();await page.waitForFunction(()=>document.getElementById('accountCount')&&document.getElementById('accountCount').textContent!=='—');
   const st=await getState(page),bk=await getKey(page,'pre_migration_backup');
   check(`schemaVersion ${value.schemaVersion===null?'null':'欠落'} を旧形式として移行する`,st.schemaVersion===5&&bk&&JSON.stringify(bk.state)===JSON.stringify(value));
   await page.close();
  }

  // 移行前バックアップの保存失敗時はstateを書き換えず停止する。
  page=await isolatedPage();await page.goto(base);const backupFailRaw=raw(4);await putState(page,backupFailRaw);
  await page.addInitScript(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='pre_migration_backup')throw new Error('simulated backup failure');return original.call(this,value,key);};});
  await page.reload();await page.waitForSelector('#bootBlocked');
  check('移行前バックアップ失敗時に起動を停止する',await page.locator('#bootBlocked').count()===1);
  check('バックアップ失敗時に元のstateを変更しない',JSON.stringify(await getState(page))===JSON.stringify(backupFailRaw));
  check('バックアップ失敗時に移行後stateを書き込まない',await getKey(page,'pre_migration_backup')===undefined);
  await page.close();

  // 古いタブが起動後に新スキーマへ更新されたstateを保存で上書きしない。
  page=await isolatedPage();await page.goto(base);await putState(page,raw(5));await page.reload();await page.waitForFunction(()=>document.getElementById('accountCount')&&document.getElementById('accountCount').textContent!=='—');
  const newer=raw(6);newer.marker='newer-tab-data';await putState(page,newer);
  const saveResult=await page.evaluate(async()=>{state.testUnsavedMarker='unsaved-old-tab-change';return await save();});
  const finalState=await getState(page);
  check('古いタブの保存は将来バージョンを拒否する',saveResult===false);
  check('古いタブは新しいタブのstateを上書きしない',finalState.schemaVersion===6&&finalState.marker==='newer-tab-data');
  check('保存拒否時に古いタブの未保存変更をロールバックする',await page.evaluate(()=>state.testUnsavedMarker!=='unsaved-old-tab-change'));
  await page.close();
 }finally{for(const isolated of isolatedContexts)await isolated.close();await browser.close();server.close();}
 const passed=checks.filter(x=>x.ok).length,failed=checks.length-passed;
 for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.detail?' — '+c.detail:''}`);
 console.log(`\nData safety E2E: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error('Data safety E2E crashed:',e);process.exitCode=2;server.close();});
