# アーキテクチャ方針

[English](ARCHITECTURE.md)

この文書は最終的な技術スタックではなく、境界と不変条件を定義します。実装技術を
交換しても、同意、能力最小化、正直な結果表示、国際化を弱めない構造にします。

## システム構成

```text
送信者のWebクライアント
        |
        | 認証済みeject要求
        v
EJECTコントロールプレーン
  - IDと関係
  - 受信者の権限
  - クールダウンとおやすみ時間
  - 命令発行
        |
        | 短寿命・一回限りの命令
        v
受信者のデスクトップアプリからの外向き接続
        |
        | プラットフォームアダプター
        v
ローカルで許可済みの光学ドライブ
```

デスクトップアプリ側から接続を開始します。外部向け待受ポートやルーター設定を
要求しません。

## Stage 1コントロールプレーンの形

Stage 1では、Vercel Node.js runtime上の一つのTypeScript・Next.js modular monolithを
使います。Web UI、person向けHTTP、将来のagent向けHTTPを、初期は一つのdeploymentに
置きますが、実装へ任意に相互アクセスさせません。

```text
Next.js transport・UI
        |
        v
Application use case
        |
        v
Framework非依存domain
        ^
        |
Infrastructureがapplication所有portを実装
```

コードは技術layerより先にproduct capabilityで分け、`identity`、`permissions`、
`devices`、`eject`、保留中の`entitlements`境界を置きます。domain codeはNext.js、React、
Vercel、PostgreSQL、ORM、protocol wire objectに依存しません。composition rootが
infrastructureをapplication portへ接続します。

採用済みの同意、participation、exposure境界は
[ADR 0003](decisions/0003-control-plane-consent-and-exposure.ja.md)に記録しています。
`control-plane/migrations`下の順序付きforward-only SQL fileをschemaの正本とします。
checksum ledgerとPostgreSQL advisory lockにより、migration適用を再現可能かつ直列にします。
runtime repositoryではKyselyと`node-postgres`を使い、infrastructure内に閉じ込めます。詳細は
[ADR 0004](decisions/0004-control-plane-schema-and-contract-sharing.ja.md)を参照してください。
person identityにはSupabase Authを使い、各Windows deviceには分離されたnon-exportableなCNG
ECDSA P-256 keyを持たせます。認証済みoutbound requestと署名済みserver responseは、正確なbody
bytesとreplay-resistant nonceへbindします。詳細は
[ADR 0005](decisions/0005-identity-and-device-security.ja.md)を参照してください。
既存accountはdigestだけを保存する10分・1回限りのcodeで非公開relationshipを確立します。この操作は
方向付きpermissionやaccount検索を作りません。詳細は
[ADR 0006](decisions/0006-invite-only-relationships.ja.md)を参照してください。

Windows adapterは、そのdevice-key境界をcurrent-user scopeで永続化するCNG ECDSA P-256 keyとして
実装します。Microsoft Platform Crypto Providerを優先し、Microsoft Software Key Storage Providerだけへ
fallbackし、export policyなしのsigning用途を要求します。machine scopeなど要件外の保存keyを拒否し、
DER SubjectPublicKeyInfoだけをexportして、固定64-byte IEEE P1363 signatureを生成します。このadapterは
enrollment・pollingへ未接続で、hosted Windows CIは実機standard-user検証の代替ではありません。

server管理のperson-auth境界には、既存user向けemail magic-link開始、PKCE callback交換、email OTP検証、
refresh rotation、local-session logoutの固定routeがあります。S256 verifier・state cookieを生成し、
access・refresh materialを分離したSecure、HttpOnly、SameSite cookieへ保存し、任意redirect targetを拒否して、
providerが発行したaccess JWTをcookieへ設定する前に再検証します。person authはprovider設定を初期化する前の
独立gateでdefault disabledです。

control planeにはagent enrollment・poll・result用の固定Node.js POST routeと、person認証済みの
device-enrollment作成・revocation routeがあります。さらに、ownerへbindした受信者同意のreadと、
pauseおよび既存のactive relationshipへの方向付きgrant mutationを持ちます。pauseまたはgrant revokeは
issuanceと同じrecipient lockで直列化し、影響する`QUEUED`または未確認の`DISPATCHED` commandをatomicに
取り消します。分離した認証済みrouteが1回限りのrelationship codeを作成・消費します。このrouteが
作成するのはrelationshipだけで、accountは検索可能になりません。enrollment作成は
独立したgateでdefault disabledとなり、databaseやperson authの初期化前に停止します。poll・result
deliveryは別のenvironment gateを維持し、commandを返すには独立したdatabase global-delivery gateも
trueである必要があります。person向けpublic eject endpointはなく、Windows agentもまだ接続していません。

