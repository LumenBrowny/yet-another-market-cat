# Demo recording plan — Task 017

Candidate: **Android 0.13.4 (26), Solana devnet**. Prepared 2026-10-10. This is a recording/editing plan, not a completed video. Product code and deployment are unchanged.

**Full cut: 02:38. Minimal fallback: 02:20. Hard limit: 03:00.** English narration and captions; Russian operating instructions below. Speak calmly, without an announcer voice. The joke needs no emphasis.

Full narration: **305 words**, about **2:21 of speech at 130 words/min** within the 2:38 edit. Minimal: **174 words**, about **1:20 of speech**, leaving more room for product sound and visual evidence in the 2:20 cut. Counts use whitespace-delimited words, excluding headings, overlays and fallback variants. The densest full segment needs 135 words/min. A reading copy is in [demo-voiceover-017.txt](demo-voiceover-017.txt).

> Lock CATSHIT. The cat suffers. The chain settles.

Supporting description: Yet Another Market Cat is a mobile Proof of Shit experiment on Solana. Lock CATSHIT, earn Poop Points from finalized chain time, and independently verify every settlement.

## Locked edit / full narration

Read the narration cells verbatim, in order. Labels and overlay text are not spoken. A–H identify source recordings in the capture runbook. Each interval includes room for cuts and pauses; actual recorded delivery must be measured before export.

| Time | Visual | Narration | Overlay | Source |
|---|---|---|---|---|
| 00:00–00:10 | Actual active chamber, immediate movement and coins; no intro animation. | Lock CATSHIT. The cat suffers. The chain settles. This is Yet Another Market Cat, built for Android and Solana. | Yet Another Market Cat · DEVNET | A |
| 00:10–00:30 | Connected wallet, locked amount, tier and PP rate; use a readable detail crop. | You lock CATSHIT on Solana through Mobile Wallet Adapter. Your on-chain MiningPosition records the lock; the amount sets your tier and Poop Point rate. One thousand locked tokens starts at one point per second. This is not phone CPU mining. The phone displays the consequences. | On-chain custody · 1 PP/sec × tier | B |
| 00:30–00:48 | CALM → AIRBORNE → TRANSCENDENT, then one BONK. Keep preview label visible. | Higher tiers make the Cat Shit Engine increasingly unreasonable: thrust, collisions, coins, sound and haptics. These preview controls demonstrate the animation without changing my actual stake. The real tier comes from the chain. | Visual preview — stake unchanged | A, preview take |
| 00:48–01:08 | Finalized PP before, dismiss app, clearly labelled elapsed-time cut, reopen and finalized PP after. | Poop Points accrue from finalized Solana time, even with the app closed. No background mining process needs to stay running. Here are the finalized points before closing and after reopening. The wait is cut from this recording; the elapsed time is shown. | App closed · [measured wait] elapsed; before/after finalized PP | C |
| 01:08–01:28 | CYCLES → chosen completed cycle; show reward and allocation, then claim button. | Each hour is a Shit Cycle. Non-empty cycles allocate one hundred thousand CATSHIT from a finite reserve, proportionally to points earned that hour. Empty cycles allocate zero. This reward is already published on Solana and ready to claim. | 1 hour · 100,000 CATSHIT / non-empty cycle | D |
| 01:28–01:38 | CLAIM CATSHIT → actual Solflare approval → confirmed claim and balance. Label confirmation time cut. | I approve the claim in my wallet. A Merkle proof authorizes payment, and a permanent ClaimReceipt prevents claiming twice. | MWA → confirmed claim | D |
| 01:38–01:58 | Public cycle page → Verify The Shit → VALID; show report time and matching roots. | Verify The Shit independently replays finalized Solana history, recomputes points and rewards, and checks the manifest and Merkle root against the chain. The accounting database is not its source of truth. This page displays the saved verification report. | Independent replay · saved report + timestamp | E |
| 01:58–02:08 | Readable public trust section, simple cut. | Supply is fixed. The publisher cannot mint more tokens. This deployment has a centralized publisher and an upgradeable program. | Publicly verifiable, not fully trustless | F |
| 02:08–02:28 | Return to actual chain tier, neon cat / 9♥, nine taps within four seconds, club reveal. | The same wallet is checked for real SKR on mainnet, read-only. Holders unlock a secret cat club. Nine taps. Nine lives. Cosmetic only: SKR is never spent and gives no mining advantage. | 9♥ · 9 taps / 4 seconds · cosmetic only | G |
| 02:28–02:38 | Strong moving club frame; end with readable website for at least four seconds. | Yet Another Market Cat. The backend calculates the shit. Solana settles it. Try the Android app at yetanothermarket dot cat. | yetanothermarket.cat · Android · Public source · Devnet | H |

