# YAMC: локальная ротация с durable nonce (v3)

Только локальный validator 127.0.0.1:8993. Mainnet не используется.
Прежние одноразовые admin/newIssuer ключи остаются на отдельном компьютере.
Запрос уже подготовлен: короткого срока blockhash здесь нет. Не запускать старые
prepare-live/submit-live команды — это другой тест и другие файлы.

## 1. Перенести комплект на отдельный компьютер

Распаковать ZIP в прежнюю `C:\YAMC-Signer`. Можно заменить `signer.mjs`.
Архив добавит `work\request.nonce.json`; он НЕ содержит приватных ключей.
Сохранить существующие `work\identity.public.json` и `work\TEST-ONLY-PRIVATE-KEYS.json`.
Интернет остаётся отключённым. npm install не нужен.

```powershell
cd C:\YAMC-Signer
node --test .\nonce-self-test.mjs
node .\nonce-signer.mjs review
```

Ожидаются 4 успешных теста. В review проверить:

- warning: `LOCAL VALIDATOR TEST ONLY; NOT MAINNET`;
- ровно две инструкции и именно в таком порядке:
  `advanceNonceAccount`, затем `rotateFaucetIssuer`;
- admin и newIssuer совпадают с прежним `work\identity.public.json`;
- nonceAuthority совпадает с admin;
- programId, config, genesis, nonceAccount, nonceValue совпадают с `nonce-policy.json`.

Публичные параметры этой репетиции:

```text
genesis: DSVYG4goHAryhmnGEJRQJ7rXSmc7jtceHoNr9uzM3i6M
nonceAccount: AwRg2zGBriXsYT5hDH37duBEN8cEB8bKucyYUWHiMDMo
nonceAuthority/admin: 5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk
newIssuer: 6e5SXKp7VM2gnGM5rypMRyMdX73pcM8YecgghLTucU3a
```

## 2. Подписать и проверить

```powershell
node .\nonce-signer.mjs sign --confirm-local-test
node .\nonce-signer.mjs verify
```

Ожидаемый результат: `LOCAL_NONCE_SIGNATURES_VALID`.
Появится `work\result.nonce.json`. Повторная подпись не перезапишет этот файл.

## 3. Вернуть результат

Перенести ТОЛЬКО `work\result.nonce.json` на рабочий ПК в:

```text
D:\Code\yet-another-cat\temp\offline-signer-nonce-return\result.nonce.json
```

Сообщить о готовности. Ассистент проверит подписи, исходное сообщение, актуальный
nonce и issuer, затем отправит только в локальный validator. Спешить не нужно;
validator должен оставаться работающим, а nonce не должен изменяться другой операцией.
Не пересылать приватные ключи. Подписанный запрос — разрешение на выбранную операцию,
поэтому не публиковать его до завершения/отмены даже в будущей production-схеме.

## Ограничения и повторные попытки

Офлайн-компьютер проверяет точные байты и две подписи, но не может самостоятельно
узнать состояние сети. Genesis/oldIssuer — review metadata, не часть Solana message.
Подписываемое сообщение содержит nonce account, authority и nonce value. Рабочий ПК
отдельно сверяет свой исходный запрос, сеть, nonce и текущие роли перед отправкой.

Изменение nonce делает старую подпись непригодной. Просто удалить файл не означает
отменить подпись: для отмены нужна отдельная операция advance, подписанная authority.
Она сейчас не выполнялась и не должна запускаться без отдельной проверки.

Если транзакция попала в блок, но её вторая инструкция завершилась ошибкой, nonce
может уже быть израсходован. Не переподписывать и не повторять автоматически.
Отправщик сначала сохраняет вычисленную signature ДО RPC, а при повторном запуске
проверяет статус без новой отправки. При неопределённом результате нужно сверить
signature, Config и nonce. Команда рабочего ПК для проверки:

```powershell
node .\tools\offline-signer-rehearsal\nonce-online.mjs --status
```

Тест не заменяет production review nonce/custody/fee budget и полного deployment.
Начальная Config была загружена как fixture; mainnet init и upgrade authority здесь
не проверяются. Генерировать реальные ключи по этой инструкции не нужно.