protocol v1は`protocol/v1`配下の正本のまま、private workspace package
`@eject/protocol-contract`として利用します。そのvalidator・schemaをimportするのはtransport
adapterだけです。検証済みwire値を明示的なmapperへ通し、application・domain codeはprotocol
wire objectをimportしません。

## Control-planeのverification

control-planeの変更は、merge前に四つのblocking CI layerを通します。

1. format、lint、TypeScript、依存方向rule、Next.js production build。
2. pure policyに対するVitest unit testとfast-check property test。
3. ephemeralな実PostgreSQLに対するmigration・repository integration test。
4. transaction raceとidempotencyに対する、barrierで制御した決定論的な複数connection test。

重要なpure authorization、lifecycle、exposure、fingerprint、eject-back logicにはbranch coverage
100%を要求します。repository全体のcoverage自体を目的にしません。定期的なmutation testingで
これらの重要testを試しますが、最初はpull request blockerではなくadvisoryにします。
persistence、locking、constraintの保証をdatabase mockだけで受け入れません。

依存ruleにより、domainからNext.js、React、Kysely、`pg`、infrastructure、protocol wire typeの
importを禁止し、application codeからtransport・infrastructure implementationのimportを禁止
します。CIはsynthetic data、最小permission、完全なSHAへ固定したActionだけを使い、production
credentialを持ち込みません。詳細は
[ADR 0003](decisions/0003-control-plane-consent-and-exposure.ja.md)を参照してください。

## コンポーネント

### Webクライアント

- アカウント作成と認証。
- 招待と関係管理。
- 権限管理。
- プライバシーを守った粒度の利用可能状態。
- 一つのEJECT操作とEJECTし返す操作。
- ローカライズされた要求・結果表示。

### コントロールプレーン

- 人と登録端末の認証。
- 受信者が管理するポリシーの評価。
- クールダウンと不正利用制限。
- 署名などで完全性を保護した短寿命命令の作成。
- 対象端末への命令配信。
- 最小限の状態遷移と結果の記録。
- 英文ではなく、機械可読なイベントコードの出力。

### デスクトップアプリ

- person sessionではなく、保護された端末ごとのkeyで一台の登録端末として認証。
- 安全な外向き接続またはポーリングの維持。
- 対応光学ドライブのローカル検出。
- 所有者によるドライブ許可。
- 命令の完全性、対象、有効期限、一意性の検証。
- 許可した一つの操作だけをプラットフォームアダプターへ渡す。
- 制限された結果コードの報告。
- ローカライズしたネイティブ通知と一時停止操作の提供。

agentは固定pathのHTTPS requestごとにtimestamp、random nonce、正確なbody hashを署名します。
閉じたtransport wrapperとprotocol v1 messageをparseする前に、そのrequestへbindされたresponse
signatureを検証します。PostgreSQLはrequestごとにdevice・key revocationを確認し、replay nonceを
限定期間消費します。これらのauthentication手順はadapterの一つのphysical capabilityを広げません。

### プラットフォームアダプター

意図的に小さな内部インターフェースだけを公開します。

```text
discover_optical_drives() -> DriveCapability[]
eject(approved_drive_id) -> EjectResult
```

汎用コマンド実行、任意デバイスパス、ファイルアクセス、ディスク読み取り、任意の
DeviceIoControl/IOKit呼び出しは公開しません。

## 認可と受信者exposure

pureなdomain policyが、application use caseから渡された最新の事実を使って要求を評価
します。account restriction、受信者のaudience・sender-eligibility設定、必要な場合の
relationshipとdirectional grant、block、pause、quiet hours、cooldown、limit、device
eligibility、revocationを評価します。要求時の拒否と、認可済みcommandの取消は分けます。

受信者accessには二つの独立した軸があります。

```text
audience: NAMED | CONNECTED | ALL_AUTHENTICATED
sender eligibility: READY_PARTICIPANTS_ONLY | AUTHENTICATED_ACCOUNTS
```

defaultは、指定されたready participantです。匿名actorは含めません。discoverabilityと
eject permissionは別にします。blockまたはsafety controlは、広いscopeより常に優先します。