Claim fallback, only if no clean claim is available: replace the final sentence of 01:08–01:28 with **“Published rewards can be claimed through the connected wallet.”** At 01:28–01:38 show the real existing claim state and say **“Claims use a Merkle proof against the published root. A permanent ClaimReceipt prevents claiming twice. This is the current claim state.”** Overlay: **“Claim state — no new transaction in this take.”** Do not stage a successful claim.

## Minimal narration / 02:20 fallback

Use these exact intervals and lines instead of compressing the full voiceover. The recording sources and truthfulness requirements are the same.

| Time | Narration | Visual / overlay change |
|---|---|---|
| 00:00–00:08 | Lock CATSHIT. The cat suffers. The chain settles. Yet Another Market Cat, on Android. | A; same opening overlay |
| 00:08–00:26 | Lock CATSHIT on Solana through Mobile Wallet Adapter. Your on-chain lock determines the Poop Point rate. This is not phone CPU mining. | B; same custody/rate overlay |
| 00:26–00:42 | Higher tiers bring thrust, collisions, sound and haptics. This is a visual preview; my stake is unchanged. | A preview; preserve preview label |
| 00:42–01:00 | Points accrue from finalized chain time while the app is closed. Compare the finalized totals. The elapsed wait is shown. | C; same measured-wait overlay |
| 01:00–01:18 | Hourly cycles share one hundred thousand CATSHIT from a finite reserve, in proportion to points. Empty cycles allocate zero. | D; same cycle overlay |
| 01:18–01:28 | Approve in the wallet. A Merkle proof authorizes payment; a permanent receipt prevents double claims. | D; confirmed claim, or fallback below |
| 01:28–01:48 | Verify The Shit replays finalized Solana history independently of the accounting database, recomputing points, rewards and the Merkle root. Here is the saved VALID report. | E; timestamp stays visible |
| 01:48–01:58 | Fixed supply. Centralized publisher. Upgradeable program. Publicly verifiable, not fully trustless. | F; trust section |
| 01:58–02:12 | Mainnet SKR ownership unlocks Nine Lives. Nine taps in four seconds. Read-only, cosmetic only, no spending or mining advantage. | G; same gesture overlay |
| 02:12–02:20 | Yet Another Market Cat. The backend calculates the shit. Solana settles it. | H; website remains visible |

Minimal claim fallback: **“Claims use a Merkle proof and a permanent receipt prevents double claims. This is the current claim state.”** Show the fallback overlay from the full cut.

## Preflight: фиксируем состояние перед записью

