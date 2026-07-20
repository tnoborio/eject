# ADR 0003: コントロールプレーン、同意、exposure

[English](0003-control-plane-consent-and-exposure.md)

- **状態:** 採用
- **日付:** 2026-07-20

## 背景

protocol v1はwire上の能力を、一つの短寿命な光学ドライブeject命令に固定しています。
一方、Stage 1コントロールプレーンの配置、受信者同意の評価方法、送信資格、将来の
subscriptionと物理的中断の関係は決めていません。

EJECTは、方向付き同意と受信者の管理権を守りながら、通常のIoT utility以上のものとして
読める必要があります。真面目なidentity、policy、billing、lifecycle、native deviceの
仕組みを、ほとんど役に立たない一つの物理現象のために用意する意図的な過剰さ自体が、
作品の一部です。subscriptionがこの読みを強められるのは、受信者が選んだexposureを
形式化する場合だけです。他人に対する作用権を販売してはいけません。

Stage 0のハードウェア上の事実は未確定です。このdecisionは、トレイが開いたという主張、
機械的に安全な頻度の決定、device enrollment securityの完了を許可しません。

## 決定

### Stage 1の配置とmodule境界

1. Stage 1のWeb clientとcontrol planeを、Vercel Node.js runtime上のTypeScript・Next.js
   modular monolithとして構築する。
2. Web UI、person向けHTTP、将来のagent向けHTTPを、初期は一つのdeploymentに置く。
   domain skeletonではpublic eject endpointを公開しない。
3. コードはproduct capabilityを先にして、`identity`、`permissions`、`devices`、
   `eject`、保留中の`entitlements`境界に分ける。各module内ではtransportからapplication、
   applicationからdomainへ依存させる。
4. domain codeはNext.js、React、Vercel、PostgreSQL、ORM、protocol wire objectをimport
   しない。infrastructureがapplication所有のportを実装し、composition rootで組み立てる。
5. person sessionとdevice credentialを分離する。device enrollment、authenticated polling、
   credential保存、message integrity、revocation lookupは、集中的なsecurity decisionまで
   保留する。

### 認可と取消

6. 新しいeject要求をpureなdomain policyで評価する。application use caseが最新の事実を
   読み、明示的なserver時刻を渡し、閉じたauthorizedまたはrejected結果を受け取る。
   通常の拒否をexceptionにしない。
7. 認可では、actor状態、必要な場合のrelationshipとgrant、受信者access policy、block、
   pause、quiet hours、cooldown、sender・recipient limit、device eligibility、revocationを
   評価する。
8. 要求時の認可と、認可済みcommandの取消を分ける。要求時にpermissionがなければ
   `PERMISSION_REQUIRED`とし、その後のpermission、device、global deliveryの変更では、
   protocol v1の取消理由を使って未完了commandを取り消す。
9. 認可済みcommandをtransaction内で`QUEUED`として保存したcontrol-plane時刻から、
   recipient全体のcooldownを開始する。配信失敗を、即時の機械的再試行の理由にしない。
10. 個別block、account restriction、pause、revocation、緊急停止、物理安全上限は、広い
    access設定や有料entitlementより常に優先する。

authorization stateのread、pure policy評価、command・lifecycle作成、cooldown開始、rate-limit
消費、exposure消費を、一つの短いPostgreSQL transactionにする。agent deliveryとidentity、
billing、notification、analytics serviceの呼び出しは、commit後だけに行う。拒否要求では、
限定された`REQUESTED`から`REJECTED`へのlifecycleだけをtransaction内に記録でき、配信可能な
commandを作らない。

issuanceとrevocation transactionを、PostgreSQLの`SERIALIZABLE` isolationで実行する。両方とも、
consent stateを評価・変更する前に、recipientごとの一つの`recipient_eject_state`行を
`FOR UPDATE`でlockする。serialization failureとdeadlockはapplicationでbounded retryし、
defaultの最大試行回数を3回とする。上限到達はrecipientによる拒否ではなく一時的なserver
failureであり、commandもquota消費も残さない。command・event identifierの最終的な一意性は
database unique constraintで保証する。外部distributed lockを追加しない。