将来のsubscriptionは、受信者が選択できるinbound exposure ceilingだけを引き上げられます。
senderへ追加の作用権を与えません。有効なinbound limitは、受信者が選んだlimit、plan
entitlement、証拠に基づくphysical safety ceilingの最小値です。billing vendorはentitlement
portの後ろに置き、Stage 1 domain skeletonの対象外にします。

## 命令のライフサイクル

protocol v1は、次の事実に基づくlifecycleを使います。wire形式とfield間規則の正本は
`protocol/v1/README.ja.md`です。

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

`DISPATCHED`は、serverがresponseへコマンドを入れたことだけを意味します。
`DELIVERED`には認証済みagentの報告が必要です。各遷移はtimestampと機械可読な理由コードを
持ちます。protocol v1に`OPENED`状態はなく、ハードウェアが動作の信頼できる証拠を提供できる
まで、試行済みの物理結果は常に`UNKNOWN`です。

## 命令エンベロープの例

```json
{
  "protocol_version": 1,
  "kind": "COMMAND",
  "command_id": "018f47a0-7b2c-7c9d-8e1f-0123456789ab",
  "type": "OPTICAL_DRIVE_EJECT",
  "device_id": "018f47a0-7b2c-7c9d-8e1f-1123456789ab",
  "actor": {
    "person_id": "018f47a0-7b2c-7c9d-8e1f-2123456789ab",
    "display_name": "Kaz"
  },
  "issued_at": "2026-07-18T05:00:00Z",
  "expires_at": "2026-07-18T05:00:30Z"
}
```

サーバーはドライブパス、シェル文字列、実行ファイル名、翻訳済みメッセージを送り
ません。アプリが許可済みのローカルドライブを解決し、受信端末上でイベントを翻訳
します。

## 最小データモデル

- `person`: ID、表示名、言語、アカウント状態。
- `relationship`: 二人と関係状態。
- `eject_permission`: 許可者、被許可者、ポリシー、状態。
- `participation`: account-only、setup、ready、revokedの粗いeligibility。
- `recipient_access_policy`: audience、sender eligibility、pause、limit。
- `device`: 所有者、公開鍵または認証情報参照、OS、最終接続の粗い分類。
- `drive_capability`: 不透明なローカル結合と粗い能力状態。
- `eject_event`: 実行者、受信者、端末、状態、限定された理由コード。
- `entitlement`: 受信者のinbound ceilingへの交換可能な参照。
- `revocation`: 無効化された端末または認証情報と有効時刻。

メディア名、ディスク内容、ファイル一覧、任意のハードウェア一覧、運用上不要なIP
履歴、部屋の状況は保存しません。

## Windows方針

最初の実装対象です。ネイティブアダプターが光学ドライブを列挙し、所有者が許可した
ドライブを不透明なIDに結び、ハードウェアが対応する場合は
`IOCTL_STORAGE_EJECT_MEDIA`などのサポートされたデバイス制御を使用します。

最初のハードウェア検証では、空のトレイ、メディア挿入時、使用中、複数ドライブ、
内蔵SATA、外付けUSB、トレイレス、標準ユーザー権限を試します。その結果に基づき、
正確な能力契約を決めます。

一般配布時にはコード署名し、明示的な自動起動設定と完全なアンインストールを持つ、
信頼できるインストーラーで配布します。

## macOS方針

実験的な第二アダプターです。Disk Arbitrationには`DADiskEject`がありますが、API上の
ejectがEJECTの中心となる目に見えるトレイ動作を保証するわけではありません。現行Mac
では外付け、特にスロットローディング式の光学ドライブが中心です。

対応を表明する前に次を検証します。

- トレイ式外付け光学ドライブ。
- 空のドライブとメディア挿入済みの両方。
- Disk Arbitrationと、空トレイに別の光学ドライブ固有手段が必要か。
- App Sandbox、権限、署名、公証の制約。
- 論理的なメディア排出と物理的なトレイ開放の違い。

共有プロトコルはmacOSを妨げないものにしますが、最初のWindowsアプリを早すぎる
クロスプラットフォーム抽象化で弱めません。

## 技術選定基準

実装開始時は次を満たす技術を優先します。

- 信頼できるネイティブデバイスAPI。
- 小さく監査可能なアプリバイナリ。
- 分かりやすいコード署名と更新。
- 成熟した国際化機構。
- 型のある通信契約と限定されたエラーコード。
- 小規模な非公開アルファ向けの簡単なデプロイ。
- プロダクトの意味を変えずにリアルタイム通信を交換できること。

フレームワークの人気自体は、アーキテクチャ要件ではありません。
