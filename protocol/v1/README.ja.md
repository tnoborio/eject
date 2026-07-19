# EJECTプロトコルv1

[English](README.md)

このディレクトリは、EJECT制御面とWindows agent間の、transportに依存しない意味契約を
定義します。wire形式ではJSON Schemaが正本です。この文書は、JSON Schemaだけでは表現
できないfield間検証と状態遷移を定義します。

Stage 0のハードウェア挙動は未検証です。そのためプロトコルv1では、agentは固定された
1回の試行を報告できますが、トレイが物理的に開いたとは決して報告できません。

## メッセージ

`eject-protocol.schema.json`が受理するmessage kindは、正確に次の3種類だけです。

- `COMMAND`: 1台の端末に対する、短命な`OPTICAL_DRIVE_EJECT`命令1件
- `AGENT_RESULT`: 限定された拒否、または正確に1回のローカル試行結果
- `LIFECYCLE_EVENT`: 限定された理由コードを伴う、事実に基づく制御面の状態遷移

すべてのobjectは`additionalProperties: false`で閉じています。未知のcommand type、
ドライブパス、実行ファイル名、shell文字列、翻訳済み文章、物理成功の主張、その他の追加
fieldは不正です。

## コマンド契約

コマンドが持つのは次だけです。

- protocol version `1`とkind `COMMAND`
- グローバルに一意なcanonical lowercase UUID command ID 1件
- 単一のtype `OPTICAL_DRIVE_EJECT`
- 対象となる登録済み端末のcanonical lowercase UUID
- 通知用の意味変数としての実行者UUIDと表示名
- 最大millisecond精度のUTC `issued_at`と`expires_at`

コマンドには、許可済みローカルドライブIDを含めません。agentはmessage検証後にだけ、
ローカルで許可したbindingを解決します。

serverは、正の有効時間かつ最大60秒のコマンドを発行する必要があります。agentは、
ローカル時刻が`expires_at`以降の場合、または`issued_at`が30秒を超えて未来の場合に
拒否します。このclock skew許容は`expires_at`を延長しません。

## 宛先、一意性、1回の試行

agentは次の順序で検証します。

1. 閉じたSchemaとprotocol version
2. 端末宛先の完全一致
3. timestampの順序、最大有効時間、期限、未来方向のskew
4. command IDの一意性
5. ローカルpauseと許可済みドライブ状態
6. 固定された1種類の光学ドライブeject能力

構造が正しく、期限内で、この端末宛てのコマンドについて、agentは物理試行を始める前、
または開始とatomicに、command IDと最終結果を永続記録します。pauseと許可済みドライブなし
による拒否もIDを消費します。crashや結果upload失敗では、保存済みの同じ`AGENT_RESULT`を
再送できますが、adapterを2回目に呼んではいけません。

serverも`command_id`をidempotency keyとして扱い、再利用しません。本番のreplay storeは
agent再起動後も維持し、protocolの最大有効時間より十分長い24時間以上、消費済みIDを保持
する必要があります。

## agent結果

拒否したコマンドは次を報告します。

- `disposition: REJECTED`
- `attempt_count: 0`
- 限定された拒否理由1件
- `physical_outcome: NOT_ATTEMPTED`

ローカル試行は次を報告します。

- `disposition: ATTEMPTED`
- `attempt_count: 1`
- 限定されたadapter結果1件
- `physical_outcome: UNKNOWN`

`COMMAND_ACCEPTED`は、固定されたWindows呼び出しが成功を返したことだけを意味します。
`OPENED`は許可しません。native error番号はローカル診断に留め、protocol v1には含めません。

制御面は、`command_id`が認証済み`device_id`に属する場合だけ結果を受理し、idempotentに
upsertします。`recorded_at`は端末の観測timestampであり、期限延長やserver所有lifecycle
eventの並べ替えに使うauthorityではありません。server受信時刻をaudit境界とします。

## ライフサイクル

`DISPATCHED`は、制御面がoutbound responseにコマンドを入れたことを意味します。配信の証拠
ではありません。`DELIVERED`は、認証済みagentの報告によって、agentがコマンドを受信した
と証明できた場合だけ記録します。

```text
REQUESTED
  -> REJECTED | AUTHORIZED
AUTHORIZED
  -> QUEUED | CANCELLED
QUEUED
  -> DISPATCHED | EXPIRED | CANCELLED
DISPATCHED
  -> DISPATCHED | DELIVERED | EXPIRED | CANCELLED
DELIVERED
  -> REJECTED_BY_AGENT | ATTEMPTED
ATTEMPTED
  -> FAILED | OUTCOME_UNKNOWN
```

終端状態から先への遷移はありません。protocol v1に`OPENED`状態はありません。将来のversionで
追加できるのは、定義済みのハードウェアclassが物理動作の信頼できるローカル証拠を提供できる
ようになった場合だけです。

lifecycle eventのtimestampは制御面が生成し、1コマンド内で過去方向へ移動してはいけません。
agent提供timestampは、この正本となる遷移時刻とは分けて保存します。

## transportとintegrity境界

Schemaにはcredential、実行ファイルURL、transport命令を含めません。messageはagentが
開始する、認証・暗号化済みoutbound接続を使う必要があります。agentは、認証済み制御面の
identityと自身のdevice credentialを`device_id`宛先検証に結びつけます。

具体的なdevice credential、message integrity方式、revocation確認、polling endpointは、
集中的なsecurity decisionまで意図的に保留します。enrollment完了前に決定する必要があり、
このSchemaへ任意fieldを追加することは代替になりません。

## 国際化とプライバシー

実行者の表示名は意味変数であり、作成済み文章ではありません。受信側agentがescapeし、
locale resource keyをローカルで描画します。送信者が受信者の言語を選ぶことはありません。

protocol payloadは、メディア名、ディスク内容、デバイスパス、ハードウェア一覧、
コンピューター名、native error番号、自由記述noteを除外します。通常ログへraw payloadを
書いてはいけません。

## 検証

リポジトリrootから次を実行します。

```sh
npm ci --prefix protocol
npm test --prefix protocol
```

テストは、受理・拒否fixture、端末宛先の完全一致、60秒の有効時間、未来方向のskew、
replay消費、pauseとドライブ許可、1回だけの試行報告、lifecycle遷移を検証します。
