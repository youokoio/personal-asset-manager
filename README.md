# Personal Asset Manager v0.2.0

## 概要
- iPhone Safari / PWA向けの個人用資産管理アプリ
- 資産データはブラウザのIndexedDBに保存
- 外部ライブラリ、CDN、解析、広告、外部APIなし
- オフライン用Service Worker
- JSONの検証付きインポート
- 通常JSONバックアップとAES-256-GCM暗号化バックアップ
- 口座、FX建玉、残高スナップショット、保有資産の追加・編集・削除

## GitHubへ登録するファイル
このフォルダ内のファイルだけを登録してください。
**個人の資産データJSONは絶対にGitHubリポジトリへ登録しないでください。**
GitHub FreeでPagesを使う場合、公開リポジトリになるため、ソースコード以外の個人情報は置かないでください。

## GitHub Pages
1. GitHubで `personal-asset-manager` リポジトリを作成（Public）。
2. このフォルダの `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `README.md` をリポジトリ直下へアップロード。
3. Settings → Pages → Deploy from a branch → Branch `main` / folder `/ (root)` → Save。
4. 公開URLをSafariで開く。
5. 初回ロード後、共有メニュー → ホーム画面に追加。
6. 初期JSONはGitHubへアップロードせず、アプリの「データ管理」から読み込む。

## 注意
- 本版は開発用v0.2です。税金計算、ロスカット計算、スワップ日次履歴、取引履歴、資産推移チャートはまだ実装していません。
- FX建玉の数量・残高は初期JSONに誤りが含まれる可能性があります。正しい値を確認してから利用してください。
- 口座間で証拠金・ロスカット条件を合算しません。
- IndexedDBのデータは端末内保存ですが、iOSのサイトデータ削除やストレージ整理で消える可能性があります。暗号化バックアップを別の安全な場所へ保存してください。
- 暗号化バックアップはパスワードを忘れると復元できません。12文字以上の十分に強いパスワードを使用し、アプリ外で安全に保管してください。
- 本版はIndexedDB内のデータ自体は暗号化していません。暗号化されるのはバックアップファイルです。
- Service Workerはアプリのオフライン動作に必要です。更新確認ボタンを使う場合のみ、ユーザー操作で更新確認を実行します。ただしブラウザ自体がService Workerの更新確認を行う場合があります。
- HTTPS環境でのみService Workerが利用できます（localhostを除く）。
