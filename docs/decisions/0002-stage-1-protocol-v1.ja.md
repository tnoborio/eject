# ADR 0002: Stage 1プロトコルv1

[English](0002-stage-1-protocol-v1.md)

- **Status:** Accepted
- **Date:** 2026-07-18

## コンテキスト

Windows実機検証はテスト用ハードウェア待ちです。それでも、EJECTの単一能力、同意境界、
replay耐性、正直な結果、国際化規則を維持する閉じた契約を共有できれば、制御面とagentの
開発は進められます。

ハードウェアの不確実性を、protocolから汎用リモート実行へ逃げる理由にしてはいけません。
また、serverがresponseを書いたこと、agentがコマンドを受信したこと、物理結果を区別する
必要があります。

## 決定

1. protocol v1を、`protocol/v1`配下のtransport非依存なJSON Schema Draft 2020-12契約と
   して定義する。
2. 閉じたmessage kindとして`COMMAND`、`AGENT_RESULT`、`LIFECYCLE_EVENT`の3種類だけを
   受理する。未知のfieldとprotocol versionは拒否する。
3. `OPTICAL_DRIVE_EJECT`だけを受理する。ローカルドライブID、デバイスパス、実行ファイル、
   shell文字列、IO control code、script、翻訳済み文章、実行可能URLを含めない。
4. 登録済み端末1台をUUIDで宛先指定する。コマンドはグローバルに一意なUUID、最大
   millisecond精度のUTC timestamp、正かつ最大60秒の有効時間、未来方向に最大30秒の
   clock skewを持つ。
5. 対象コマンドIDをローカル試行前、または試行とatomicに消費して永続化する。保存済み結果の
   配信は再試行してよいが、物理操作は再試行しない。消費済みIDを再起動後も24時間以上保持
   する。
6. 拒否では試行0回、ローカル試行では正確に1回と報告する。protocol v1の試行済み物理結果は
   `UNKNOWN`に固定し、`OPENED` lifecycle stateを持たない。
7. `DISPATCHED`はresponseへの格納、`DELIVERED`はagentが証明した受信とする。server拒否、
   ローカル拒否、cancel、ローカル失敗、期限切れ、物理結果不明には限定された理由を保持する。
8. 実行者表示名はescape対象の意味変数としてだけ運ぶ。通知文は受信者所有のlocale resource
   から描画する。
9. 認証・暗号化済みoutbound transportを必須とし、具体的なdevice credentialとmessage
   integrity方式は、enrollment完了前の集中的なsecurity decisionまで保留する。

## 結果

- transport endpointや認証providerを選ぶ前に、制御面、Windows polling agent、将来のWeb
  UIがlifecycleの意味を共有できる。
- Schema検証だけではtimestamp順序、最大有効時間、宛先、replay、遷移を検証できないため、
  reference validatorとテストで追加要件を定義する。
- crashやnetwork障害後に結果uploadをidempotentに再試行でき、機械的試行は増えない。
- 物理結果が不明なままでも、protocol v1で二者間の要求と応答を正直に実演できる。
- 将来、物理成功を主張したり新しいcommand能力を追加したりする場合、明示的なprotocol
  versionと証拠に基づく決定が必要になる。
