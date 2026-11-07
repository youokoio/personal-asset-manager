# データ構造メモ v0.5.0-alpha1

## 互換性
- v0.4の `accounts` / `fxPositions` / `balanceSnapshots` / `holdings` / `timeSeriesRecords` / `timeSeriesRevisions` / `editHistory` を維持する。
- 起動時に不足する配列を追加し、既存データは削除・再生成しない。
- `schemaVersion` は4。
- 既存FX建玉に `executionDate` / `originalExecutionRate` / `dailySwapAmount` / `registeredAt` / `updatedAt` を補完する。
- 旧 `openDate` / `openPrice` は互換用の値として保持し、新しい固定項目の別名として同期する。

## cashTransactions
口座間振替・単独入出金・手数料のみの記録を管理する。

| フィールド | 内容 |
|---|---|
| transactionId | 一意な取引ID |
| transactionType | transfer / deposit / withdrawal / fee |
| effectiveDate | 発生日 |
| sourceAccountId | 振替元・出金元 |
| targetAccountId | 振替先・入金先 |
| amount | 振替・入出金額 |
| feeAmount | 手数料額 |
| feeCategory | transfer / deposit / withdrawal / trading / crypto / other |
| feeAccountId | 手数料負担口座 |
| feeMode | additional / deducted |
| currency | JPY / BTC / SOL |
| transferId | 口座間振替を関連付ける共通ID |
| registeredAt / updatedAt | 登録・最終変更日時 |
| memo | 摘要 |

`transfer` は1件の親記録からsource口座とtarget口座の双方の増減を計算する。片側の記録だけを別々に作らず、共通IDで関連付けることで二重登録を避ける。

## fees
手数料の独立した費用台帳。`transactionId` により元の入出金・振替・手数料記録と関連付ける。

| フィールド | 内容 |
|---|---|
| feeId | 一意な手数料ID |
| transactionId | 関連する資金移動・取引ID |
| effectiveDate | 発生日 |
| accountId | 負担口座 |
| category | 手数料種別 |
| amount | 手数料額 |
| currency | 通貨 |
| memo | 摘要 |

## FX建玉の追加項目

| フィールド | 内容 |
|---|---|
| executionDate | 実際の新規約定日（固定） |
| originalExecutionRate | 新規約定時の固定レート |
| referenceRate | 各記録時点の参考レート |
| dailySwapAmount | 日次スワップ額 |
| settlementDate | 全数量決済日 |
| settlementRate | 全数量決済レート |
| registeredAt | システム登録日時 |
| updatedAt | 最終変更日時 |

FX建玉の決済状態はopen/closed。closedの場合、closedQuantity=originalQuantity、remainingQuantity=0。openの場合、closedQuantity=0、remainingQuantity=originalQuantity。

## 既存時系列履歴
`timeSeriesRecords` と `timeSeriesRevisions` はv0.4の仕様を維持する。既存のスナップショット・建玉データと自動加算しない。関連付け・照合が実装されるまでは独立した記録として扱う。

## v0.5.0-alpha2 の追加項目（追加のみ・schemaVersion 4 のまま互換）
既存データの形式は変更しない。以下は任意の追加項目で、無い旧データはそのまま読める。

### timeSeriesRecords の追加項目
| フィールド | 内容 |
|---|---|
| effectiveDate | 対象日（YYYY-MM-DD、端末の現地日付）。無い旧データは effectiveAt から導出 |
| datePrecision | `date`（日付のみ。effectiveAtは現地0時）／`datetime` |
| batchId | 一括操作ID。一括登録・編集・削除で付与 |
| derivedFields | 自動計算で補完した項目名の配列 |
| source | `bulk`（一括入力）を追加 |
| recordType | `crypto_snapshot`（暗号資産評価）を追加 |

`registeredAt`（登録日時）は最初の保存時刻で不変。`updatedAt` は最終変更日時。対象日とは独立している。

