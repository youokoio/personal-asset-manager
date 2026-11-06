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
