# 実装ハンドオフ

[English](HANDOFF.md)

この文書は、新しいEJECT開発セッションの開始点です。実装済みの内容、検証済みの内容、
未確認事項、今後の作業順序を記録します。

## スナップショット

- **日付:** 2026-07-19
- **リポジトリ:** `tnoborio/eject`
- **現在のブランチ:** `main`
- **マージ済みPR:** [#2](https://github.com/tnoborio/eject/pull/2)(Stage 0スパイク)、
  [#3](https://github.com/tnoborio/eject/pull/3)(One Bitロゴ)、
  [#4](https://github.com/tnoborio/eject/pull/4)(ハードウェア検証キット)、
  [#5](https://github.com/tnoborio/eject/pull/5)(protocol v1)
- **マージコミット:** `cac982af474579e634568d0525659dad15289c6a`
- **`main`上の検証済みCI:** [Windows spike run 29688104811](https://github.com/tnoborio/eject/actions/runs/29688104811)、
  [protocol contract run 29688208249](https://github.com/tnoborio/eject/actions/runs/29688208249)
- **現在のプロダクト段階:** Stage 0は物理証拠待ち。Stage 1 protocol v1は実装済みで、
  制御面は未着手

## 現在の状態

リポジトリから、未署名かつ自己完結型のWindows x64コンソールアプリを生成できます。
このアプリはローカルの光学ドライブを検出し、ローカルで選択した不透明なドライブ識別子に
対して、固定されたeject処理を1回だけ試します。

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

Stage 0自体は**未完了**です。トレイ式光学ドライブを持つ実際のWindows端末では、まだ
実行していません。その証拠が得られるまで、物理トレイを開けられると表現してはいけません。

## リポジトリにあるもの

```text
.github/workflows/windows-spike.yml
    Windows上のテスト、発行、スモークテスト、チェックサム、artifact用workflow。

.github/workflows/protocol-contract.yml
    locked Node.js installとprotocol Schema・意味テスト。

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

検証済み`main` artifactのチェックサムは次のとおりです。

```text
d80c7f609a8aa36c332f0d2564c9ea869d56837ddfcf86698719cdc3b6406729
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
- UI、インストーラー、コード署名、更新チャネル、デバイス資格情報、サーバー接続がない。
- protocol v1は実際の制御面とagent間ではまだ動かしていない。
- 制御面、Webクライアント、アカウント認証、PostgreSQL schema、device credential、polling
  transportは未実装。
- 具体的な認証provider、device credential、message integrity方式、revocation確認は
  security decisionとして未決定。
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

物理検証は並行要件として残しますが、唯一の開発queueにはしません。次のsoftware changeは、
protocol v1に対するStage 1制御面domain skeletonです。

1. public eject endpointを持たないNext.js/TypeScript modular monolithをscaffoldする。
2. 方向付きgrant、受信者pause、cooldown、rate limit、device eligibility、即時revocationの
   pureでtest済みauthorizationを実装する。
3. PostgreSQL向けrepository interfaceとtransactionalなcommand ID一意性を使い、commandと
   lifecycle永続化をmodel化する。
4. person sessionとdevice credentialを分離し、security ADR採用までdevice enrollmentを
   保留する。
5. protocol v1外のcommand typeやfieldを運べるnetwork pathを公開しない。

authenticated pollingまたはenrollmentの前に、person auth provider、端末ごとのcredential、
保護済みローカル保存、message integrity、revocation lookup、結果idempotency、clock handlingを
扱う集中的なdecisionを記録します。

## 機材入手後のハードウェア作業

標準ユーザーで検証キットを実行し、プライバシー限定レポートをレビューし、
`STAGE-0-WINDOWS-SPIKE.md`のmatrixを繰り返します。証拠に基づくadapter問題だけを修正し、
狭いWindows能力契約を文書化します。この契約を実機で再現できるまでStage 0は未完了です。

## この実装からのPR順序

更新済み両workflowのCI検証は`main`上で完了しています(スナップショットのリンクを
参照)。今後の変更も小さくレビュー可能な単位に保ちます。

1. **Stage 1制御面domain skeleton** — Next.js/TypeScript modular monolith、test済みの
   方向付きpermission、cooldown、pause、revoke、command永続化境界を実装する。device
   enrollmentはまだ行わない。
2. **identity・device security ADR** — person認証、device credential、保護保存、integrity、
   revocation、idempotency、clock規則を選ぶ。
3. **認証済みoutbound polling** — protocol v1だけに従う発行と結果取り込みを実装する。
4. **Windows登録とpolling** — 保護ストレージ上の独立したdevice credential、ローカル
   リプレイ防止、1回だけの実行、結果報告を実装し、インバウンドポートを開かない。
5. **並行するハードウェア証拠** — 機材入手後、レビュー済みレポートと、証拠により狭く
   裏付けられたadapter修正を追加する。

Stage 1の登録を完了扱いにする前に、認証プロバイダーと具体的な暗号方式について、集中的な
セキュリティ判断が必要です。

## 次回ハンドオフの完了条件

今後のセッションでは、次を残してください。

- テストと英日両方の意味変更を含む、焦点を絞ったPR
- 関連するActions runへのリンク
- 何を検証したかを示す明示的な証拠
- 未解決の物理・セキュリティ問題の更新一覧
- 資格情報、署名素材、デバイストークン、非公開イベントログを含めないこと
- 現在の段階または次の推奨作業が変わった場合、このハンドオフを更新すること
