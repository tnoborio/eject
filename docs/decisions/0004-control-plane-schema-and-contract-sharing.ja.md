# ADR 0004: Control-plane schemaとcontract共有

[English](0004-control-plane-schema-and-contract-sharing.md)

- **状態:** 採用
- **日付:** 2026-07-20

## 背景

ADR 0003では、Stage 1のtransaction、locking、idempotency、Kysely、test境界を確定しました。
実装には、レビュー可能なPostgreSQLの正本と、wire objectをdomainの一部にせずprotocol v1を
利用する方法がまだ必要です。

生成schemaのpush、ORM metadata、JSON Schemaのcopy、独立して保守するtransport typeは、
recipient consentを守るinvariantを隠したり重複させたりします。またrepositoryには、production
credentialなしでCIの空databaseから再現できるmigrationが必要です。

## 決定

### PostgreSQLの正本

1. 順序付きforward-only SQL migrationを`control-plane/migrations`に置く。commitされたSQL
   fileをdatabase schema履歴の正本とする。
2. migration名には単調増加する数値prefixを付ける。各migrationを一つのtransactionで適用し、
   filenameとSHA-256 checksumを`schema_migrations` ledgerへ記録する。
3. PostgreSQL advisory lockでmigration runnerを直列化する。このlockはschema deployment専用
   とする。command issuanceはADR 0003で確定したrow lockを使い続け、distributed lock依存を
   追加しない。
4. shared environmentへ適用済みのmigrationを編集しない。修正は新しいforward migrationで
   行う。rollbackは自動生成された`down` functionではなく、検証済みbackupからのrestoreまたは
   意図的なcompensating migrationとして扱う。
5. schema push、runtime auto-synchronization、ORM metadataを第二の正本にしない。Kyselyの
   database interfaceはinfrastructureに閉じたcompile-time mirrorであり、migrationと同時に
   更新する。
6. 閉じたstate値、UUID identity、foreign key、idempotency一意性、一回限りのeject-back消費、
   正のlimit、protocol v1 commandの最大寿命をPostgreSQL constraintで保証する。applicationの
   checkをconstraintの代わりにしない。
7. timestampは`timestamptz`で保存し、person、request、command、event UUIDはapplicationで
   生成する。一意性の最終的な正本はdatabaseとする。

初期schemaには、限定されたcontrol-plane factだけを置く。認証secretを持たないperson、
relationship、方向付きgrant、block、recipientが作成するaccess policy、plan非依存の
entitlement ceiling、登録device eligibility、recipient・sender rate state、idempotent request、
command、lifecycle eventである。email address、device credential、disc metadata、raw request
body、翻訳済み文章は保存しない。

### Protocol共有

8. `protocol/v1/eject-protocol.schema.json`をwire contractの唯一の正本として維持する。既存の
   protocol directoryをprivate workspace package `@eject/protocol-contract`として公開する。
9. control-planeのtransport adapterだけがprotocol validatorまたはwire schemaをimportする。
   閉じたpayloadを検証し、検証済みdataをapplication・domain値へ明示的にmapする。domainと
   application moduleはJSON Schema、AJV、protocol package type、wire objectをimportしない。
10. 初期には第二のauthoritative protocol typeを生成しない。検証済み値を表す小さな
    transport-local typeは許可するが、JSON Schemaとsemantic protocol testを正本とする。
11. protocol packageまたはcontrol-plane adapterが変わった場合、既存protocol contract testを
    CIで実行する。control-plane production buildも同じworkspace packageをresolveしなければ
    ならず、schemaをappへcopyしてはいけない。

## 帰結

- reviewerは明示的なSQLでconsent、lifecycle、idempotency invariantを確認でき、空の
  PostgreSQL databaseから完全なschemaを再現できる。
- 変更された過去のfileが黙って適用される前に、checksumでmigration driftを検出できる。
- infrastructureはPostgreSQLを認識しながら、domain policyはportableかつpureなままになる。
- agentとcontrol planeが一つのprotocol artifactを検証し、authorizationをtransport表現へ
  couplingしない。
- destructive rollbackを意図的に自動化しない。private alpha前のproduction deploymentでは、
  backup・restoreの訓練が必要になる。

## 不採用案

- Prisma、Drizzle、provider schema pushをmigrationの正本にする。
- runtime schema auto-synchronization。
- control-plane directory下にJSON Schemaをcopyして保守する。
- wire payloadをdomain policyへ直接importする。
- TypeScript protocol typeを生成し、採用済みJSON Schemaよりauthoritativeに扱う。
