# YAMC — репетиция офлайн-подписи, v1

Только одноразовые тестовые ключи. Это НЕ программа для mainnet signing.
Нет сетевых вызовов, отправки транзакций, npm-зависимостей или установки пакетов.
Нужен Node.js 24. Комплект работает из обычного PowerShell без администратора.

## Подготовка

1. Перенести ZIP на отдельный компьютер и распаковать в `C:\YAMC-Signer`.
   `signer.mjs`, `self-test.mjs` и эта инструкция должны быть в одной папке.
2. Отключить Wi-Fi и Ethernet. Не помещать папку в OneDrive/облачную синхронизацию.
3. Открыть PowerShell в этой папке:

```powershell
cd C:\YAMC-Signer
node --version
node --test .\self-test.mjs
```

Ожидается 4 успешных теста, 0 failures. `npm install` не нужен.

## Создать тестовые ключи

```powershell
node .\signer.mjs init
```

Появится папка `work`:

- `TEST-ONLY-PRIVATE-KEYS.json` — два НОВЫХ одноразовых ключа, только для теста.
  Этот файл остаётся на отдельном компьютере; не отправлять, не переносить на VPS,
  не пополнять эти адреса. Он не зашифрован; на Windows безопасность файла зависит
  от NTFS ACL/защиты диска. Это не формат хранения будущих production-ключей.
- `identity.public.json` — публичные адреса тестовых подписантов.
- `request.unsigned.json` — неподписанное тестовое сообщение.

Повторный `init` откажется перезаписывать существующую `work`. Если нужна новая
репетиция, распаковать комплект в отдельную новую папку; старые данные не заменять.

## Посмотреть и подписать

```powershell
node .\signer.mjs review
```

Проверить:

- warning содержит `TEST ONLY / INVALID ZERO BLOCKHASH / NO NETWORK / NO REAL FUNDS`;
- instruction — `rotateFaucetIssuer`, instructionCount — 1, requiredSignatures — 2;
- programId — `BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW`;
- config — `8npimHwcND7YyrmSgoXet7MUAUfg2oCSpZp7uV8L4ASD`;
- admin и incomingIssuer совпадают с `identity.public.json`;
- recentBlockhash — `11111111111111111111111111111111`.

Адрес программы здесь взят из текущего IDL только для проверки формата инструкции.
Это НЕ выбранный mainnet deployment. Текущее состояние программы/RPC не проверяется.

```powershell
node .\signer.mjs sign --confirm-test-only
node .\signer.mjs verify
```

Ожидается `SIGNATURES_VALID_TEST_ONLY`. Появится `work\result.signed.json`.
Повторное подписание откажется перезаписывать этот результат.

## Что вернуть на рабочий компьютер

Скопировать на флешку ТОЛЬКО:

```text
identity.public.json
request.unsigned.json
result.signed.json
```

Положить их на рабочем компьютере в
`D:\Code\yet-another-cat\temp\offline-signer-return\` и сообщить о готовности.
Приватный файл НЕ переносить. Интернет на отдельном компьютере для этих действий
не нужен; приватные ключи или seed-фразы присылать в чат нельзя.

## Что этот тест доказывает и чего не доказывает

Проверяются работа Node/Ed25519 на Windows, точное сообщение, две подписи и перенос
публичного результата. Signer принимает только заранее определённую форму операции;
другие accounts/instructions/blockhash отвергаются. Подписи настоящие, но blockhash
нулевой и непригоден для исполнения. Комплект ничего не отправляет и не принимает
ключи от настоящего кошелька через CLI.

Это не проверка живой ротации, не подтверждение текущего admin/issuer и не измерение
времени до истечения blockhash. Такие проверки будут отдельной репетицией с локальным
validator и свежим blockhash после этого теста. Production signing, durable nonce,
зашифрованное хранение ключей и инициализация mainnet этим комплектом не реализованы.

SHA-256 архива сравнивать с хешем, полученным отдельно на рабочем компьютере:

```powershell
Get-FileHash .\yamc-offline-rehearsal-v1.zip -Algorithm SHA256
```

Хеш обнаруживает повреждение/подмену при переносе только если сама ожидаемая строка
получена из доверенного источника. Файл хеша рядом с ZIP сам по себе этого не гарантирует.
