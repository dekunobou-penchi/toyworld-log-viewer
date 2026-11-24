# toyWorld ログビューア

toyWorld の実験ログ（`data/experiments/exp_…/`）を読み込んで、リプレイ・時系列・行動集計を表示するツール。

- **サーバ**（`packages/server`）: 実験フォルダをディスクから読み、`world.jsonl` と `player_*.jsonl` を突き合わせてティックごとの系列を組み立てる。集計（死亡数・空振り率・状況別の行動分布など）もここで計算して API で返す。
- **フロントエンド**（`packages/frontend`）: API の結果を描画するだけ。Vite + TypeScript（フレームワークなし）。
- **shared**（`packages/shared`）: ログ形式と API の型、行動・状況の定数。

## 使い方

```bash
nvm use            # Node 24（22 以上なら動く）
pnpm install

# 開発: API サーバ (3200) と Vite (5180) を同時に起動
DATA_DIR=/path/to/toyWorld/data/experiments pnpm dev
# → http://localhost:5180

# 本番: フロントをビルドして、サーバ1つで配信
pnpm build
DATA_DIR=/path/to/toyWorld/data/experiments pnpm start
# → http://localhost:3200
```

`DATA_DIR` を省略すると `sample-data/`（toyWorld サーバを agent モードで3体・400ティック動かした実ログ）を表示する。

| 環境変数 | 既定値 | 内容 |
|---|---|---|
| `DATA_DIR` | `./sample-data` | `exp_…` フォルダが並ぶディレクトリ |
| `PORT` | `3200` | API サーバのポート |
| `VIEWER_API_PORT` | `3200` | Vite の `/api` プロキシ先（開発時） |
| `VIEWER_DEV_PORT` | `5180` | 開発用 Vite のポート（使用中なら起動時にエラー） |

### 再生バー

下にスクロールしてリプレイの操作が見えなくなると、画面上部に再生バーが出る。グラフや集計を見ながら、その場でティックを動かせる。

- `|◀` `◀` `▶` `▶|`、スライダー：リプレイの操作と同じ
- ティック番号の欄：数字を入れて Enter でそのティックへ（Esc で取り消し）
- 右のボタン：リプレイ / 時系列 / 集計 / 目標分布 の各セクションへ移動

← → / Shift + ← → / Space のキー操作は、スクロール位置に関係なくどこでも使える。

### 時系列の拡大縮小

LP・保持ブロック・Ltime の3つのグラフと行動タイムラインは、同じ表示範囲で一緒に拡大縮小する。縦軸は全期間で固定。

| 操作 | 動作 |
|---|---|
| グラフ上をドラッグ | 選んだ範囲を拡大（動かさずにクリックするとそのティックへ移動） |
| Ctrl/⌘ + ホイール、ピンチ | ポインタの位置を中心に拡大縮小 |
| Shift + ホイール、横スクロール | 左右に移動 |
| 上のミニバー | 枠をドラッグで移動、枠の端で幅を変更、枠の外をクリックでそこへ移動 |
| `+` / `-` / `0` キー、ボタン | 現在のティックを中心に拡大 / 縮小 / 全期間 |

再生やキー操作で現在のティックが表示範囲の外に出ると、範囲が自動でずれて追いかける。

### 目標分布との比較

refill（無ければ initMap）のルールが目標分布（`target`）を使う実験では、toyWorld の rule-editor の refill プレビューと同じ見方で、実際のマップが目標にどれだけ近いかを表示する。目標分布は `meta.json` の `ruleFile.artifacts` から、補充の記録は `events.jsonl` から読む。

