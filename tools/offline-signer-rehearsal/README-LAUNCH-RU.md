# Локальная репетиция инициализации — v4

Только одноразовые тестовые ключи и validator на рабочем ПК. Не mainnet signer.
Node.js уже установлен; npm install и доступ в интернет не нужны. `launch-offline.cjs`
содержит собранные зависимости из текущего lockfile, а не загружает их при запуске.

## Первый перенос: initialize

1. Проверь SHA-256 архива по значению из сообщения. Распакуй в **новую папку**.
2. На отключённом от сети ПК скопируй из старого v1/v3 `work` два файла:
   `identity.public.json` и `TEST-ONLY-PRIVATE-KEYS.json` в новый `work`.
   Приватный файл остаётся на этом ПК. Не переносить его обратно.
3. В PowerShell, находясь в новой папке, выполни:

```powershell
node .\launch-self-test.cjs
node .\launch-offline.cjs review initialize
```

Ожидаются 4 успешных теста. Review должен показывать прежний тестовый admin
`5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk`, операцию `initialize`,
100000000 токенов, decimals 6, faucet 1000000, rewards 99000000,
`mintAuthorityAfter: null`, `freezeAuthorityAfter: null`, `scheduleApplied: false`.
Mint, nonce и genesis новые; их контрольные значения есть в `REVIEW-PINS.txt`
и локальном отчёте на рабочем ПК. Подпись проверяет точные инструкции и аккаунты,
а не доверяет описанию из request. Policy и signer всё равно требуют доверенного
переноса: хэш рядом с подменённым архивом сам по себе не удостоверяет источник.

```powershell
node .\launch-offline.cjs sign initialize --confirm-local-test
```

Верни **только** `work\result.initialize.json` на рабочий ПК в
`temp\offline-signer-launch-return\`. Файл результата не перезаписывается.
Не запускай старые команды live/nonce: они относятся к другим ledger и операциям.

## Следующие переносы

После finalized-проверки первого шага будет подготовлен `request.rewards.json`.
Его можно положить в тот же `work`, затем выполнить `review rewards` и
`sign rewards --confirm-local-test`. Этот шаг переводит оставшиеся 99 млн токенов
из admin ATA в reward vault; не переводит SOL publisher и не запускает майнинг.

Только после проверки резервов готовится `request.schedule.json`. Для него
`review schedule` показывает точные UTC-даты T0/T1/T2; `scheduleApplied: true`.
Проверить даты отдельно перед `sign schedule --confirm-local-test`.
Промежутки — один час и один час, это локальные тестовые даты, не объявление запуска.
Если запас до T0 меньше пяти минут, online-инструмент откажется отправлять.
Просроченное расписание требует нового согласованного policy и повторного review,
даже если nonce ещё действителен. Не менять поля request вручную.

## Границы проверки

- Подпись admin выполняется здесь. Для initialize второй signer — одноразовый mint
  account keypair на рабочем ПК; online проверяет обе подписи перед отправкой.
  Этот mint keypair после revoke не даёт права выпускать новые токены.
- Admin оплачивает комиссии и rent (в тесте получил локальные SOL). Отдельный
  deployment fee payer этим процессом не проверен.
- Каждый шаг использует свежепрочитанный nonce, первый instruction — advance.
  Nonce authority — offline admin. Предыдущий request после успеха не использовать.
- Online проверяет genesis, программу и её ELF, upgrade authority, nonce, исходное
  состояние, подписанную симуляцию и итоговые finalized-балансы/параметры.
- При неоднозначной отправке сначала `status`; повторной отправки автоматически
  нет. Не создавать новую подпись, не выяснив итог предыдущей.
- Durable nonce снимает короткий срок blockhash, но не отменяет проверку текущего
  состояния и будущего расписания. Удаление файла не отменяет подпись.
- Программа загружена в genesis локального validator с upgrade authority;
  настоящий upload/deploy программы через loader здесь не воспроизводится.
- Реальные mainnet-ключи, funding, публичное развёртывание и запуск не разрешены
  этим тестом. Mainnet signing tool требует отдельной подготовки и проверки.
