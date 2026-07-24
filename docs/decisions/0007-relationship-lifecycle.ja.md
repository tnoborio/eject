# ADR 0007: Relationshipの切断・再接続

[English](0007-relationship-lifecycle.md)

- **Status:** Accepted
- **Date:** 2026-07-24

## コンテキスト

ADR 0006はEJECT permissionを付与せずに非公開relationshipを作成しますが、切断、再接続、cancellation、
invitation retentionは意図的に保留しました。どちらか一人がrelationshipを終了した場合、方向付きgrantや
未配信の物理commandを残さず、直ちに終了できる必要があります。

切断をblock、account discovery signal、汎用social-network lifecycleへ広げてはいけません。再接続には
最初の接続と同じ、意図的なout-of-band操作を必須とします。

## 決定

1. どちらのpersonもactive relationship 1件を切断できます。固定requestは相手のperson IDだけを指定し、
   relationshipがinactiveまたは利用不可でも同じno-content resultを返します。
2. 短いPostgreSQL `SERIALIZABLE` transaction 1件で、両方のrecipient eject state rowをperson ID順に
   lockし、relationshipをlockしてinactiveにし、双方向grantを削除し、両方向の`QUEUED`または未確認の
   `DISPATCHED` commandを`PERMISSION_REVOKED`で取り消します。
3. 切断ではblock、notification、public event、account lookup、新しい物理capabilityを作りません。
4. 再接続では、一方が新しい10分間・一回限りのcodeを作り、もう一方がacceptする必要があります。
   relationshipを再有効化するのはそのaccept transactionだけで、方向付きgrantは復元しません。
5. 現在のactive intervalだけを保存します。再接続時に`created_at`を更新し、`ended_at`をclearします。
   これはrelationship historyではなく、意図的なdata minimizationです。
6. invitation rowは使用・無効化・失効の24時間後に削除対象となります。relationship mutationでboundedな
   opportunistic cleanupを行い、operator専用cleanup commandは1回につき最大500件を削除します。
7. cleanup commandが出力するのは削除件数だけです。invitation、person、relationship識別子は出力しません。

## 結果

- どちらか一人がrelationshipと双方向の物理操作permissionを直ちに撤回できます。
- 同意境界を失った未確認commandは残りません。
- 再接続は明示的かつ非公開で、以前のgrantは取り消されたままです。
- accepter identityや長期invitation ledgerを保存しません。
- endpoint trafficがない場合にretentionを強制するには、定期的なoperator実行が引き続き必要です。

## 却下した代替案

- 一方向のgrantだけを解除する
- queue済みcommandを残す
- sign-inやcontact list stateによる暗黙の再接続
- 再接続時のgrant復元
- 任意person IDが接続済みかどうかを公開する
- analytics目的でinvitation metadataを無期限保持する
