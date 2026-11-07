# GitHubへの反映手順（iPhone・Safari想定）

**この作業環境はGitHubに接続できず、ブランチへの反映は行っていません。** 以下は手動で反映する手順です。**mainブランチは変更しません。**

## 0. 先に確認すること
- ZIPは、前段階で作成した v0.5.0-alpha2 のソースを基準にしています。リポジトリの `feature/bulk-history-entry` の実ファイルとずれている可能性があるため、アップロード前に、リポジトリ側の `app.js` と `index.html` の最終更新日を確認してください。内容が違う（別の修正が入っている）場合は、上書きせず相談してください。
- GitHub Pagesの「公開元ブランチ」が main になっている場合、開発ブランチへ反映しただけではiPhoneのアプリには反映されません。「Settings → Pages」で公開元を確認してください（mainへの反映は、動作確認後に自分の判断で行います）。

## 1. データのバックアップ（必須）
iPhoneのアプリで「データ管理」→「暗号化バックアップ」を作成し、「ファイル」アプリやiCloud Driveなど端末外へ保存します。**バックアップをGitHubへアップロードしないでください。**

## 2. ブラウザ（Safari）でブランチを開く
1. Safariで `https://github.com/youokoio/personal-asset-manager` を開く（画面下の「ページ設定（ぁあ）」→「デスクトップ用Webサイトを表示」にすると操作しやすい）。
2. ブランチ切替（「main」と表示されている所）をタップし、`feature/bulk-history-entry` を選ぶ。**「main」のままアップロードしないこと。**

## 3. ファイルをアップロード
ZIPを「ファイル」アプリで展開し、リポジトリ直下に次をアップロードします（「Add file → Upload files」）。

| 区分 | ファイル |
|---|---|
| 必須・変更 | `index.html` `app.js` `history-core.js` `styles.css` `sw.js` |
| 必須・新規 | `store-core.js` `finance-core.js` |
| 変更なし | `manifest.webmanifest`（アップロード不要） |
| 説明・検証用（任意） | `README.md` `REQUIREMENTS_v0_6.md` `CHANGELOG_v0_6.md` `TEST_REPORT_v0_6.md` `TEST_CHECKLIST_v0_6.md` `GITHUB_DEPLOY_v0_6.md` `DATA_SCHEMA_v0_5.md` `SHA256SUMS.txt` |
| テスト（任意） | `tests/` フォルダ（フォルダごとのアップロードは、Safariでは難しい場合があります。必須ではありません） |

注意：`store-core.js` `finance-core.js` `history-core.js` のどれか1つでも抜けるとアプリは起動しません。
下部の「Commit changes」で **「Commit directly to the feature/bulk-history-entry branch」** を選んでコミットします。

## 4. 公開後の確認（iPhone）
1. ホーム画面のアプリを**完全に閉じる**（アプリスイッチャーで上にスワイプ）。
2. 開き直し、「データ管理」の「バージョン」が `0.6.0-alpha1` か確認。違えばもう一度閉じて開く（1〜2回必要な場合があります）。
3. `TEST_CHECKLIST_v0_6.md` の項目を確認。

## 5. うまくいかない場合
- 画面が真っ白／エラー：ファイルの抜け（特に3つの `*-core.js`）を確認。
- データが見えない：データは消えていません。アプリを閉じて開き直し、それでも駄目なら「データ管理」の「直前の状態を書き出す」または、手順1のバックアップから復元。
- 戻したい場合：リポジトリの該当ファイルを前のコミットの内容に戻す（IndexedDBのデータは schemaVersion 5 のまま残りますが、前の版でも読み込めるよう追加項目のみの構造です）。ただし、念のため戻す前にバックアップを取得してください。