### values に入る項目（数値。未入力は null または省略）
- 銀行（bank_balance）：openingBalance, deposit, withdrawal, adjustment, balance
- FX（account_snapshot）：referenceRate, balance, netAssetValue, marginRequirement, positionQuantity, fxProfitLoss, accumulatedSwap
- 証券・DC（securities_snapshot）：cumulativePrincipal, effectivePrincipal, realizedProfitLoss, unrealizedProfitLoss, valuation, cashBalance（証券のみ）
- 暗号資産（crypto_snapshot）：entityId=BTC/SOL。quantity, referencePrice, valuation, effectivePrincipal, unrealizedProfitLoss, realizedProfitLoss, jpyBalance
- 旧項目 amount, quantity, rate, profitLoss, swap は維持。一括編集・個別編集のどちらでも、画面が扱わない項目は消さずに保持する。

### timeSeriesRevisions
一括操作の各行について、`create`／`edit`／`logical_delete` を `before`・`after`・`reason`・`changedAt`・`batchId` 付きで記録する。

### editHistory
一括操作1回につき `recordType: bulkHistory`、`action: bulk` を1件記録（口座・項目セット・理由・件数・対象recordId一覧）。保持上限を 2,000 件から 10,000 件に拡大。

### IndexedDB（DB名・バージョン・ストアは不変）
- キー `state`：従来どおりのアプリ全データ（JSONバックアップの対象）
- キー `bulk_draft`：一括入力の下書き（バックアップ対象外）
- キー `pre_import_backup`：取り込み・復元・全削除の直前の状態（1世代。バックアップ対象外）

## v0.6.0-alpha1（schemaVersion 5）の追加項目
追加のみ。既存項目の削除・型変更はなく、旧データは起動時に不足項目を補完して移行する（既存データは消去しない）。

### 追加された配列（予約を含む）
| 配列 | 用途 |
|---|---|
| fxCorrections | 決済の訂正（使用中）：correctionId, positionId, type=`reopen`, reason, at, before, after |
| migrationHistory | 移行履歴：from, to, at, note |
| swapRateHistory | 予約：スワップ単価（1万通貨当たり、買い・売り別）の変更履歴 |
| liabilities | 予約：住宅ローン等の借入条件・金利履歴 |
| loanRepayments | 予約：返済日・元金・利息・実際の引落額・繰上返済 |
| cryptoTransactions | 予約：購入・売却・数量・単価・手数料（取得単価の計算方式は未決定） |

トップレベルに `lastModifiedAt`（最終保存日時、ISO8601）を追加。

### 論理削除
cashTransactions・fees・timeSeriesRecords は `deletedAt`（ISO8601、削除時のみ）を持つ。削除済みの記録は一覧・集計・参照整合性チェックから除外され、データには残る。口座・建玉・保有資産・残高記録は物理削除だが、削除前の内容が editHistory の `before` に残る。

### editHistory の action
`create` / `edit` / `delete` / `restore` / `import` / `bulk`（履歴一括操作） / `correction`（決済の訂正）

### 固定項目（登録後は通常編集で変更不可）
口座ID、建玉ID、保有資産ID、建玉の `executionDate`・`originalExecutionRate`・`originalQuantity`。

### 日時の意味
- `effectiveDate`（YYYY-MM-DD）：取引・評価が実際に発生した日
- `registeredAt`：アプリに最初に登録した日時（不変）
- `updatedAt`：アプリ内で最後に変更した日時
旧データの balanceSnapshots には registeredAt / updatedAt がない（既存データを書き換えないため）。

### IndexedDB（DB名・バージョン・ストアは不変）
キー `state`（JSONバックアップの対象） / `bulk_draft`（一括入力の下書き） / `pre_import_backup`（取り込み・復元・初期化の直前） / `pre_migration_backup`（schemaVersion移行の直前）。

### JSONインポートの検証ルール
必須配列（accounts / fxPositions / holdings / balanceSnapshots）、配列型、要素の型、ID重複、日付（YYYY-MM-DD）・日時、数値（有限の数値）、負の値、列挙値（status / side / transactionType / feeMode）、振替元・先、schemaVersion（5を超える場合は拒否）。参照先の口座が存在しない場合は、schemaVersion 5のデータはエラー、旧版データは警告（過去の口座削除で生じ得るため）。