1. Использовать физический Android с публичным [APK 0.13.4](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.4.apk), тот же кошелёк Solflare. Не переустанавливать приложение ради съёмки. Проверить DEVNET и версию; SKR отдельно читается на mainnet.
2. Включить «Не беспокоить», закрыть посторонние приложения, зарядить телефон минимум до 50%. Разблокировать кошелёк до записи. PIN, seed, уведомления и чужие аккаунты в кадр не включать. Для физического подтверждения устройства снять также 3–5 секунд телефона рукой/другой камерой, если доступна; основной материал — screen capture именно этого телефона.
3. В DEMO / PHYSICS нажать USE CHAIN, RESET SHADOW (0), скрыть anchors, затем HIDE DEBUG. Комната включена; обычный актуальный фон. SOUND ON и HAPTICS ON проверить коротким BONK. Для большей части дублей звук можно выключить, отдельно записав эффекты.
4. Проверить [API health](https://yetanothermarket.cat/api/health): healthy, indexer и publisher healthy. Проверить свежесть finalized PP, отсутствие stale/RPC ошибок, баланс devnet SOL для комиссии и rent claim receipt. Не менять stake и не запрашивать faucet ради картинки.
5. Записать в локальный capture log: время UTC, версию APK, locked amount, реальный tier/rate, выбранный cycle, claimable amount, balance before, статус SKR. Не копировать приватные RPC URL или ключи. Пример на момент подготовки: 50,000 locked, AIRBORNE, 8 PP/sec; это снимок, не обещание будущего состояния.
6. Открыть CYCLES → COMPLETED CYCLES. Выбрать **#329** как основной кандидат, проверить доступность CLAIM CATSHIT и награду именно подключённого кошелька. При необходимости OLDER CYCLES. Если уже claimed, выбрать самый новый опубликованный claimable цикл с VALID и записать номер; заменить его во всех браузерных дублях. Если такого нет, использовать claim fallback, а для verifier оставить #329.
7. Открыть браузер без авторизации, приватных вкладок и закладок: [циклы](https://yetanothermarket.cat/cycles?lang=en), [цикл 329](https://yetanothermarket.cat/cycles/329?lang=en), [verifier 329](https://yetanothermarket.cat/verify/329?lang=en), [trust](https://yetanothermarket.cat/trust?lang=en). Дождаться полной загрузки, выбрать English. Номер заменить только по шагу 6.
8. На момент подготовки API здоров, отчёт #329 — VALID, `chainRecomputation: true`, verifiedAt **2026-10-10T08:06:48.673Z**, оба root совпадают. Это проверено чтением публичного API; новый полный replay для этой задачи не запускался. Перед съёмкой повторить проверку статуса и времени отчёта.
9. Проверить SKR detector с USE CHAIN: вход по девяти нажатиям на неонового кота за четыре секунды. Не использовать принудительный visual override как доказательство владения SKR. Девять повторных нажатий возвращают комнату. Проверить club SOUND ON/OFF; вернуться в комнату для дубля A.

## Capture runbook: отдельные исходники A–H

Папка исходников локально: `temp/demo-017/`. Она не предназначена для GitHub. Имена ниже — будущие файлы, пока не созданы. Не пытаться уложить реальные загрузки/кошелёк в хронометраж одним дублем. Держать каждый важный экран неподвижно 3–5 секунд до и после действия.

| Clip | Точные действия и условия | Запас исходника / дублей |
|---|---|---|
| A — `A-chamber`, `A-preview` | USE CHAIN → HIDE DEBUG: активный кот и монеты. Отдельно DEMO / PHYSICS → CALM → AIRBORNE → TRANSCENDENT → TRIGGER BONK, HAPTICS ON / SOUND ON. Надпись VISUAL DEMO ONLY оставить в кадре либо постоянно дублировать overlay. Затем USE CHAIN → HIDE DEBUG. | 20 секунд обычной комнаты × 2; 30 секунд preview × 2 |
| B — `B-wallet-tier` | Связанный кошелёк, текущий balance, locked amount, rate и PP; медленно прокрутить, задержаться на каждом блоке. Ничего не подписывать и не менять stake. | 30–40 секунд, один дубль |
| C — `C-offline-continuous` | В обычном режиме снять строку **“PP finalized”** под LIFETIME PP. Зафиксировать точное значение и время. Уйти Home, открыть recent apps и убрать YAMC. Записывать непрерывно реальное ожидание **60 секунд** на домашнем экране без уведомлений; снова открыть YAMC, дождаться свежего **PP finalized**. Сохранить непрерывный исходник и оба snapshot из `/api/miners/<DEMO_WALLET>/accounting` до/после в локальный log. | Около 90–120 секунд; один непрерывный доказательный дубль |
| D — `D-cycle`, `D-claim` | Верхняя CYCLES прокручивает к панели. COMPLETED CYCLES → выбранный номер → снять allocation/reward. Если claimable и владелец готов: записать balance before → CLAIM CATSHIT → владелец подтверждает в Solflare → вернуться → дождаться CLAIMED и обновлённого balance. Сохранить signature и balance after локально. Ускорение/вырезание ожидания обозначить. | 20 секунд cycle + до 90 секунд реального claim; **успешный claim не повторять ради дубля** |
| E — `E-verifier` | Public `/cycles?lang=en` → тот же cycle → Verify The Shit. Крупно снять VALID, время отчёта, chain recomputation и root/hash. Если всё не помещается, спокойная прокрутка с паузой. Не утверждать, что открытие страницы запускает replay. | 30–40 секунд × 2 |
| F — `F-trust` | `/trust?lang=en`: фиксированная supply, централизованный publisher, upgradeable program. Крупный читаемый фрагмент, без терминала. | 15 секунд |
| G — `G-nine-lives` | USE CHAIN, обычная комната, 9♥ и активный неоновый кот. Записать девять реальных нажатий за четыре секунды и 15 секунд клуба. SOUND ON на reveal, потом SOUND OFF для проверки. Вернуться тем же жестом, повторить удачный reveal. | 25 секунд × 2 |
| H — `H-ending` | В клубе USE CHAIN, скрытые debug controls, чистый движущийся кадр; website добавляется на монтаже. | 15 секунд × 2 |

Для C: overlay должен содержать **измеренный интервал закрытого приложения**, а не заранее напечатанное «60 seconds», если получилось иначе. При неизменном stake прирост точных PP должен соответствовать rate × разности finalized timestamps; реальное время закрытия и finalized-time delta могут отличаться из-за индексации. Сравнивать целые `pointUnits` (1000 units = 1 PP), не только плавный локально интерполируемый счётчик. Если snapshot stale, дождаться актуального и переснять. Не говорить “app killed” или “backend restarted” по записи одного Home: данный дубль подтверждает закрытое приложение; восстановление из chain — свойство архитектуры, не снятый эксперимент с рестартом сервера.

Для D: подпись делает владелец. Нет необходимости в новом lock/faucet, переводе SKR или изменении deployment. Если кошелёк/сеть тормозят, снимать длинный исходник и честно сокращать ожидание. Не заменять transaction confirmation заранее приготовленным чужим экраном. При fallback убрать из голоса “I approve” и “ready to claim”.

## Компоновка, звук, титры и экспорт

- Монтаж **1920×1080, 16:9, 30 fps**. Портретный телефон сохраняет пропорции: запись 1080×2400 при высоте 940 занимает примерно 423 пикселя по ширине. Чистый тёмный фон, по бокам короткие пояснения. Числа wallet/PP/cycle показывать отдельным увеличенным фрагментом того же дубля; весь телефон в таком масштабе слишком мелок для чтения. Не обрезать preview-маркер так, чтобы скрыть симуляцию.
- Браузер снимать в 1920×1080; увеличить страницу до читаемого VALID и root labels. Полный hash вслух не читать. На 720p должен читаться смысл статуса и совпадения; полный root доступен по ссылке.
- Простые склейки; никаких заставок на 20 секунд, generic glitch или презентации вместо приложения. Физический Android — основной источник. Haptics обозначить титром: вибрацию screen capture передать не может.
- Голос записать отдельно; примерно 125–140 слов/мин, без спешки. На club reveal оставить короткую паузу и музыку. У effects/music под голосом снизить уровень примерно на 12–18 dB относительно голоса; итог без clipping, ориентир около −16 LUFS stereo и true peak ≤ −1 dBTP. Это монтажные ориентиры, проверять на слух и телефоне.
- Использовать только существующий CC0 club loop, см. [music credits](../app/assets/room-skr-club/MUSIC-CREDITS.md). Не возвращать прежний Lets Groove. Android screen capture может не содержать внутренний звук: проверить тестовый файл; при необходимости использовать текущие ассеты, синхронизированные с реальными событиями, не добавлять фиктивные реакции UI.
- Сделать точные английские captions по **фактически записанному** голосу, максимум две строки, крупный контрастный шрифт (ориентир 44–52 px в 1080p), safe margin 60 px. Сохранить отдельный SRT; можно вжечь captions в экспорт. Термины CATSHIT / Poop Points / Merkle / SKR проверять вручную. Captions не должны перекрывать PP, CLAIM или VALID. Overlay — короткая подпись, не дубликат абзаца голоса.
- MP4, H.264, yuv420p, AAC 48 kHz, 1080p30, ориентир видео 8–12 Mbps / audio 160–192 kbps, faststart. Не интерполировать в 60 fps. Финальный `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,pix_fmt -of json final-demo.mp4`: **≤180 секунд**, предпочтительно 158. Указанный хронометраж сейчас плановый, не измеренный рендер.

## Контроль перед экспортом и после публикации

- [ ] A–H сняты; в кадре настоящая версия 0.13.4, actual chain / preview различимы.
- [ ] C содержит настоящий непрерывный исходник, до/после finalized PP и честный wait overlay.
- [ ] Claim подтверждён собственным receipt/signature и балансом, либо использованы обе fallback-реплики.
- [ ] Цикл одинаков в D/E; либо различие явно подписано. Отчёт VALID сохранён с исходным timestamp.
- [ ] DEVNET не скрыт; SKR mainnet отделён от devnet CATSHIT. Нет заявлений про SKR staking/reward boost.
- [ ] Английский голос и captions совпадают; нет устаревших пяти минут/пяти нажатий, “fully trustless” или “Open Source”. Код публичен, но лицензия пока не выбрана.
- [ ] Телефон и браузер читаемы после уменьшения до 720p; нет private tabs, PIN, ключей или операторских страниц.
- [ ] Звук в наушниках и динамике телефона проверен; club не заглушает голос, SOUND OFF не сопровождается ложным игровым звуком.
- [ ] Измеренный runtime ≤180 s; первые 30 секунд объясняют Android, lock, Solana и отсутствие CPU mining.

План размещения: после готового экспорта опубликовать MP4 на существующем публичном сайте по **`https://yetanothermarket.cat/demo/yamc-demo-0.13.4.mp4`**. Это **зарезервированный в плане путь, файла ещё нет**, не вставлять его в форму как готовую ссылку. При фактическом размещении проверить `video/mp4`, поддержку Range/seek, размер, SHA-256 и отсутствие авторизации; не затронуть APK или API. Если платформа формы требует видеохостинг, использовать публичный либо доступный по ссылке YouTube upload вместо MP4 и проверить без входа.

- [ ] После upload ссылка открывается в incognito на ПК и телефоне, начинается playback, работает перемотка, звук и captions, доступно 1080p.
- [ ] Нет срока действия/ограничения аккаунтом. Смотреть опубликованную версию целиком, не только локальный файл.
- [ ] Заменить TODO видео в [submission draft](submission-draft-017.md) только проверенным URL; отдельно подготовить deck. Ничего автоматически не отправлять.

## Claims audit / источники для редактора

| Утверждение | Основание и точная граница |
|---|---|
| MWA, on-chain custody / MiningPosition | [Architecture](architecture.md), `app/src/App.tsx`, программа: кошелёк подписывает lock/withdraw/claim. Подключение само по себе ничего не переводит. |
| Offline PP | [Protocol](protocol.md), `server/YetAnotherCat.Infrastructure/Snapshots.cs`, `app/src/AccountingPanel.tsx`: finalized event intervals; local interpolation — только display. Backend/RPC могут временно отставать. |
| 1 hour, 100,000 | [Protocol](protocol.md): non-empty cycle, existing finite reserve; empty = zero. Не бесконечная эмиссия и не реальная доходность. |
| Fixed supply | 100 million, mint/freeze authorities disabled; publisher распределяет существующий запас. Это не гарантия честной allocation. |
| Claim | Опубликованный Merkle root + proof + permanent ClaimReceipt. Proof membership не доказывает правильность off-chain PP; это отдельная задача replay. |
| Independent verifier | [Verification](verification.md): finalized history replay без accounting DB; доступность истории RPC существенна. Public UI показывает cached report, не выполняет полный replay при каждом открытии. |
| Trust | [Release limits](release-0.13.4.md): centralized publisher, upgradeable unaudited **program**, no on-chain fraud-proof challenge. Не “upgradeable publisher”. |
| SKR | Same wallet, read-only mainnet ownership, 9 taps / 4 s, cosmetic; no spend/transfer/staking/reward boost. |
| Mobile polish | `app/src/CatScene.tsx` и текущий physical-device acceptance; не обещать одинаковый fps на любом устройстве. |

## Rubric, deck и последующие проверки

| Категория (по 25% в сохранённом brief) | Доказательство в ролике |
|---|---|
| Stickiness / product-market fit | B/C/D: progression, возвращение к PP и cycles; G: discovery. Это механики удержания, **не доказанная аудитория/traction**. |
| User experience | A/B/D: читаемый state, wallet flow, звук/haptics/анимация на телефоне. |
| Innovation / X-factor | A/C/E/G: Proof of Shit, Cat Shit Engine, replay, Nine Lives. |
| Presentation / demo | Немедленный продукт, одно доказательство каждые 10–20 секунд, читаемые титры и ссылки. |

Будущий deck: 1) premise/joke, 2) Android experience, 3) lock → PP → hourly rewards, 4) Solana custody/claims, 5) replay + trust limits, 6) mobile polish + SKR, 7) vision + public links. Это только outline, deck не создан.

