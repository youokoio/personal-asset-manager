/* TEST_REPORT_v0_6.md を、実際のテスト実行結果から生成する。
   使い方: node tests/make-report.cjs <E2E結果JSON> <出力MD>   （E2E結果は RESULTS_JSON=... node tests/e2e-browser.cjs ... で作成） */
const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const [,, e2ePath, outPath, canonPath]=process.argv;
const root=path.join(__dirname,'..');
const unit=['cash-ledger','finance-core','store-core','bulk-history','canonical-import'].map(n=>{const r=spawnSync(process.execPath,[path.join(__dirname,n+'.test.cjs')],{cwd:root,encoding:'utf8'});return {name:n+'.test.cjs',ok:r.status===0,out:(r.stdout||'').trim().split('\n').filter(l=>/passed/.test(l)).join(' / '),err:(r.stderr||'').split('\n')[0]};});
const e2e=e2ePath&&fs.existsSync(e2ePath)?JSON.parse(fs.readFileSync(e2ePath,'utf8')):null;
const canon=canonPath&&fs.existsSync(canonPath)?JSON.parse(fs.readFileSync(canonPath,'utf8')):null;
const rec=e2e?e2e.records:[];
// 指示書「必須テスト」との対応。evidence は E2E のチェック名に含まれる文字列
const ITEMS=[
 ['通常保存','口座・入出金・履歴を通常どおり保存','保存成功が表示され、IndexedDBとメモリが一致','E2E',['復旧後は同じ入力でそのまま保存できる','二重送信しても1件だけ','口座間振替が保存できる','建玉の新規登録'],'finance/bulk 単体も保存系ロジックを検証'],
 ['IndexedDB保存失敗時のロールバック','dbPutを強制失敗させて編集を保存','エラー表示、メモリ・IndexedDB・画面とも変更前のまま、入力は失われない','E2E',['IndexedDB保存失敗時','保存失敗時：']],
 ['描画失敗時のデータ整合性','render()を強制的に例外化して保存','データは保存済みで、メモリとIndexedDBが完全一致。未処理エラーにならない','E2E',['描画失敗時']],
 ['ID変更の防止','IDの入力欄を改ざんして保存','口座ID・建玉ID・保有資産IDは変更されず、参照が壊れない','E2E',['口座IDは変わらない','建玉ID・約定日','建玉のID','保有資産IDは編集不可'],'store-core 単体（固定項目の拒否）'],
 ['FX建玉の約定数量・約定レートの固定','約定日・約定数量・約定レートを改ざんして保存','変更不可のメッセージで拒否し、データは不変','E2E',['建玉の約定数量を改ざん','建玉の約定日を改ざん','建玉の約定レートを改ざん','全数量決済：決済数量'],'store-core 単体 buildPosition'],
 ['建玉の決済・訂正','全数量決済→通常編集での復帰拒否→理由付き決済の訂正','部分決済なし。訂正は理由必須で、前後・日時を記録。約定情報は不変','E2E',['全数量決済','決済済み建玉','決済済みを通常編集','決済の訂正'],'store-core 単体 reopenPosition'],
 ['手数料 additional','銀行→FX 100,000円、手数料220円を別途差引（銀行負担）','銀行 -100,220円／FX +100,000円／手数料 220円','E2E',['銀行 -100,220円','手数料additional・第三口座'],'finance-core / cash-ledger 単体'],
 ['手数料 deducted','手数料を振替金額から控除','銀行 -100,000円／FX +99,780円','E2E',['手数料deducted'],'finance-core / cash-ledger 単体'],
 ['第三口座が手数料を負担','手数料負担口座を第三の口座にして振替','銀行 -100,000／FX +100,000／第三 -220','E2E',['第三口座'],'finance-core 単体（内部振替の二重計上なし＝合計は手数料分のみ減少）'],
 ['入金・出金・内部振替','外部入金／外部出金／単独手数料／内部振替を登録','種別ごとに正しく残高差額へ反映。内部振替は二重計上しない','E2E',['外部入金・外部出金','口座間振替が保存できる','保存された入出金5件'],'finance-core 単体 totalEffect'],
 ['JSON正常インポート','正常なJSON（旧形式v3）の取り込みと、控えJSONからの復元','検証成功→確認→取り込み。件数・失われるものを事前表示','E2E',['正常な旧形式データ(v3)','控えのJSONから元の状態に復元','取り込みデータに操作履歴がない']],
 ['JSON不正データの拒否','壊れたJSON、必須配列欠落、将来バージョン、ID重複、日付/数値不正、孤立参照など','部分的に読み込まず、問題箇所を表示してデータは変更されない','E2E',['不正データを拒否','問題が複数ある場合','暗号化バックアップの中身が不正'],'store-core 単体 validateImport（約30パターン）'],
 ['古いバージョンのデータのマイグレーション','alpha1(schemaVersion 4)の実データ相当、v0.4相当(v3)の取り込み','既存項目は不変、予約配列追加、移行履歴、移行前の控え、冪等','E2E',['旧バージョン(v4)','移行：schemaVersion','移行前の状態が別キー','移行は重複実行されない','旧形式データは移行されて','alpha1形式のJSON取り込み'],'store-core 単体 migrateState'],
 ['重複履歴の防止','同じ内容の履歴の再登録、保存ボタン連打、入出金の二重送信','重複は保存不可。連打・二重送信でも1回だけ','E2E',['重複登録できない','連打しても','二重送信'],'bulk-history 単体（同一一括IDの二重適用拒否など）'],
 ['過去日付の履歴登録','2019年の履歴を2026年に登録','対象日(effectiveDate)と登録日時(registeredAt)が別。後続データへの影響確認が出る','E2E',['過去日付'],'bulk-history 単体'],
 ['履歴修正・論理削除・監査記録','一括編集で値修正・削除','修正前後・理由・日時・一括IDを記録。削除は論理削除で記録は残る','E2E',['修正前後(200,000→205,000)','登録日時は不変','削除は論理削除','論理削除した記録は通常一覧','各行に新規の修正履歴','操作履歴に一括操作'],'bulk-history 単体'],
 ['オフライン起動','Service Worker登録後にオフライン化して再読み込み','データを参照でき、一括入力も使える','E2E',['機内モード相当','オフラインでも一括入力画面'],'※Chromium。iPhone Safari実機は未実施'],
 ['バックアップ・復元','暗号化/通常JSONの書き出し・復元、復元前の控え','書き出せる。復元で全データが戻る。復元前の状態が控えとして残る','E2E',['暗号化バックアップを書き出せる','通常JSONバックアップ','暗号化バックアップから復元できる','復元後も一括入力','復元前の状態が控えとして','控えをJSONとして'],'store-core 単体'],
];
const CITEMS=[
 ['最新JSON（正規化形式）を読み込める',['最新JSONを読み込める','取り込み前に内容を確認','取り込み結果が画面に表示']],
 ['FX各口座の建玉数・残高が正しく反映される',['FX各口座の建玉数がJSONと一致','FX建玉が','口座の残高・評価額','残高履歴に','FX建玉一覧に']],
 ['楽天証券の保有商品が表示される',['JSONに投資・暗号資産のデータが無い場合']],
 ['iDeCoの保有商品が表示される',['JSONに投資・暗号資産のデータが無い場合']],
 ['企業型DCの保有商品が表示される',['JSONに投資・暗号資産のデータが無い場合']],
 ['暗号資産の銘柄・数量・評価額が正しく表示される',['JSONに投資・暗号資産のデータが無い場合']],
 ['概要画面の資産合計に二重計上がない',['概要：']],
 ['アプリを再読み込みしてもデータが維持される',['再読み込み','オフラインでも起動']],
 ['JSONを再度インポートしても重複登録されない',['再取り込みしても','3回目も','再取り込みでも']],
 ['JSONの値を変更・推測補完しない／既存データを壊さない',['JSONの値のまま','推測せず null','既存データ','失われずに保持','取り込んだ建玉を編集','約定数量は変更できない']],
 ['不正な正規化JSONを部分的に読み込まず拒否する',['拒否：']],
];
const find=subs=>rec.filter(r=>subs.some(x=>r.name.includes(x)));
let md=`# TEST_REPORT v0.6.0-alpha1\n\n`;
md+=`- 作成：${new Date().toISOString()}（このファイルは \`tests/make-report.cjs\` が実際の実行結果から自動生成）\n`;
md+=`- テストデータ：すべて架空の口座・金額・建玉（実在の個人金融データは未使用）\n`;
md+=`- 実行環境：Node ${process.version}${e2e?` ／ ${e2e.browser}（Playwright、幅390×844のモバイルエミュレーション、タイムゾーンAsia/Tokyo）`:''}\n`;
md+=`- 注意：**iPhone Safari（WebKit）実機でのテストは未実施**です。PC上のChromiumでの結果であり、iPhone固有の挙動（ソフトウェアキーボード、PWAのホーム画面起動、Safariのストレージ制限など）は確認できていません。\n\n`;
md+=`## 1. 結果サマリー\n\n| 区分 | 件数 | 結果 |\n|---|---|---|\n`;
for(const u of unit)md+=`| 単体テスト ${u.name} | ${u.out||'—'} | ${u.ok?'合格':'**不合格** '+u.err} |\n`;
md+=`| 実ブラウザ総合テスト（Chromium） | ${e2e?`${e2e.passed+e2e.failed}項目`:'—'} | ${e2e?(e2e.failed===0?'全項目合格':`**${e2e.failed}件不合格**`):'**未実施**'} |\n\n`;
md+=`## 2. 指示書の必須テスト項目と結果\n\n`;
let allOk=true;
ITEMS.forEach(([item,act,exp,kind,subs,note],i)=>{
 const hit=find(subs);const pass=hit.filter(h=>h.pass).length;
 let verdict,actual;
 if(!hit.length){verdict='未実施';actual='該当する実行結果がありません（E2E結果JSONなし、または対応チェックなし）';allOk=false;}
 else if(pass===hit.length){verdict='合格';actual=`実ブラウザ総合テスト ${pass}/${hit.length} 項目合格`;}
 else{verdict='**不合格**';actual=`実ブラウザ総合テスト ${pass}/${hit.length} 項目合格。不合格：${hit.filter(h=>!h.pass).map(h=>h.name).join(' / ')}`;allOk=false;}
 md+=`### 2-${i+1}. ${item}\n- 実施内容：${act}\n- 期待結果：${exp}\n- 実際の結果：${actual}${note?`\n- 補足：${note}`:''}\n- 合否：**${verdict}**\n\n`;
});
md+=`## 3. 未実施・確認できていない事項\n\n`;
md+=`- iPhone Safari（WebKit）実機での全項目（数値入力のキーボード、桁区切り入力、ダイアログ内スクロール、ソフトウェアキーボード表示時のレイアウト、ホーム画面PWAのオフライン起動、更新反映）。TEST_CHECKLIST_v0_6.md の手順で実機確認が必要です。\n`;
md+=`- GitHubへの反映（この環境はネットワークに接続できないため、リポジトリの取得・ブランチ作成・push・GitHub Pagesでの公開動作は未実施）。\n`;
md+=`- 実データでの移行確認（架空データの確認のみ。実データ移行の前には必ずバックアップを取得してください）。\n`;
md+=`- FXスワップ按分・住宅ローン・証券売却・暗号資産売買などの次段階機能は、画面・保存処理を未実装のため対象外（FXスワップ按分の計算関数のみ単体テスト済み）。\n`;
md+=`- 並行する複数タブからの同時編集（IndexedDBの競合）は検証していません。\n\n`;
md+=`## 4. 実ブラウザ総合テスト 全項目\n\n`;
if(e2e){let ph='';for(const r of rec){if(r.phase!==ph){ph=r.phase;md+=`\n**${ph}**\n\n| 項目 | 結果 |\n|---|---|\n`;}md+=`| ${r.name.replace(/\|/g,'／')} | ${r.pass?'合格':'**不合格** '+r.detail.slice(0,80).replace(/\|/g,'／')} |\n`;}}else md+='（結果なし）\n';
md+=`\n## 5. 正規化JSON取り込み（v0.6.1）\n\n`;
md+=`- 検証に使ったJSON：**架空データのフィクスチャ**（\`tests/fixtures/canonical-fixture.cjs\` が生成。実際の口座・金額は含まない）。実際のJSONでの結果は、個人情報を含むためこのレポートには載せず、別ファイルで提供しています。\n`;
md+=`- 単体テスト：canonical-import.test.cjs（検証・変換・統合・二重計上）\n`;
if(canon){
 md+=`- 実ブラウザ総合テスト：${canon.passed+canon.failed}項目、${canon.failed===0?'全項目合格':`**${canon.failed}件不合格**`}（${canon.browser}）\n\n`;
 md+=`| 確認項目（依頼書の5章） | 結果 |\n|---|---|\n`;
 for(const [name,subs] of CITEMS){const hit=canon.records.filter(r=>subs.some(x=>r.name.includes(x)));const okc=hit.length&&hit.every(h=>h.pass);
  if(/楽天証券|iDeCo|企業型DC|暗号資産/.test(name)){md+=`| ${name} | **未確認**（取り込んだJSONにこれらのデータが無いため、表示は検証できていません。確認できたのは「データが無い場合に、推測して保有資産を作らない」ことのみ：${hit.length&&okc?'合格':'未実施'}） |\n`;continue;}
  md+=`| ${name} | ${hit.length?(okc?'合格':'**不合格**'):'**未実施**'} |\n`;}
 md+=`\n<details><summary>全項目</summary>\n\n| 項目 | 結果 |\n|---|---|\n`;for(const r of canon.records)md+=`| ${r.name.replace(/\|/g,'／')} | ${r.pass?'合格':'**不合格** '+r.detail.slice(0,80).replace(/\|/g,'／')} |\n`;md+=`\n</details>\n`;
 allOk=allOk&&canon.failed===0;
}else{md+=`- 実ブラウザ総合テスト：**未実施**\n`;allOk=false;}
fs.writeFileSync(outPath||path.join(root,'TEST_REPORT_v0_6.md'),md);
console.log('report written; allRequiredPassed=',allOk,'; units ok=',unit.every(u=>u.ok));
process.exit(allOk&&unit.every(u=>u.ok)&&e2e&&e2e.failed===0?0:1);