意図的なperson actionごとに、client生成UUID idempotency keyを付ける。databaseでは
`(actor_id, idempotency_key)`を、canonicalなsemantic request fingerprintと、commit済みの
rejectionまたはcommand resultへ一意に結びつける。同じretryには、再認可や追加quota消費を
せず、保存済みの同じ結果を返す。別recipient、action、eject-back sourceへ同じkeyを再利用
した場合はconflictとし、何も作らない。限定されたrecordを最低24時間保持し、raw HTTP payloadや
credentialを保存しない。commit結果が不明な場合、再発行前に同じkeyをlookupする。

一回限りのeject backは、独立したuniqueな`reply_to_command_id` consumption constraintでも
保護する。agent result ingestionはprotocol v1に従い、`(device_id, command_id)`へ結びついた
idempotent upsertのままにする。client button状態を、これらの保証の根拠にしない。

runtimeのPostgreSQL accessには、Kyselyと`node-postgres` driverを使う。これはtype-safeなSQL
query builderであり、domain modelやfull object graph ORMではない。Kyselyのtypeとtransaction
objectはinfrastructure repository implementation内に閉じ込め、application所有portはdomain
形状の値だけを公開する。`SERIALIZABLE`、`FOR UPDATE`、constraint、PostgreSQL固有動作を
repository code上で明示する。Stage 1 runtime pathへPrisma、Drizzle、provider固有database SDKを
追加しない。

正確なPostgreSQL schemaとmigrationの正本は、後続のarchitecture decisionとして残す。
transaction、isolation、locking、idempotency、runtime query tool、verification境界はこの
decisionで確定する。

### Control-planeのverification境界

control-planeのpull requestには、四つのblocking verification layerを設ける。

- format、lint、TypeScript、Next.js production build、循環依存検出、transportから
  application、applicationからdomainへの方向を守る実行可能な依存規則を含むstatic・
  production-build check。
- pure authorization、lifecycle transition、exposure計算、idempotency fingerprintに対する
  Vitest unit testとfast-check property test。
- 空databaseからのmigration、repository動作、constraint、rollback、isolation、lockingを
  含む、ephemeralな実PostgreSQL serviceに対するintegration test。
- timing sleepではなくbarrierでtransaction順序を制御する、複数connectionの決定論的な
  concurrency test。

persistence invariantをmock databaseで証明したことにしない。concurrency testでは最低限、
最後のexposure枠の競合、同じidempotency requestの同時実行、issuanceとrevocationの競合、
一回限りのeject-back消費、bounded serialization retry、失敗後にcommand・quotaの部分状態が
残らないことを扱う。競合testの失敗を、通るまで繰り返してgreenにしない。再現可能な実行順序と
property testのseedを報告する。

小さく重要なpure-policy surfaceであるauthorization、lifecycle transition、有効exposure、
idempotency fingerprint、eject-back eligibilityには、branch coverage 100%を要求する。
価値の低いtestを増やすだけのrepository全体coverage数値は課さない。これらの重要surfaceへ
定期的なStryker mutation testingを追加し、所要時間と安定したthresholdを測定するまでは
advisoryとする。

CIではsynthetic identityとephemeral databaseだけを使い、production credentialやprivate event
dataを持ち込まず、workflow permissionを最小化し、third-party Actionを完全なcommit SHAへ固定
する。PostgreSQL major versionはproduction provider選定後に同じversionへ固定し、このdecisionで
先回りして推測しない。

### 受信者が作成するaccess

11. 受信者が所有する二つの独立したpolicy軸をmodel化する。

    - audience scope: `NAMED`、`CONNECTED`、`ALL_AUTHENTICATED`。
    - sender eligibility: `READY_PARTICIPANTS_ONLY`または
      `AUTHENTICATED_ACCOUNTS`。

12. `NAMED`と`READY_PARTICIPANTS_ONLY`の組み合わせをdefaultにする。`NAMED`では、active
    relationshipと、recipientからactorへのactive directional grantを要求する。
    `CONNECTED`ではactive relationshipを要求する。`ALL_AUTHENTICATED`に匿名actorを含めない。
13. blockはscopeより常に優先する。ejectを受け入れる設定によって、そのpersonを検索・一覧
    表示可能にしない。discoverabilityとeject accessを別policyにする。
