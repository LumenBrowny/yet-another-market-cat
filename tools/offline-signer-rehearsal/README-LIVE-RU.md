# YAMC: живая локальная ротация — второй этап

Только локальный validator `http://127.0.0.1:8993`. Mainnet не используется.
Начальная Config загружена как тестовая fixture; это проверка ротации и времени
переноса, не проверка всей инициализации. Ключи — прежние одноразовые из v1.

## Сначала подготовить отдельный компьютер (без спешки)

Распаковать дополнение в прежнюю `C:\YAMC-Signer`, рядом с папкой `work`.
Разрешено заменить `signer.mjs` новой копией из дополнения. Папку `work` и ключи
не заменять. Node зависимости устанавливать не нужно. Интернет остаётся отключён.

```powershell
cd C:\YAMC-Signer
node --test .\live-self-test.mjs
```

Ожидаются три успешных теста. Прочитать `live-policy.json`: admin/newIssuer должны
совпадать с `work\identity.public.json`. Публичный genesis сверить с сообщением
на рабочем компьютере. Не редактировать policy, адреса или ключи самостоятельно.

## Затем начать замер на рабочем компьютере

В PowerShell, в текущем проекте:

```powershell
cd D:\Code\yet-another-cat
node .\tools\offline-signer-rehearsal\prepare-live.mjs --prepare
```

Должно появиться `READY_FOR_TIMED_TRANSFER`. Только с этого момента идёт отсчёт.
Скопировать `temp\offline-live-export\request.live.json` на флешку, затем на
отдельном компьютере в `C:\YAMC-Signer\work\request.live.json`.

На отдельном компьютере:

```powershell
node .\live-signer.mjs review
node .\live-signer.mjs sign --confirm-local-test
node .\live-signer.mjs verify
```

Сверить program/config/admin/newIssuer с policy, убедиться, что операция только
`rotateFaucetIssuer`, warning — `LOCAL VALIDATOR TEST ONLY; NOT MAINNET`.
Ожидается `LOCAL_TEST_SIGNATURES_VALID`.

Перенести ТОЛЬКО `work\result.live.json` на рабочий компьютер в
`D:\Code\yet-another-cat\temp\offline-signer-live-return\result.live.json`.
Папку на рабочем ПК можно создать заранее. Ключи остаются на отдельном компьютере.

Сразу на рабочем компьютере, не дожидаясь ответа в чате:

```powershell
node .\tools\offline-signer-rehearsal\submit-live.mjs --send
```

Команда проверяет исходное сообщение, подписи, genesis, текущего admin/issuer и
срок blockhash, симулирует подписанную транзакцию и только затем отправляет в
локальный validator. Она не принимает произвольный RPC или ключи через аргументы.

- `FINALIZED_LOCAL_ROTATION` — ротация подтверждена, `elapsedMs` — время до отправки.
- `EXPIRED_NOT_SENT` — времени не хватило; ничего не отправлено. Это полезный результат.
- `SUBMITTED`, затем ошибка/STOP — не повторять вслепую; сообщить, проверим signature.

После результата сообщить его в чат. Не запускать новую попытку самостоятельно:
возможны уже изменившийся issuer и старый файл результата. Файлы не перезаписываются.

## Ограничения

Офлайн-машина не может доказать текущий genesis/issuer, проверить RPC или срок
blockhash; она проверяет точные bytes и локально закреплённые публичные адреса.
Genesis и oldIssuer — review metadata, не поля Solana message и не часть подписи.
Рабочий ПК сверяет их со своим исходным запросом и фактической сетью перед отправкой.
Этот комплект использует исключительно одноразовые ключи, не production custody.
Не ускорять validator и не останавливать его для продления срока blockhash:
иначе замер не покажет пригодность обычного ручного переноса.
