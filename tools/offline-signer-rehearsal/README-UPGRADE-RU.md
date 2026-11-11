# Локальная передача upgrade authority — v5

Отдельный тест, не mainnet. Программа действительно загружена через CLI в пустой
validator, не встроена в genesis. До этого шага ею управляет одноразовый online
test authority; Config ещё не создан. Fee payer отдельный.

1. Проверь SHA-256 ZIP по сообщению, распакуй в новую папку на offline Windows.
2. Из прежнего комплекта скопируй локально в новый `work` только
   `identity.public.json` и `TEST-ONLY-PRIVATE-KEYS.json`.
   Приватный файл не возвращать на подключённый ПК.
3. Выполни:

```powershell
node .\upgrade-self-test.cjs
node .\upgrade-offline.cjs review
```

Должны пройти 2 теста. Проверь:

- `newAuthority` — твой прежний тестовый admin
  `5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk`;
- program ID `BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW`;
- `rpc` только `http://127.0.0.1:9033`;
- две инструкции: advanceNonceAccount и SetAuthorityChecked;
- `payer`, `oldAuthority` и `newAuthority` — три разных signer;
- нет upgrade, закрытия, отзыва authority, токенов или инициализации Config.

```powershell
node .\upgrade-offline.cjs sign --confirm-local-test
```

Верни **только** `work\result.upgrade.json` в
`temp\offline-signer-upgrade-return\` на рабочем ПК.

`punycode` DeprecationWarning — предупреждение зависимости, не ошибка подписи.
Ожидаемый итог команды: `LOCAL_HANDOFF_SIGNED; nothing sent`.
Повторная команда не перезаписывает существующий result.

## Что проверяется

Offline CLI восстанавливает точное сообщение по policy, проверяет incoming key,
подписывает его и проверяет подпись. Node.js достаточно, npm install не нужен.
Online driver проверяет genesis, текущую authority, nonce, полные ProgramData bytes
и ELF, отсутствие Config; добавляет подписи отдельного payer и старой authority,
делает подписанную симуляцию и отправляет один раз. После finalized сравнивает
ProgramData побайтно: меняются только 32 байта authority; nonce должен обновиться.

Hash бинарника в policy — проверка online-хоста, **не on-chain условие** transfer.
Офлайн-подпись не доказывает текущий ELF. Временная authority теоретически может
изменить программу до передачи; для mainnet отдельно выбираем процедуру,
учитывающую это окно, независимую проверку после handoff и до funding/init.
До принятия окончательной схемы не использовать этот комплект для production.

Программа остаётся upgradeable. `--final`, снятие authority и изменение Config
admin не выполняются. Config admin в будущем должен совпадать с текущей upgrade
authority в момент InitializeConfig; последующая передача upgrade authority
сама по себе НЕ переносит Config admin.

При неизвестном результате online-команда проверяет status; автоматически
повторно не отправляет. Все ключи и адреса одноразовые, публичные SOL не нужны.
