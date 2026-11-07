# v0.6.0-alpha1 変更履歴（基準：v0.5.0-alpha2）

## 変更した機能
- 保存処理：複製に変更→検証→IndexedDB保存→成功後に差し替え。失敗時は変更前の状態を維持。描画は保存と分離。
- 口座・建玉・保有資産の編集：IDを編集不可に。建玉の約定日・当初数量・固定約定レートを登録後変更不可に。決済数量・残数量は自動計算で編集不可。
- 建玉の決済：全数量決済／未決済の二択を検証付きに。決済済みから未決済への復帰は「決済の訂正」に分離。
- 口座の削除：参照されている口座は削除不可。
- 入出金・手数料：計算ロジックを `finance-core.js` に集約。削除を論理削除に変更。
- JSON取り込み・暗号化バックアップ復元：全面的な検証。置き換え前に件数と失われるものを表示。置き換え前の状態を控えとして保存。全データ削除も控えを経由。
- 履歴一括入力：重複登録の防止、過去日付・修正時の後続データ影響の通知、二重保存の防止、桁区切り。
- 概要画面：総資産・総負債・純資産、口座別評価、FX口座別サマリー、最終保存日時。

## 修正した不具合
- 保存失敗時にメモリ上のデータだけが変更されたまま残り、次の保存でDBに書き込まれてしまう問題。
- 口座ID・建玉ID・保有資産IDを編集すると他データからの参照が壊れる問題。
- 建玉の当初数量を後から変更できた問題。
- 決済済みの建玉を理由なく未決済に戻せた問題。
- 口座を削除すると、建玉・残高・入出金が存在しない口座を参照した状態で残る問題。
- 入出金を削除すると記録そのものが消える問題（論理削除に変更）。
- JSON取り込み時の検証不足（配列に空要素があると検証処理自体が例外になる問題を含む）。
- ローン系口座の残高を資産集計で取得できなかった問題（テストで検出し修正）。

## 追加したファイル
- `store-core.js`（移行・整合性チェック・インポート検証・建玉ルール）
- `finance-core.js`（入出金計算・資産集計・欠損を補間しない時系列・スワップ按分）
- `REQUIREMENTS_v0_6.md` / `CHANGELOG_v0_6.md` / `TEST_REPORT_v0_6.md` / `TEST_CHECKLIST_v0_6.md` / `GITHUB_DEPLOY_v0_6.md`
- `tests/store-core.test.cjs` / `tests/finance-core.test.cjs` / `tests/make-report.cjs`

## 変更したファイル
`index.html` / `app.js` / `history-core.js` / `styles.css` / `sw.js`（キャッシュ名 `pam-shell-v0.6.0-alpha1`、対象ファイルを追加） / `README.md` / `DATA_SCHEMA_v0_5.md`（v5の節を追加） / `tests/cash-ledger.test.cjs`（`finance-core.js`を直接読む形に変更） / `tests/bulk-history.test.cjs` / `tests/e2e-browser.cjs`

## 削除したファイル
なし。前版の `CHANGELOG_v0_5_0_alpha2.md` と `TEST_CHECKLIST_v0_5.md` は履歴として残している。

## データ構造の変更（schemaVersion 4 → 5。追加のみ）
- 追加配列：`fxCorrections`・`migrationHistory`、予約：`swapRateHistory`・`liabilities`・`loanRepayments`・`cryptoTransactions`
- 追加項目：`lastModifiedAt`、cashTransactions・fees の `deletedAt`
- 追加キー（IndexedDB）：`pre_migration_backup`
- 口座種別に「住宅ローン」「ローン」を追加
- 起動時に自動移行（移行前の状態を完全コピーして保持。冪等）