**AI Coach не запускался.** Следующий порядок: утвердить voiceover → закончить deck → заполнить все поля формы → собственная сверка фактов/ссылок → текущая версия AI Coach → сохранить feedback отдельно → принять только обоснованные изменения.

**Одноразовый внешний security audit не запускался.** Перед ним:

- [ ] Зафиксировать окончательный release commit/tag и APK digest; убедиться, что planned code changes отсутствуют.
- [ ] Green CI, чистая tracked working tree, правильный public repo и соответствие APK/source/release metadata.
- [ ] Собственная security review завершена, secret scan чист; dependency advisories разобраны и оставшиеся ограничения явно описаны. Gitleaks/source hygiene из Task 016 **не заменяют** security audit.
- [ ] Проверить [известные dependency findings](repository-release-hygiene-015.md); не называть их устранёнными без нового подтверждения.
- [ ] Только после freeze использовать внешний audit и сохранить его результат; при исправлениях снова проверить затронутую часть.

Из сохранённого организаторского brief: deadline **12 октября 2026, 14:59 GMT+3**. Это значение из локальной копии, перед отправкой сверить с живой формой. Не откладывать готовый video/deck до последнего часа.

## Что потребуется от автора

1. Подтвердить funding, дату начала/предшествующие разработки и прошлые победы; прислать точные вопросы 5/6, если их формулировки отличаются от рабочего описания в задании.
2. Прочитать английский сценарий и выбрать голос: собственная запись по TXT либо отдельно согласованная синтетическая озвучка. По умолчанию монтаж планируется с полной версией 02:38.
3. На этапе съёмки подключить и разблокировать телефон, включить «Не беспокоить»; для единственного claim самому подтвердить транзакцию в кошельке. Съёмку экрана телефона и браузера можно выполнять через рабочее окружение — записывать всё вручную автору не обязательно.
4. После готовности ролика и deck проверить окончательные материалы/ответы и отправить заявку. Запись, монтаж, deck, AI Coach и внешний audit — последующие шаги, не выполненные артефакты этого задания.
