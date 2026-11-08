# v0.6.1-alpha1 変更履歴（基準：v0.6.0-alpha1）

今回の範囲は「最新の正規化JSONの取り込みと表示」のみです（画面デザイン変更・新機能は行っていません）。

## 追加・変更
- 正規化JSON（`dataType: personal_asset_management`）の自動判定・検証・変換・追加のみの統合（`store-core.js`）
- 取り込み処理（`app.js`）：形式判定→検証→件数の確認→取り込み前の控え→複製に統合→整合性検証→保存→結果表示。再取り込み時は「追加するデータはありません」と表示し、データ・履歴は変更しない
- 操作履歴に取り込み記録（件数のみ）を追加
- 取り込み画面の説明文を、アプリ形式は置き換え・正規化JSONは追加のみ、と正確な内容に変更
- `.gitignore` を追加（個人資産JSON・バックアップ・取り込み結果の誤コミット防止）
- Service Workerのキャッシュ名を `pam-shell-v0.6.1-alpha1` に更新

## 原因（取り込めなかった理由）
JSONの構造の誤りではなく、アプリ側に正規化JSONの変換処理がなかったことが原因です（dataType不一致・必須配列欠落で拒否）。

## 追加したファイル
`IMPORT_CANONICAL_v1.md` / `CHANGELOG_v0_6_1.md` / `TEST_CHECKLIST_v0_6_1.md` / `.gitignore` / `tests/canonical-import.test.cjs` / `tests/e2e-canonical.cjs` / `tests/fixtures/canonical-fixture.cjs`

## 変更したファイル
`store-core.js` / `app.js` / `index.html`（説明文のみ） / `styles.css`（結果表示の色） / `sw.js`（キャッシュ名） / `tests/make-report.cjs` / `tests/e2e-browser.cjs`（版数表記） / `README.md` / `DATA_SCHEMA_v0_5.md` / `TEST_REPORT_v0_6.md`

## データ構造
schemaVersion は 5 のまま（変更なし）。`state.canonicalData`（任意）を追加。既存データの形式変更はなし。

## テスト
単体 654件（既存344件＋取り込み310件）、実ブラウザ総合 175項目（既存129＋取り込み46）。詳細は `TEST_REPORT_v0_6.md`。
