# Прямой локальный deployment с offline authority — v6

Только локальный validator и прежний одноразовый test admin. Mainnet не используется.
Node.js достаточно; зависимости собраны в CJS, npm install не нужен.

## Первый перенос: принять buffer

Распакуй ZIP в новую папку на отдельном ПК. Из прежнего комплекта скопируй внутри
offline ПК в новый `work` файлы `identity.public.json` и `TEST-ONLY-PRIVATE-KEYS.json`.
Приватный файл не возвращается на подключённый ПК.

```powershell
node .\direct-self-test.cjs
node .\direct-offline.cjs review accept-buffer
node .\direct-offline.cjs sign accept-buffer --confirm-local-test
```

Ожидаются 3 успешных теста. При review: operation `accept-buffer`, admin
`5Kgy6TMeTAhyZZNPdhgEkRkGKw5riMgFZoqyGtFi9Cjk`, RPC `http://127.0.0.1:9033`.
Эта операция только передаёт buffer от загрузочного ключа к offline admin.
Программа и Config всё ещё отсутствуют. Signer проверяет точные байты сообщения;
в нём только nonce advance и checked-передача buffer authority.

Верни **только** `work\result.accept-buffer.json` в
`temp\offline-signer-direct-return\`.

## Второй перенос: создать программу

После finalized-подтверждения первого шага подключённый ПК повторно сверит весь
ELF в buffer и его authority. Только тогда подготовит `request.deploy.json`.
Скопируй его в тот же `work` и выполни:

```powershell
node .\direct-offline.cjs review deploy
node .\direct-offline.cjs sign deploy --confirm-local-test
```

Этот шаг содержит nonce advance, фиксированный compute limit, создание Program
account и DeployWithMaxDataLen. Первой upgrade authority будет offline admin.
Плата/rent — с отдельного test payer; подпись Program keypair добавится online.
Верни только `result.deploy.json` в ту же return-папку.

В комплекте первого переноса запроса deploy ещё нет. Не создавать его вручную,
не повторять команды v4/v5 и не переиспользовать использованные requests.

## Проверки и ограничения

Online driver проверяет genesis, отсутствие программы до deploy, nonce/authority,
точное содержимое и owner buffer, signed simulation и finalized-состояние.
После deploy проверяет executable Program, ProgramData, admin и точный ELF,
погашенный buffer и отсутствие Config. Две стадии подписываются отдельно;
после принятия buffer прежний загрузочный ключ больше не его authority.

Бинарник в этом тесте — 608160 байт, SHA256:
`f7ef04491f0abfc00d38777441482a08f2e244b6e55eb78583367ab55debc5cd`.
Хэш — проверяемое online условие, **не условие loader instruction**.
Нужно доверять review-инструментам/переносу и проверить ELF независимо перед
реальным запуском. При расхождении после принятия buffer deployment не продолжать.
В offline CLI нет загрузки ELF, компиляции или самостоятельной проверки сети.

Program ID из предыдущих локальных тестов используется для совместимости с ELF;
это не выбор будущего mainnet ID. Полномочия не отзываются, программа upgradeable.
Config, эмиссия токенов, резервы и расписание сюда не входят.
`punycode` DeprecationWarning не мешает подписи; ожидается `LOCAL_DIRECT_SIGNED`.

При неизвестном результате online сначала проверяет status и не делает автоматический
повтор. Удаление файла не отменяет подпись. Новый mainnet signer/profile, новые ключи,
верифицируемая сборка и production ceremony потребуют отдельной подготовки.
