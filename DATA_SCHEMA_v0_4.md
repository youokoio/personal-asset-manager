# データ構造メモ v0.4.0-alpha1

## 方針
- 既存の `accounts` / `fxPositions` / `balanceSnapshots` / `holdings` 等は互換性のため維持する。
- 今回追加した時系列履歴は `timeSeriesRecords` に独立保存する。
- 変更履歴は `timeSeriesRevisions` に追加型で保存し、元記録の上書きだけで履歴が失われないようにする。
- 既存の `editHistory` は従来の口座・建玉・残高・保有資産の操作履歴として維持する。

## timeSeriesRecords

| フィールド | 内容 |
|---|---|
| recordId | 一意な履歴ID |
| recordType | account_snapshot / bank_balance / fx_position / fx_swap / fx_settlement / securities_snapshot / contribution / mortgage / other |
| accountId | 関連口座ID（任意） |
| entityId | 建玉ID・商品IDなど（任意） |
| effectiveAt | 実績として有効な日時（ISO 8601 UTC） |
| registeredAt | アプリに登録した日時 |
| updatedAt | 最終修正日時 |
| timezone | 登録時のIANAタイムゾーン |
| valueKind | actual / manual_historical / estimate / calculated / simulation |
| source | manual / import / estimate / system |
| values | amount / quantity / rate / profitLoss / swap |
| memo | 根拠・メモ |
| deletedAt | 論理削除日時。通常一覧では非表示 |

## timeSeriesRevisions

- revisionId: 変更履歴ID
- recordId: 対象の時系列記録ID
- action: create / edit / logical_delete
- changedAt: 変更日時
- reason: 修正理由
- before / after: 変更前後のレコード全体のスナップショット

## 注意
- v0.4.0-alpha1では、時系列履歴は旧来の `balanceSnapshots` や `fxPositions` とまだ自動同期しない。現行データとの二重計上を防ぐため、明示的な移行・関連付け機能を実装するまで、これらを同じ集計に加算してはならない。
- 旧データから時系列履歴への自動生成はまだ行わない。既存データを勝手に複製・変換しない。
- すべての数値項目は未入力を `null` として保持し、0とは区別する。
