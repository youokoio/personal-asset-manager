# 正規化JSON（personal_asset_management v1）取り込み仕様

アプリ v0.6.1-alpha1 以降は、「データ管理」の「JSONを検証して取り込む」（および暗号化バックアップの復元）で、次の2種類のJSONを自動判定して取り込みます。

| 形式 | 判定 | 取り込み方 |
|---|---|---|
| アプリ形式（バックアップ） | `dataType: personal_asset_manager`、または必須4配列（accounts / fxPositions / holdings / balanceSnapshots）あり | 検証後、現在のデータを**置き換え**（従来どおり） |
| 正規化JSON | `dataType: personal_asset_management` | 検証後、既存データを**上書き・削除せず追加のみ** |

## なぜ従来の取り込みで読めなかったか（原因の区別）
- **JSONの構造に問題があったのではありません。** 正規化JSONは別形式（`dataType` が `personal_asset_management`、schemaVersion は別体系の1）で、配列名も異なります（`accountBalanceSnapshots`、`fxPositionEvents` など）。
- **アプリ側に変換処理がなかったことが原因です。** 従来の取り込みは、`dataType` 不一致と必須配列 `holdings`・`balanceSnapshots` の欠落で拒否していました。

## 取り込みの流れ
1. 形式判定（`schemaVersion` が対応範囲を超える場合は拒否）
2. 検証（下記）。問題があれば**すべて列挙して中止**し、データは一切変更しない
3. 試算して件数を表示（追加／重複で追加しない／競合）。確認後に実行
4. 取り込み前の状態を端末内に控えとして保存（保存できなければ中止）
5. 複製に統合 → 整合性検証 → IndexedDBへ保存 → 成功後にだけ画面へ反映（保存失敗時は変更前の状態を維持）
6. 結果を画面に表示し、操作履歴に件数のみ記録（金額などは記録しない）

## 検証項目
dataType／schemaVersion／必須配列（accounts）／配列の型／要素の型／ID重複（口座・残高記録・建玉・イベント・原資料）／参照先（建玉・残高記録→口座、イベント→建玉。既存データのIDも参照可）／日付（YYYY-MM-DD）／日時／数値（文字列の数値は拒否、null は許可）／売買（buy/sell）／状態（open/closed）／数量・約定レート（0より大きい）／決済日（約定日以降）。
警告（取り込みは可能・値は変更しない）：未知の口座種別、原資料IDの参照切れ、決済済みで決済日・決済レートが不明、未決済なのに決済情報あり、未知のキー。

## 項目の対応（値は変更しない）
| 正規化JSON | アプリ内 |
|---|---|
| accounts: institution / accountName / accountType / baseCurrency | institutionName / accountName / accountType / currency（他の項目は同名で保持） |
| accountBalanceSnapshots: effectiveDate | snapshotDate |
| cashBalance / accountValuation / netAssets | balance / evaluationAmount / netAssetValue |
| requiredMargin / unrealizedPnl / cumulativeSwap | marginRequirement / unrealizedProfitLoss / accumulatedSwap |
| notes | memo（そのまま。文中の数値は取り出さない） |
| fxPositions: executionDate / originalExecutionRate / originalQuantity | executionDate（＝openDate）/ originalExecutionRate（＝openPrice）/ originalQuantity |
| 状態・決済 | status、settlementDate、settlementRate、realizedPnl→realizedProfitLoss（null は null のまま）。未決済は 決済数量0・残数量=当初数量 |
| lots / quantityUnit / notes / sourceDocumentIds / verificationStatus | lots / quantityUnit / memo / sourceDocumentIds / verificationStatus（そのまま保持） |
| fxPositionEvents（swap_recorded） | 建玉に swap_recorded が**ちょうど1件**ある場合のみ、その swapAmount を accumulatedSwap に設定（出典イベントを accumulatedSwapSource に保持）。複数ある場合は断定せず null |
| 参照レート・日次スワップ・評価損益（建玉別） | JSONに構造化された値が無いため **null のまま**（備考欄の文章から推測しない） |

全建玉・口座・残高記録に `importSource: "canonical-v1"` を付与します。

## 重複登録の防止（再取り込みしても増えない）
- **口座**：IDが同じなら追加しない（名前・種別が違えば「競合」として報告し、既存を維持）。IDが違っても「口座名＋種別」が同じ既存口座があれば同一口座とみなし、新しい口座を作らず既存口座へ紐付ける。
- **建玉**：IDが同じなら追加しない。ID違いで「口座・通貨ペア・売買・約定日・数量・約定レート」が既存と一致する場合は、**既存の件数分だけ**重複として追加しない。取り込みデータ内の同条件の建玉（同じ日・同じレート・同じ数量の別建玉）は、**1件にまとめない**。
- **残高記録**：IDが同じ、または同じ口座・日付・全数値が同じなら追加しない。同日で数値が違う場合は別の記録として追加（同日複数記録は許容）し、報告する。
- 既存の値と異なる内容は**上書きしない**。

## 原データの保持（無視しない）
アプリに表示項目がない配列も、内容を失わず `state.canonicalData` に追加のみで保持します（JSONバックアップにも含まれる）：sourceDocuments／fxPositionEvents／migrationNotes／fxSwapRateHistory／fxAccountSwapSnapshots／investmentHoldings／investmentAccountSnapshots／investmentTransactions／cryptoHoldings／cryptoTransactions／cryptoAccountSnapshots／mortgage系／auditLogs／cashTransactions／fees。メタ情報（schemaVersion・createdAt・description・rules）と取り込み履歴（日時・件数）も保持。

## 現時点で画面に表示されないもの（推測せず保持のみ）
**投資（楽天証券・iDeCo・企業型DC等）の保有商品、暗号資産の保有・取引、住宅ローン**の配列は、実際のレコード例がなく項目の意味を推測できないため、アプリの保有資産・暗号資産画面へは変換していません。これらの配列に内容がある場合は、`canonicalData` に原データのまま保持し、取り込み結果に「表示未対応」と報告します。**JSONにこれらのデータが入っていなければ、画面にも表示されません。**
