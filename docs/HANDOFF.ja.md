# 実装ハンドオフ

[English](HANDOFF.md)

この文書は、新しいEJECT開発セッションの開始点です。実装済みの内容、検証済みの内容、
未確認事項、今後の作業順序を記録します。

## スナップショット

- **日付:** 2026-07-24
- **リポジトリ:** `tnoborio/eject`
- **現在のブランチ:** `agent/invite-only-relationships`
- **マージ済みPR:** [#2](https://github.com/tnoborio/eject/pull/2)(Stage 0スパイク)、
  [#3](https://github.com/tnoborio/eject/pull/3)(One Bitロゴ)、
  [#4](https://github.com/tnoborio/eject/pull/4)(ハードウェア検証キット)、
  [#5](https://github.com/tnoborio/eject/pull/5)(protocol v1)、
  [#6](https://github.com/tnoborio/eject/pull/6)(handoff更新)、
  [#7](https://github.com/tnoborio/eject/pull/7)(Kysely issuance)、
  [#8](https://github.com/tnoborio/eject/pull/8)(PostgreSQL race)、
  [#9](https://github.com/tnoborio/eject/pull/9)(mutation testing)、
  [#10](https://github.com/tnoborio/eject/pull/10)(identity・device security)、
  [#11](https://github.com/tnoborio/eject/pull/11)(認証済みagent polling)、
  [#12](https://github.com/tnoborio/eject/pull/12)(cloud database environment)、
  [#13](https://github.com/tnoborio/eject/pull/13)(person-session authentication)、
  [#14](https://github.com/tnoborio/eject/pull/14)(device enrollment・revocation)、
  [#15](https://github.com/tnoborio/eject/pull/15)(protected migration証拠)、
  [#16](https://github.com/tnoborio/eject/pull/16)(person PKCE session)、
  [#17](https://github.com/tnoborio/eject/pull/17)(protected Windows CNG device key)、
  [#18](https://github.com/tnoborio/eject/pull/18)(main CNG証拠更新)、
  [#19](https://github.com/tnoborio/eject/pull/19)(safe Web console・consent control)
- **現在の検証済み実装:** `main`上のPR #19、merge commit `40ef7d8`。現在のcheckoutには既存の
  sign-in済みaccount向けに、digestだけを保存する10分間・一回限りのrelationship invitationを追加。
  作成するのはrelationshipだけで、EJECT permission、account検索、物理commandは作らない。protected
  repository migration 4件はすべてprotected cloud databaseへ適用・checksum検証済み
- **`main`上の検証済みCI:** [Windows spike run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811)、
  [protocol contract run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249)、
  [control-plane run 29813234824](https://github.com/tnoborio/eject/actions/runs/29813234824)、
  [Windows CNG run 29899930269](https://github.com/tnoborio/eject/actions/runs/29899930269)
- **PR #12の検証済みCI:** [control-plane run 29839496511](https://github.com/tnoborio/eject/actions/runs/29839496511)
- **PR #13の検証済みCI:** [control-plane run 29895265935](https://github.com/tnoborio/eject/actions/runs/29895265935)、
  [protocol run 29895265928](https://github.com/tnoborio/eject/actions/runs/29895265928)
- **PR #14の検証済みCI:** [control-plane run 29896627535](https://github.com/tnoborio/eject/actions/runs/29896627535)
- **PR #16の検証済みCI:** [control-plane run 29898326094](https://github.com/tnoborio/eject/actions/runs/29898326094)
- **PR #17の検証済みCI:** [Windows run 29899184939](https://github.com/tnoborio/eject/actions/runs/29899184939)
- **PR #19の検証済みCI:** [control-plane run 30053578168](https://github.com/tnoborio/eject/actions/runs/30053578168)。
  merge前にActions 4 jobとVercel check 2件がすべて成功
- **現在のプロダクト段階:** Stage 0は物理証拠待ち。Stage 1 protocol、control-plane、
  identity・device-security architectureは採用済み。control planeは認証済みagent pollingとresult
  ingestionまで実装済み。person-session境界はSupabase asymmetric JWTを検証し、現在のEJECT
  account statusを再確認する。default-disabledのone-use device enrollmentとowner revocationは
  `main`へ実装済みで、default-disabledのserver管理PKCE cookie lifecycleも収載済み。
  protected Windows CNG device-key storeも実装済みだが、enrollment・pollingは未接続で、実機の
  standard-user証拠が引き続き必要。Sasaraの運用管理下に専用managed PostgreSQL環境とVercel projectも
  存在するが、すべてのgateでdeliveryは無効で、Windows agentは未接続。
  Windows統合より先にWeb体験を進めている。現在のcheckoutは英日serviceを表示し、既存の
  auth・device管理境界へformを接続するが、物理操作はすべて利用不可のままにする。ownerへbindした
  consent controlは受信accessをpauseするか、既存のactive relationship 1件をgrant/revokeする。
  pause・revokeはissuanceのrecipient lock下で、影響する未確認commandをatomicに取り消す。現在の
  checkoutは既存のsign-in済みaccount 2件をout-of-bandのone-use codeでrelationshipへ接続する。
  account検索は公開せず、EJECT permissionも付与しない。Supabase Authはpublic signupを拒否し、完全一致する
  public Production callbackだけを許可し、email code期限を10分に設定済み。
  `https://eject-bice.vercel.app`でperson authを有効化し、最初の招待accountをprovision
  済み。live refresh、account検証、owner-device一覧、logout lifecycleも検証済み。device enrollmentと
  両delivery gateは無効のまま。

## 現在の状態

リポジトリから、未署名かつ自己完結型のWindows x64コンソールアプリを生成できます。
このアプリはローカルの光学ドライブを検出し、ローカルで選択した不透明なドライブ識別子に
対して、固定されたeject処理を1回だけ試します。

現在のcheckoutにはresponsiveな英日Web consoleもあります。deployment capability stateを事実どおり
表示し、既存account向けmagic-link・OTP form、認証済みowner sessionの検出、そのownerだけのdevice
一覧、独立gateが有効な場合だけのone-use enrollment secret作成、owner device revocationを提供します。
EJECT controlは無効で、commandを送信しないと明示します。recipient pauseと方向付きgrant/revokeは、
認証済みownerと既存のactive relationshipだけに作用します。pause・revokeはconsent changeと同じ
transactionで、影響する`QUEUED`・未確認`DISPATCHED` commandをatomicに取り消します。
現在のcheckoutは、digestだけを保存する10分間・一回限りのcodeによる明示的なrelationship確立も
追加します。acceptしても方向付きgrantは作らず、account directory、検索、invitation delivery
channelも提供しません。

次の作業は完了しています。

- 初期実装スタックの決定
- .NET 10ソリューションと能力を限定したアダプター境界
- ディスク内容を読まない光学ドライブ検出
- 呼び出し側が指定するデバイスパスではなく、ローカル用の不透明なドライブ識別子
- 固定された1種類の`IOCTL_STORAGE_EJECT_MEDIA`操作
- 限定された意味結果コード
- プラットフォーム非依存のユニットテスト10件
- LinuxからWindowsへのクロス発行
- GitHubホステッドWindows上のネイティブビルドと検出スモークテスト
- 実行ファイルとチェックサムを含むworkflow artifact
- Stage 0文書の英語版と日本語版

リポジトリには、プライバシーを限定したWindowsハードウェア検証キットも含まれて
います。このキットは実行ファイルのチェックサムを検証し、意図的な物理安全確認を要求し、
再試行せず1回だけ実行し、API結果と人が目視した結果をschemaで制約したレポートに記録
します。このキットはまだ実際のWindows光学ドライブでは動かしておらず、それ自体で
Stage 0が完了するわけではありません。

Stage 1 protocol v1も、閉じたJSON Schema契約、reference validator、valid/invalid fixture、
11件の意味テスト、専用CI workflowとして実装済みです。端末宛先の完全一致、最大60秒の
有効時間、replay消費、1回の試行報告、`OPENED`を主張できない事実ベースのlifecycleを
定義しています。

ビジュアルアイデンティティはOne Bitを採用済みです。採用版アセットと利用上の注意は
`assets/logo/`に、検討過程は`assets/logo-concepts/`にあります。

Stage 1 control-planeのdeployment、module依存方向、pure authorization、recipientが作成する
access、participation eligibility、一回限りのeject back、recipient側subscription exposureは、
ADR 0003で採用済みです。atomicなcommand-issuance transaction、`SERIALIZABLE` isolation、
recipient row lock、bounded retryも確定しています。person request、一回限りのeject back、
agent resultのidempotencyは、それぞれ独立して確定しています。infrastructure repositoryには
Kyselyと`node-postgres`を採用済みです。checksum ledgerを持つ順序付きforward-only SQL
migrationをschemaの正本とし、protocol v1はtransport adapterだけが使うprivate workspace
packageとして共有します。control-planeのCI境界も採用済みで、blockingのstatic・
architecture check、pure・property test、production build、実PostgreSQL integration・決定論的
concurrency testと、定期的なadvisory mutation testingを要求します。初期SQL schema、checksum
migration runner、Kysely issuance repository、決定論的PostgreSQL 17 race test、4 jobのcontrol-plane
CI、定期Stryker workflowは実装済みです。Next.js shell、pure policy、application issuance境界、
protocol transport mapper、locale resource、blocking local verificationも実装済みです。ADR 0005で
Supabase Auth、端末ごとのnon-exportableなWindows CNG ECDSA P-256 key、署名済みrequest・response
構成、replay・revocation確認、result idempotency、clock規則を選択しました。public eject endpointは
ありません。認証済みpoll・result route、device key・nonce確認、signed response、result idempotency、
fail-closedなenvironment・database delivery gateは実装済みです。person-session adapterは、issuer・
audienceの完全一致、有効なexpiry、UUID subjectを持つSupabase JWTだけからidentityを受理し、現在の
EJECT account statusを再確認します。repositoryには10分・one-use enrollment ceremonyのserver側と、
idempotentなowner revocationを追加します。enrollment secretはdigestだけを保存し、canonical P-256
SubjectPublicKeyInfoだけを受理し、enrollment作成はdefault-disabledのまま、device keyとundelivered
commandをatomicに取消します。live Supabase provider lifecycleは検証済みですが、人がbrowserで行う
sign-in、standard-user Windows CNG証拠、Windows pollingは未完了です。Windows key-store実装は
current-userの永続P-256 keyを作成し、Platform providerを優先して
Software KSPだけへfallbackし、private materialをexportしません。既存user向けmagic-link、PKCE callback、
email OTP、refresh、local logoutの固定routeは、S256 state bindingと分離したhost-only cookieで実装済みです。
Production provider設定と英日UIは有効です。
EJECT専用Supabase PostgreSQL 17 projectはTokyoに作成済みで、
SSL enforcement、migration 3件、招待person 1件、delivery無効を確認済みです。`sasara/eject`
Vercel projectはGitHubへ接続し、TokyoでNode.js 22のNext.jsを実行します。database accessは
Productionだけに保護して設定し、Previewにはdatabase credentialを渡していません。

Stage 0自体は**未完了**です。トレイ式光学ドライブを持つ実際のWindows端末では、まだ
実行していません。その証拠が得られるまで、物理トレイを開けられると表現してはいけません。

## リポジトリにあるもの

```text
.github/workflows/windows-spike.yml
    Windows上のテスト、発行、スモークテスト、チェックサム、artifact用workflow。

src/Eject.Agent.Core/IDeviceKeyStore.cs
    deviceごとのkeyについて、作成、public-key取得、正確なbyte列への署名だけを持つ狭いport。

src/Eject.Agent.Windows/WindowsCngDeviceKeyStore.cs
    current-userの永続・non-exportable CNG P-256実装。Platform providerからSoftware KSPだけへの
    closed fallbackを持つ。

.github/workflows/protocol-contract.yml
    locked Node.js installとprotocol Schema・意味テスト。

.github/workflows/control-plane.yml
    PostgreSQL 17を含む4 jobのblocking control-plane verification。

.github/workflows/control-plane-mutation.yml
    週次および手動実行可能なadvisory Stryker mutation testing。

control-plane/src/app/
    safe-state EJECT表示、person-auth form、owner device管理を持ち、remote action endpointを持たない
    responsiveなlocalize済みservice console。

control-plane/src/modules/eject/
    pure authorization、exposure、lifecycle policy、application issuance・agent result境界、
    PostgreSQL issuance・agent transport store、protocol v1 transport mapper。

control-plane/src/modules/devices/
    device request authentication・enrollment port、Node P-256 crypto、bounded HTTP parsing、
    PostgreSQL enrollment・revocation、signed poll・result response handler。

control-plane/src/modules/identity/
    applicationが所有するperson-session・account-status port、固定host-only access-cookie reader、
    Supabase JWKS JWT検証、PostgreSQL current-account-status adapter。

control-plane/src/modules/permissions/
    ownerへbindしたrecipient consent application port、閉じたHTTP処理、commandのatomic取消を持つ
    SERIALIZABLE PostgreSQL pause・grant・revoke。

control-plane/src/app/api/agent/v1/
    固定enrollment・poll・result POST route。enrollmentとdeliveryは独立したdefault-disabled
    environment gateを持つ。

control-plane/src/app/api/person/v1/
    Origin確認・person-session認証済みのenrollment-secret作成とidempotentなdevice revocation
    POST route、recipient pause、既存relationshipへのgrant/revoke route。person eject routeと
    account検索routeは存在しない。

control-plane/test/
    unit、property、application境界、protocol adapter、migration、repository、決定論的concurrency test。

control-plane/migrations/
    checksum検証を持つ順序付きforward-only PostgreSQL schema migration。ownerごとのactive device
    1台制約とenrollment・revocation stateを含む。

control-plane/scripts/verify-cloud-database.ts
    credentialを出力しないcloud schema、TLS設定、安全状態の検証。

docs/CLOUD-DATABASE.md
    運用owner、protected environment、migration、rotation、recovery、enablementの英日runbook。

protocol/v1/
    閉じたcommand、agent-result、lifecycle Schema、reference validator、fixture、英日両方の
    契約文書。

src/Eject.Agent.Core/
    閉じた能力インターフェース、ドライブ能力、限定済みeject結果。

src/Eject.Agent.Windows/
    Windowsドライブ検出、不透明ID、固定されたWin32 ejectアダプター。

src/Eject.Agent.Cli/
    `list`と`eject <opaque-id>`だけを持つ非ネットワークJSON CLI。

tests/Eject.Agent.Windows.Tests/
    アダプター封じ込め、識別、ネイティブ結果変換、選択処理のテスト。

scripts/build-windows-spike.sh
    ローカルテスト、自己完結型`win-x64`クロス発行、チェックサム、検証キットの組み立て。

scripts/record-windows-hardware-test.ps1
    チェックサム検証、意図的な1回の実行、英日locale resourceを使ったプライバシー限定の
    証拠記録。

docs/schemas/stage-0-hardware-evidence.schema.json
    レビュー済みStage 0ハードウェア証拠の閉じたschema。

docs/STAGE-0-WINDOWS-SPIKE.md
    ビルド、操作、安全、ハードウェアテスト手順。

docs/decisions/0001-implementation-stack.md
    採用済みの言語、配置、アーキテクチャ方針。

docs/decisions/0002-stage-1-protocol-v1.md
    採用済みの期限、宛先、replay、結果、lifecycle、transport境界。

docs/decisions/0003-control-plane-consent-and-exposure.md
    採用済みのStage 1 deployment、module、authorization、participation、access、eject-back、
    recipient側exposure境界。

docs/decisions/0004-control-plane-schema-and-contract-sharing.md
    採用済みのmigration、Kysely、PostgreSQL schema、protocol共有rule。

docs/decisions/0005-identity-and-device-security.md
    採用済みのperson auth、device key、enrollment、integrity、replay、revocation、result idempotency、
    clock構成。
```

英語文書が正本です。意味を変える場合は、対応する`.ja.md`も同じ変更で更新してください。

## 検証済みの動作

次の事実には、ビルドまたはテストによる直接の証拠があります。

1. .NET 10でLinux ARM64上のソリューションをビルドできる。
2. 10件のユニットテストがLinuxとGitHubのWindowsランナーで成功する。
3. Linuxから自己完結型のWindows x64 PE実行ファイルをクロス発行できる。
4. GitHub Actionsの`windows-2025`で同じアプリを発行できる。
5. Windowsランナー上でアプリが起動し、ドライブ検出が完了する。
6. workflowは`eject-agent.exe`と`eject-agent.exe.sha256`を
   `eject-windows-x64`として14日間保存する。
7. 検証済み`main` runからダウンロードしたartifactはSHA-256検証に成功し、Windows x64
   PE実行ファイルとして認識された。
8. 2026-07-18に、現在の実装は10件すべてのテストに成功し、Linux ARM64上の.NET 10で
   自己完結型`win-x64`クロス発行を再現した。
9. ローカルビルドは実行ファイル、チェックサム、検証ツール、両locale resource、証拠
   schemaを組み立て、生成された実行ファイルのチェックサム検証に成功した。
10. PowerShell 7.6.3で検証ツールをparseし、両JSON locale resourceをstrict UTF-8で
    decodeでき、22個すべてのkeyが完全に一致した。
11. Windows platform guardだけを外した一時的なLinuxテスト用copyが、ドライブ0台を返す
    fake実行ファイルに対して、両localeのejectなし`-VerifyOnly`経路を完了した。
12. fake実行ファイルと置換した権限区分を使う別の一時的なrecord経路simulationは、AJVの
    strictなDraft 2020-12 modeが受理するレポートを生成した。この合成レポートは実機証拠
    ではない。
13. 同じAJV検証は追加した`computer_name` fieldを拒否し、`actionlint` 1.7.12は更新済み
    Windows workflowを受理した。
14. Node.js 22とAJV 8.20.0でprotocol test 11件がすべて成功する。閉じたpayload、宛先完全
    一致、期限、未来方向skew、replay、ローカル拒否、1回の試行結果、lifecycle遷移を含む。
15. `actionlint` 1.7.12はWindowsとprotocol両workflowを受理し、
    `npm ci --prefix protocol`はlocked dependency graphを再現し、audit脆弱性を報告しない。
16. 2026-07-19に、`main`上の`windows-spike` workflowが検証キットを組み立て、Windows
    runner上でejectなしの`-VerifyOnly`確認を完了し、キット全体をartifactとして
    アップロードした([run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811))。
17. `protocol-contract` workflowは`main`上で成功した
    ([run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249))。
    これによりprotocol test 11件にもCI証拠がある。
18. control-plane skeletonはNode.js 22上でformat、ESLint、strict TypeScript、
    dependency-cruiser、Next.js 16.2.10 production buildに成功する。
19. fast-check property、P-256 request・response integrity、closed HTTP handling、protocol result
    mapping、default-disabled routeを含むcontrol-plane test 49件がすべて成功する。重要なauthorization、
    lifecycle、exposure、idempotency codeはbranch、function、line、statement coverage 100%。
20. 2026-07-21時点のproduction dependency auditは既知の脆弱性0件だった。PostCSS 8.5.20
    overrideにより、Next.jsの
    transitive defaultにあったadvisoryを除去した。
21. `main`上のcontrol-plane workflowで、static・architecture、critical coverage 100%の
    domain・protocol、PostgreSQL 17 migration・repository・concurrency test 12件、production
    buildの4 jobがすべて成功した
    ([run 29813234824](https://github.com/tnoborio/eject/actions/runs/29813234824))。
22. atomicなKysely issuance、idempotent replay、決定論的race、forward-only migration 2件、agent
    nonce replay、key revocation、fail-closed delivery、result idempotency、正直なlifecycle記録、
    checksum drift、安全側default、database constraintを含むPostgreSQL test 17件がlocalで成功する。
23. 決定論的なtransaction concurrency test 5件がPostgreSQL 17に対して成功する。行lockの
    barrierにより、最後の1枠の直列化とretry、同時idempotent replay、constraint failure後の
    全write rollback、grant取消の再評価、source commandごとに1回だけのeject-backを証明する。
24. Stryker 9.6.1はauthorization、exposure、lifecycle、semantic idempotency policyに対して
    有効なmutant 136件をすべてkillする。週次および手動実行可能なadvisory workflowはHTMLと
    JSON reportを14日間保存する。
25. Next.js production buildは固定されたNode.js poll・result routeを含む。environment gateを明示的に
    trueにしない限り`404 DELIVERY_DISABLED`を返すことをunit testで証明し、PostgreSQLのglobal gateが
    falseの場合も独立してdeliveryをblockまたはcancelする。
26. 認証済みpolling changeはmerge前にcontrol-planeとprotocolの全checkを通過した
    ([control-plane run 29815220933](https://github.com/tnoborio/eject/actions/runs/29815220933)、
    [protocol run 29815220953](https://github.com/tnoborio/eject/actions/runs/29815220953))。
27. 2026-07-21にEJECT専用Supabase projectは`ACTIVE_HEALTHY`、`ap-northeast-1`のPostgreSQL 17、
    database SSL enforcement有効と報告した。repository verifierでmigration 2件のchecksum完全一致、
    pin済みCA・hostname検証済み接続、delivery無効、physical ceilingなし、EJECT application row 0件を証明した。
28. `sasara/eject` Vercel projectは`control-plane` workspace root、Next.js、Node.js 22、Tokyo `hnd1`
    compute、GitHub repositoryを設定済み。`DATABASE_URL`とpin済みCAはsensitiveなProduction valueだけに
    存在する。Production、Preview、Developmentすべてでdeliveryは明示的にfalseで、Previewにはproduction
    database credentialがない。
29. protected deployment `dpl_G6pHisFuPVmausakV6PXxzrGtZYi`はNext.js Functionを`hnd1`に配置して
    `Ready`へ到達した。認証付きdeployment checkでshellからHTTP 200、deployed poll routeから
    `404 DELIVERY_DISABLED`を確認した。
30. PR #12はblocking control-plane job 4件とVercel check 2件にすべて成功した
    ([run 29839496511](https://github.com/tnoborio/eject/actions/runs/29839496511))。
31. 2026-07-22にperson-session adapterはcontrol-plane unit test 58件に成功した。重要なapplication、
    Supabase JWT、固定cookie surfaceは、blockingのbranch・function・line・statement coverage 100%の
    対象に含まれる。
32. JWT adapterは、設定済みSupabase JWKSで解決するES256またはRS256署名、issuer・audienceの完全一致、
    必須expiry、小文字UUID subjectだけを受理する。誤ったclaim、expiry、signature、malformed・oversized
    token、UUIDでないsubjectを拒否し、emailやprovider identityをapplication codeへ渡さないことをtestで
    確認した。
33. PostgreSQL 17 test 18件がlocalで成功する。追加した実database testにより、request間でpersonが
    `ACTIVE`から`RESTRICTED`へ変わると、次のsession authenticationがrestrictionを認識することを証明した。
34. 現在のcheckoutはlocked `npm ci`、protocol test 11件、control-plane static・architecture check、
    production build、.NET 10 test 10件に成功する。新しい`jose` dependencyは6.2.4へexact pinした。
35. このsessionで見つかった新しい`fast-uri` advisoryは、互換な3.1.4 lockfileで解消し、standalone
    protocol production auditはcleanになった。root production auditには既知の制限に記した新しい
    Sharp/libvips advisoryが残る。
36. PR #13はGitHub Actions 5 jobとVercel check 2件にすべて成功した後、`45bac29`としてmergeした
    ([control-plane run 29895265935](https://github.com/tnoborio/eject/actions/runs/29895265935)、
    [protocol run 29895265928](https://github.com/tnoborio/eject/actions/runs/29895265928))。
37. 現在のcheckoutはcontrol-plane unit test 70件に成功する。enrollment application境界をblockingの
    critical coverage対象へ追加し、branch・function・line・statement coverageは100%を維持する。
38. forward-only migration 3件に対してPostgreSQL 17 test 23件がlocalで成功する。実databaseで、
    digestだけを保存する10分secret、同一secret同時raceで正確に1回だけの消費、ownerごとのactive device
    1台、account・expiry再確認、revocation後の交換、key・pending enrollment・commandのatomicな取消を
    証明する。
39. closed HTTP testは、request body内のperson ID、cross-origin person mutation、未知enrollment field、
    query string、Windows以外のmetadata、malformed public key、non-canonical inputを拒否する。数字3部分の
    agent versionとcanonical P-256 DER SubjectPublicKeyInfoだけを受理する。
40. production buildは固定agent enrollment routeとperson enrollment・revocation routeを含む。
    enrollment作成は独立environment gateを明示的にtrueにしない限り、database・person-auth初期化前に
    `404 ENROLLMENT_DISABLED`を返す。revocationは分離した認証済みsafety pathとして残る。
41. PR #14はcontrol-plane job 4件とVercel check 2件にすべて成功した後、`f08d090`としてmergeした
    ([control-plane run 29896627535](https://github.com/tnoborio/eject/actions/runs/29896627535))。
42. 2026-07-22にmigration 0003を、EJECT専用のprotected Supabase PostgreSQL 17 databaseへadvisory
    lock付きの1 transactionで適用した。独立したread-only queryにより、repository migration 3件の
    checksum、追加したindex・metadata column、旧owner uniqueness constraintの除去、
    `delivery_enabled = false`、未設定のphysical ceiling、application row合計0件を確認した。
43. 現在のProduction deploymentはagent pollingで`DELIVERY_DISABLED`、agent enrollmentで
    `ENROLLMENT_DISABLED`を返した。enrollmentのenvironment opt-inとresponse-signing private keyは
    未設定のままで、person、device、secret、command、result、private eventは作成していない。
44. PR #16はcontrol-plane unit test 92件に成功する。person-session lifecycleをblockingの
    critical境界へ追加し、branch・function・line・statement coverageは100%を維持する。
45. closed HTTP testはmagic-link開始、OTP検証、refresh、local logoutを正確なPOST pathとHTTPS Originへ
    bindする。callbackは同じbrowserの32-byte stateと一つだけのcodeを受理し、open redirectを持たず、
    one-time PKCE cookieを消去し、`private, no-store`・`no-referrer` response policyを適用する。
46. Supabase adapterはPKCE S256、`create_user = false`、server側だけのpublishable key、bounded provider
    response、refresh token rotation、local-scope logoutを使い、access・refresh cookieを設定する前に
    asymmetric JWT検証を必須にする。
47. production buildはperson-auth固定route 5件を含む。独立opt-inが正確にtrueでない限りprovider初期化前に
    `PERSON_AUTH_DISABLED`を返す。Vercelにはauth設定もpublishable keyも設定していない。
48. PR #16はcontrol-plane job 4件とVercel check 2件にすべて成功した後にmergeした
    ([control-plane run 29898326094](https://github.com/tnoborio/eject/actions/runs/29898326094))。
49. PR #17はhosted Windows 2025 runnerでWindows test 15件に成功した。native testはcurrent-userの
    永続P-256 keyを作成・再openし、DER SubjectPublicKeyInfoと64-byte IEEE P1363 signatureを検証し、
    export policyが`None`でprivate-key exportが失敗することを確認した。別のprovider-selection testで、
    限定したSoftware KSP fallbackも実走した。
50. PR #17は続けてself-contained Windows x64 executableをpublish・smoke testし、ejectせずにhardware
    kitを検証した([Windows run 29899184939](https://github.com/tnoborio/eject/actions/runs/29899184939))。
    hosted automationはtarget hardware上のstandard-user動作やprotected-key動作の証拠ではない。
51. PR #17は`ec00e78`としてmergeした。merge後の`main` pushでもtest 15件、publish、smoke test、
    no-eject hardware-kit検証、artifact uploadをすべて再実行して成功した
    ([Windows run 29899930269](https://github.com/tnoborio/eject/actions/runs/29899930269))。
52. 現在のcheckoutは静的shellをresponsiveな英日service consoleへ置き換える。明示的なlocale選択は
    非機密cookieへ永続化し、document languageも追従する。新しい表示文言はすべて対になるlocale
    resourceに置く。無効なEJECT表示はcommandを送らないと明示し、物理成功を主張しない。
53. Web consoleはdefault-disabledのmagic-link、OTP、logout、enrollment-secret、revocation routeへ
    接続する。固定device-enrollment pathの新しい認証済みGETはsession ownerの限定されたdevice stateだけを
    一覧化し、keyやenrollment digestを公開しない。
54. localではformat、ESLint、TypeScript、dependency rule、unit・property test 95件、blocking critical
    boundaryのbranch・function・line・statement coverage 100%、隔離した一時databaseに対するPostgreSQL 17
    integration・concurrency test 23件、Next.js 16.2.10 production buildに成功する。
55. Vercel Preview deployment `dpl_7QNfN2eigmYZK1bP3jeZaUT9DfgR`は
    `https://eject-liv5qbj16-sasara.vercel.app`で`READY`へ到達した。認証付きdeployment requestで`/`から
    HTTP 200を確認した。previewは3 capabilityすべてを無効と表示し、auth routeは
    `PERSON_AUTH_DISABLED`を返す。Previewにはproduction database credentialがない。
56. 2026-07-23にEJECT Supabase Auth projectが`ACTIVE_HEALTHY`のままで、ES256 signing keyを1件
    公開することを確認した。provider defaultから、public signup拒否、完全一致するpublic Production
    site・callback URLだけの許可、server PKCE cookie期限と一致する8桁email codeの10分失効へ変更した。
57. 現在のcheckoutにoperator専用`person:provision` commandを追加した。live testではemailを送らない
    confirmedな一時Supabase Auth identityを作成し、同じUUIDをmigration済み隔離PostgreSQL 17 databaseへ
    insertした後、両方のtest recordを削除した。2回目のlive testでは現在の`sb_secret_` API key header
    contractを検証し、一時identityとdatabaseを削除した。operator secretはrepositoryにもVercelにも
    保存していない。
58. Production deployment `dpl_W5Xs6mVeViWaks9hrPBidLfLAESe`は`READY`へ到達し、
    `https://eject-bice.vercel.app`へaliasした。Production表示は`personAuth=true`、
    `deviceEnrollment=false`、`delivery=false`である。enrollment作成とagent pollingはそれぞれ
    boundedなdisabled responseをHTTP 404で返す。
59. email送信や個人情報のlog出力なしで、最初の永続的な招待Auth identityと同じUUIDの`people` rowを
    provisionした。protected cloud databaseはperson 1件、device 0件、enrollment session 0件となり、
    Auth userも正確に1件となった。
60. live-provider検証で、現在のSupabase API key・tokenとの互換性想定を2点修正した。
    `sb_publishable_` keyはAPI keyとしてだけ送り、userまたはlegacy anon JWTだけをBearer headerへ
    送る。boundedな12文字のopaque refresh tokenも受け付ける。emailを送らない生成linkでprovider
    tokenを検証後、Production refreshはHTTP 204、認証済みowner-device一覧はdevice 0件でHTTP 200、
    Production logoutはHTTP 204を返した。session tokenはlog出力していない。
61. PR #19はformat、ESLint、TypeScript、dependency rule、unit・property test 100件、
    blocking critical boundaryのbranch・function・line・statement coverage 100%、隔離した一時databaseに
    対するPostgreSQL 17 integration・concurrency test 26件、Next.js 16.2.10 production buildに成功する。
    実PostgreSQL testにより、consent readがactive relationshipだけを公開すること、grantがactive
    relationshipを必須とすること、revokeがそのactorの未確認commandだけを取り消すこと、pauseが
    recipientの未確認commandをすべて取り消すこと、安全mutationの再実行でcancellation eventを
    重複作成しないことを証明した。run 30053578168でActions 4 jobとVercel check 2件がmerge前に
    すべて成功した。
62. invite-only relationshipのcheckoutはformat、ESLint、TypeScript、dependency rule、protocol
    test 11件、control-plane unit・property test 107件、critical boundaryのbranch・function・line・
    statement coverage 100%、PostgreSQL 17 migration・repository・concurrency test 30件、
    Next.js 16.2.10 production buildに成功する。実PostgreSQL testはdigestだけを保存する10分間の
    invitation、新codeによる置換、raceで正確に1人だけのaccept、self・expired・restricted・inactive
    relationshipの拒否、方向付きgrantを変えない既存active relationshipのidempotent acceptを証明した。
    migration 0004はadvisory lock付きの1 transactionでprotected cloud databaseへ適用済み。その後の
    独立read-only queryでmigration 4件のchecksum、delivery無効、relationship・invitation 0件、
    digest列、pending invitationを1件に限定するunique indexを検証した。

run 29899930269の検証済み`main` artifactのチェックサムは次のとおりです。

```text
3364e14a8ba65110389dab574ec0871f2f457e9894eebb3d44cfa5ea87ede9c4
```

artifactには期限があり、後続ビルドのチェックサムは変わります。各artifactに同梱される
チェックサムファイルを、そのビルドの正本として扱ってください。

## 意図した安全境界

次の性質は実装契約の一部であり、今後も維持する必要があります。

- 実行ファイルはネットワーク機能を持たない。
- shell、プロセス実行、スクリプト実行、プラグイン、汎用リモートコマンドがない。
- 呼び出し側はドライブパスやIO制御コードを指定できない。
- `eject`は最新のローカル光学ドライブ検出に照合できる不透明な識別子だけを受け取る。
- アダプターは固定されたeject操作を1回だけ実行し、再試行ループを持たない。
- ディスクラベル、ファイル名、内容、メディアメタデータを読まない。
- トレイを閉じる操作がない。
- Windows API成功は`COMMAND_ACCEPTED`であり、`physical_outcome`は`UNKNOWN`のままにする。
- protocol v1は、1台の完全一致する端末宛てに`OPTICAL_DRIVE_EJECT`だけを受理する。
- protocol payloadはローカルドライブパス、実行命令、翻訳済み文章、`OPENED`物理結果を
  運べない。
- 消費済みコマンドは保存済み結果を再送できるが、物理試行をもう一度発生させてはいけない。

非対応ハードウェアへの回避策として、これらの境界を緩めてはいけません。失敗を記録し、
対応する能力契約を狭く定義してください。

## 既知の制限と未確認事項

- 物理光学ドライブに対してコードを実行していない。
- 標準ユーザーでデバイスハンドルを開けるか未確認。
- 空、メディア挿入、使用中、切断、USB、SATA、複数ドライブ、トレイレスを未確認。
- Windows API成功と目視できるトレイ動作の関係を未確認。
- 不透明なドライブ識別子は現在のドライブルートから生成している。ローカルスパイクには
  適するが永続的なハードウェア識別子ではなく、ドライブ文字の再割り当てで変化する。
- desktop executableにはUI、インストーラー、コード署名、更新チャネル、enrollment state、サーバー接続がない。CNG key storeは
  CLIへ未接続。
- protocol v1は実際の制御面とagent間ではまだ動かしていない。
- PostgreSQL issuance、認証済みpoll・result transport、person-session検証、server enrollment・
  revocation境界は実装済みで、server管理のSupabase magic-link/OTP PKCE cookie lifecycleも`main`へ
  実装済みで、Productionでは有効である。provider token検証、refresh、認証済みowner-device一覧、
  logoutにはlive証拠がある。人がbrowserで行うPKCE magic-linkまたはOTP操作はまだ完了していない。
  Windows CNG keyのenrollment接続とWindows polling clientは未実装。
- ownerへbindしたpauseと既存relationshipへのgrant/revokeは、実databaseのcancellation証拠とともに
  `main`へ実装済み。現在のcheckoutはinvite-only relationship確立を追加するが、未deployで、liveの
  two-account browser証拠もない。account検索、invitation delivery、disconnect後のreconnect、
  eject requestは意図的に提供しない。
- migration 0004は、未deployのrelationship routeより先にprotected cloud databaseへ適用し、独立検証
  済み。新しいtableは空で、enrollmentや物理deliveryを有効にしない。
- alpha前にinvitationのretention・cleanupを定義する必要がある。databaseはinvitation digest、timestamp、
  inviter IDだけを保存し、bearer codeやaccepter identityは保存しない。
- person JWT adapterはlive Supabase ES256 JWKSとprovision済みactive accountに対して検証済み。
  live signing-key rotationはまだ観測していない。
- cloud environmentはmigration 4件をすべて適用・検証済みで、招待person 1件が存在する。device、
  enrollment secret、command、result、signing key、private eventは存在しない。person authはliveだが、
  enrollmentとすべての物理deliveryは無効のまま。
- ADR 0005でauthentication provider、device credential、integrity、replay、revocation、
  idempotency、clock構成を確定した。独立security reviewとstandard-user Windows CNG検証は未実施。
- 2026-07-22時点で`npm audit --omit=dev`は、Next.jsのoptional Sharp 0.34.5 dependency経由で
  high-severityのlibvips advisoryを報告する。現在の最新stable Next.jsも`sharp ^0.34.5`を宣言する一方、
  audit上の修正版はSharp 0.35以降である。unsupportedなmajor overrideを強制せず、互換Next.js release
  または明示的にreviewしたdecisionで更新する。
- protocol共有、pure test境界、SQL migration、PostgreSQL issuance repository、実database
  race test、blocking control-plane CIは実装済み。定期的なadvisory mutation testingも実装済み。
- 実機証拠から説明可能なsafety ceilingが得られるまで、subscription価格とinbound frequency
  ceilingは決められない。
- macOSは実験扱いのままであり、Windowsのハードウェア上の事実を確立する前に着手しない。

## 新しい開発セッションの開始

プロダクト動作を変更する前に、次のファイルを読んでください。

1. `PRINCIPLES.md`
2. `docs/SECURITY.md`
3. `docs/I18N.md`
4. `docs/ROADMAP.md`
5. `docs/ARCHITECTURE.md`
6. このハンドオフ

その後、checkoutを同期して検証します。

```sh
git switch main
git pull --ff-only origin main
dotnet test Eject.slnx --configuration Release
npm ci --prefix protocol
npm test --prefix protocol
```

リポジトリは`global.json`で.NET 10を選択します。`dotnet`がない場合は、作業を続ける前に
対応する.NET 10 SDKをインストールしてください。

Windowsクロスビルドを再現するには次を実行します。

```sh
./scripts/build-windows-spike.sh
```

Windowsネイティブビルドを要求してダウンロードするには次を実行します。

```sh
gh workflow run windows-spike.yml
gh run list --workflow windows-spike.yml --limit 1
gh run watch RUN_ID
gh run download RUN_ID --name eject-windows-x64 --dir artifacts/github-actions
```

## ハードウェアがない間の次の必須作業

物理検証は並行要件として残しますが、唯一の開発queueにはしません。SQL migration、blocking CI、
Kysely issuance、決定論的PostgreSQL race、advisory mutation testing、ADR 0005、認証済みpoll・result
transport、専用cloud database environment、person-session adapter、server enrollment・revocation境界は
実装済みで、migration 4件はすべてprotected cloud databaseへ適用済みです。次のsoftware順序は
次のとおりです。person PKCE cookie lifecycleとprotected Windows CNG key storeは`main`へ実装済みです。
後者にはhosted Windows CI証拠がありますが、実機standard-user証拠はありません。現在はWeb体験を
先行します。現在のcheckoutはdeliveryやaccount検索を有効にせず、安全な英日preview、owner-device UI、
ownerへbindしたpause・grant・revoke、invite-only relationship確立を提供します。次の順序は次のとおりです。

1. invite-only relationship changeをreview・publishし、blocking ActionsとVercel checkを記録する。
   migration 0004とmigration 4件のchecksumは、enrollment・deliveryを無効のまま検証済み。
2. operator専用pathで2件目の招待済みexisting accountをprovisionし、Productionで人が操作する
   magic-linkまたはOTP sign-inとtwo-account relationship code acceptを各1回完了する。codeやsessionは
   logへ残さない。
3. invitation retentionとdisconnect/reconnect動作を別のreview済みchangeで定義する。
4. 無効なgateの背後でprotected Windows keyをenrollmentへ接続し、durable replay consumptionと保存済み
   resultのresendを含むoutbound-only pollingを実装する。実機standard-user CNG証拠が得られるまで
   device enrollment作成を無効に保つ。認証済みdevice一覧とrevocationは独立したsafety controlとして
   利用可能にしてよい。

Windows CNG検証は並行要件として残します。pollingにはgeneric commandやinbound portを追加しません。

person-authとenrollment作業中はenrollment opt-inを未設定、両delivery gateをfalseのままにし、
Vercelにserver response-signing private keyを設定しません。

skeletonのpull requestでは、format、lint、TypeScript、依存rule、Next.js production build、
pure・property test、ephemeralな実PostgreSQL serviceに対するintegration・決定論的concurrency
testをblockingにします。重要なpure policy surfaceにはbranch coverage 100%を要求します。
定期的なmutation testingはadvisoryから始めます。database mockをtransaction、locking、
constraintの正しさの根拠にしません。

authenticated pollingとenrollmentはADR 0005へ従います。algorithm、header construction、
key-storage fallback、replay windowを変える場合は、実装shortcutではなく明示的なsecurity
decisionが必要です。

## 機材入手後のハードウェア作業

標準ユーザーで検証キットを実行し、プライバシー限定レポートをレビューし、
`STAGE-0-WINDOWS-SPIKE.md`のmatrixを繰り返します。証拠に基づくadapter問題だけを修正し、
狭いWindows能力契約を文書化します。この契約を実機で再現できるまでStage 0は未完了です。

## この実装からのPR順序

更新済み両workflowのCI検証は`main`上で完了しています(スナップショットのリンクを
参照)。今後の変更も小さくレビュー可能な単位に保ちます。

1. **Control-plane PostgreSQLとCI** — checked-in SQL migration、Kysely issuance repository、
   実database race test、blocking workflow、定期的なadvisory mutation testingは実装済み。
   public endpointやdevice enrollmentを追加する前に、この基盤を確立した。
2. **identity・device security ADR** — ADR 0005で採用済み。Supabase person identity、分離した
   CNG device key、protected storage、正確なbytesのintegrity、replay、revocation、result
   idempotency、clock規則。
3. **認証済みoutbound polling** — control plane側を実装済み。正確なbytesのP-256 authentication、
   signed response、nonce replay防止、result idempotency、二つのfail-closed delivery gateを持つ。
4. **専用cloud environment** — 独立managed PostgreSQL 17 project、SSL enforcement、protectedな
   Production-only database access、migration完全一致検証、Git接続済みVercel deployment、delivery無効で実装済み。
5. **Web体験、person auth・Windows登録とpolling** — 英日safe-state service console、person-session検証とdefault-disabledのserver enrollment・
   revocation境界は`main`へ実装済みで、3件目のmigrationもprotected cloud databaseへ適用・検証済み。
   server管理のPKCE cookie routeも`main`へ実装済み・default-disabled。sign-in・owner-device UIを実装し、
   safeなVercel Previewとauth-enabled Production serviceを検証済み。最初の招待personとlive provider
   session lifecycleも検証済み。ownerへbindしたpauseと既存relationshipへのgrant/revokeは、atomicな
   cancellation証拠とともに`main`へ実装済み。invite-only relationship確立はADR 0006に従って現在の
   checkoutへ実装済みで、migration 0004はprotected cloud databaseへ適用し、checksumを独立検証済み。
   route changeのpublish、人がbrowserで行うsign-in・two-account consent証拠、実機standard-user key
   証拠、Windows keyのenrollment接続、ローカルreplay防止、1回だけの実行、result report、
   outbound-only pollingは未実装。protected Windows key作成自体はhosted Windows CIで検証済み。
6. **並行するハードウェア証拠** — 機材入手後、レビュー済みレポートと、証拠により狭く
   裏付けられたadapter修正を追加する。

Stage 1 enrollmentを完了扱いにする前に、採用済み構成の独立security reviewと、実際の
standard-user Windows CNG証拠が必要です。

## 次回ハンドオフの完了条件

今後のセッションでは、次を残してください。

- テストと英日両方の意味変更を含む、焦点を絞ったPR
- 関連するActions runへのリンク
- 何を検証したかを示す明示的な証拠
- 未解決の物理・セキュリティ問題の更新一覧
- 資格情報、署名素材、デバイストークン、非公開イベントログを含めないこと
- 現在の段階または次の推奨作業が変わった場合、このハンドオフを更新すること