| 表示 | 範囲 | 内容 |
|---|---|---|
| 時系列「目標とのズレ（L1）」 | 全期間 | ティックごとの L1 と、偶然でも出る L1 の目安（95%、点線） |
| 選択中ティックの分布 | 再生中のティック | ID ごとの割合（棒）、目標（黒線）、2項分布の ±2σ（帯）。帯の外は橙 |
| 個数の分布 | 集計の範囲 | 選んだ ID（5 個まで）の個数のヒストグラムと 2項分布 B(M, p*) |
| 補充されたブロック | 集計の範囲 | ID ごとの補充回数、目標どおりの期待 n·p*、mixedRefill の確率をそのときのマップから計算し直した期待（推定） |
| 補充の集計 | 集計の範囲 | 補充回数（get / fusion）、同じ ID が出た割合、補充以外のマスの変化、L1 の平均・最大、目安を超えたティックの割合 |

目標分布を使わないルール（`randomRefill` など）の実験では、補充の集計だけを出す。`events.jsonl` が無い古いログでは補充の回数は出ない。

実験中のログを見るときは「再読み込み」を押すと追記分が反映される（サーバは `world.jsonl` の更新時刻とサイズが変わったら読み直す）。URL の `#exp_…` で実験を直接開ける。

## API

| メソッド | パス | 返すもの |
|---|---|---|
| GET | `/api/experiments` | 実験の一覧（`ExperimentListResponse`） |
| GET | `/api/experiments/:id` | 組み立て済みの実験（`Experiment`）。全ティックのマップとプレイヤー系列、補充の記録、目標分布との比較（`dist`） |
| GET | `/api/experiments/:id/stats?from=&to=` | ティック範囲の集計（`StatsResponse`）。`from`/`to` は 0 始まり、両端含む。補充と分布の集計は `refill` |

型は `packages/shared/src/api.ts`。レスポンスは gzip 圧縮される。

## 構成

```
packages/
├── shared/src/
│   ├── game.ts        # toyWorld のログ形式（meta.json / world.jsonl / player_*.jsonl）
│   ├── constants.ts   # 方向ベクトル、行動グループ、状況の分類
│   └── api.ts         # API のリクエスト/レスポンス型
├── server/src/
│   ├── index.ts       # Express、静的配信、エラーハンドラ
│   ├── config.ts      # 環境変数
│   ├── routes.ts      # /api のルーティング
│   └── logs/
│       ├── reader.ts  # フォルダ列挙、ファイル読み込み、ID 検証
│       ├── build.ts   # ログ → ティックごとの系列、空振り判定
│       ├── view.ts    # 視界の再計算（toyWorld の view.ts と同じ規則）
│       ├── stats.ts   # 範囲集計
│       ├── distribution.ts # 目標分布との比較、補充の集計
│       └── store.ts   # 組み立て済み実験のキャッシュ
└── frontend/src/
    ├── main.ts        # 初期化、再生制御、イベント
    ├── api.ts         # API クライアント
    ├── state.ts       # 画面の状態
    └── views/         # meta / map / players / charts / stats / dist
```

## ログの解釈

- 各ティックの表示は「そのティックで行動を適用する直前の状態」と「そこで選ばれた行動」。toyWorld の `tick.ts` がログを書いてから `applyAction` するため。
- 死亡 = `Ltime` が 0 になったティック。
- `events.jsonl` の `tick` は toyWorld の `world.tick`（1 始まり）。`tick = k` の補充は `world.jsonl` の行 k − 1 で選ばれた行動で起き、行 k のマップに現れる。ビューアでは行動のティック（k − 1）に数える。
- `player_{uid}.jsonl` の k 行目は、そのプレイヤーが `world.jsonl` に最初に現れたティック + k として対応づける。位置が合わない行は、視界をマップから再計算する。
- **空振り**は、行動の前提条件を満たしていないもの（手ぶらで `eat`、正面が空きで `get` など）。`action.ts` の分岐から判定している。同じティックに他のプレイヤーが先に動いた場合はずれることがあるので、推定値として扱う。

## 制限

- 実験全体をメモリに載せて一度に返す。マップが大きく長い実験（例: 50×50 × 1万ティック）だとレスポンスが重くなるので、そのときはマップをティック範囲ごとに取る API に分ける必要がある。