14. Stage 1で公開するのは狭いdefaultだけとする。より広いconnected・authenticated scopeは、
    受信者の明示的opt-inと、段階的なabuse reviewを経てから公開する。

### Account、participant、eject back

15. accountだけでは参加資格を示さない。`ACCOUNT_ONLY`、`SETUP_IN_PROGRESS`、
    `PARTICIPATION_READY`、`REVOKED`などの粗いparticipation状態を、短期的な`AVAILABLE`、
    `PAUSED`、`OFFLINE` availabilityと分けてmodel化する。
16. `PARTICIPATION_READY`は、認証済みagentに許可済みlocal driveがあり、所有者がlocal setup
    testを完了したことを意味する。これは限定された本人確認済みeligibility factであり、
    トレイが開いたというremote proofでもhardware attestationでもない。
17. defaultのsender eligibilityでは、readyかつavailableなparticipantを要求する。受信者は、
    受信可能なEJECT setupを持たない認証済みaccount holderからのejectを、意図的に許可できる。
    その場合、UIはeject backできない可能性を正直に表示する。
18. ejectの送信は、recipientがactorに対して使える、短寿命・一回限りのeject-back認可への
    明示的同意を作る。恒久的な相互grantは作らない。pause、revocation、expiry、cooldown、
    safety controlは引き続き優先する。

### Exposure契約としてのsubscription

19. 将来のsubscriptionは、契約のrecipient側に属する。受信者が選択できるinbound exposureの
    最大値を引き上げられるが、senderが他人へ作用できる範囲を広げてはいけない。
20. 三つの関心事を分離する。

    - access policyは、**誰が**recipientをejectできるかを決める。
    - exposure policyは、recipientが**どの頻度まで**受け入れるかを決める。
    - entitlementは、現在のplanが許すexposure上限を決める。

21. 有効なinbound limitを、recipientが選んだlimit、plan entitlement ceiling、証拠に基づく
    physical safety ceilingの最小値として計算する。
22. 高いplanがaccess scopeを自動変更することはない。pause、block、revoke、account deletion、
    安全側の最低限のcontrolは、支払い状態にかかわらず利用可能にする。
23. domain authorizationは有効なentitlementを受け取り、billing vendor、商品plan名、価格に
    依存しない。billing integrationは交換可能なentitlement portを実装する。
24. 実機証拠によって説明可能なsafety ceilingが確立するまで、plan価格、頻度数値、unlimited
    tierを設定しない。billingとpublic monetizationはStage 1 domain skeleton PRの対象外にする。

## 帰結

- 最初のcontrol-plane実装では、authentication、billing、device-enrollment vendorを確定せず、
  consentとlifecycleをtestできる。
- private-by-defaultな方向付き同意を守りながら、将来、受信者がより広く意図的に非対称な
  参加条件を作れる。
- account-onlyのobserverは暗黙に物理的作用権を得ない。受信者が認証済みaccountを明示的に
  許可した場合だけ作用できる。
- subscriptionは作品の契約形式の一部になる。支払いは他人への権力ではなく、自分が選んだ
  「中断され得る容量」を拡張する。
- cooldownとplan使用量はcommand発行とatomicに更新する。schemaとmigration toolingは
  引き続き決める必要がある。
- control-planeの正しさを、pure・property test、実PostgreSQL、決定論的race test、実行可能な
  architecture rule、production buildで強制する。mutation testingで定期的にtest自体を試す。
- 広いaccessはabuse・privacy riskを増やす。actor単位・recipient単位limit、block、pause、
  revocation、非discoverability、緊急停止は必須のままにする。
- 既存の物理的不確実性は可視のままにする。participation readiness、command acceptance、
  agent attempt、目視したtray movementは異なる事実である。

## 不採用案

- senderに、他人のaccess policyを迂回する権利を販売する。
- 有料planを同意として扱う、またはrecipient scopeを自動的に広げる。
- 全登録accountをdefaultで送信可能にする。
- account作成、agent enrollment、Windows API成功を、物理トレイ動作の証拠として扱う。
- 境界のあるStage 1 domainが必要とする前に、generic policy engine、microservice分割、
  realtime serviceを導入する。
