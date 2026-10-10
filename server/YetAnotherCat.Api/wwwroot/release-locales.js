export const releaseLocales = {
  en: {
    pitch: "Lock CATSHIT. The cat suffers. The chain settles.",
    intro:
      "A mobile Proof of Shit experiment on Solana. An increasingly unfortunate cat on your phone. Deterministic rewards you can verify on the chain.",
    kicker: "ANDROID / SOLANA MOBILE / DEVNET",
    download: "Download APK",
    source: "View source",
    explore: "Explore Shit Cycles",
    sceneAlt:
      "The working Android app: Yamc airborne in the worn containment chamber, with the SKR detector on the back wall.",
    sceneCaption: "Actual Android build. Actual cat problems.",
    clubAlt:
      "Nine Lives in the Android app: dancing meme cats, neon lighting and the same Yamc.",
    clubCaption: "Nine Lives · cosmetic room · same mining rate",
    closed: "The phone does not mine. The cat suffers independently.",
    downloadTitle: "A cat for your Android.",
    build: "Signed release · devnet demo · tested on a physical Android phone",
    install:
      "Install the APK, connect a Mobile Wallet Adapter compatible wallet such as Solflare, and select devnet. Allow installation from your browser when Android asks. Free devnet SOL covers transaction fees and account rent.",
    demo: "Includes clearly marked visual demo controls. These change the scene, never your stake or rewards.",
    releaseUnavailable:
      "Release metadata unavailable. The versioned APK link remains available; retry to load its checksum.",
    filename: "APK filename",
    version: "Version",
    size: "Download size",
    checksum: "SHA-256 checksum",
    installDetails: "Installation & checksum",
    devnet:
      "Current public build runs on Solana devnet. Real on-chain program and wallet approvals; test tokens, no promised monetary value.",
    stepsTitle: "Four steps. One unfortunate cat.",
    steps: [
      [
        "Get CATSHIT",
        "Tap I MISSED THE CAT in the app: 2,000 test CATSHIT per wallet, once, while the faucet reserve lasts.",
      ],
      [
        "Lock CATSHIT",
        "Approve a lock in your wallet. Your locked amount determines the cat’s tier and PP per second.",
      ],
      [
        "Go do something else",
        "Poop Points accrue from finalized Solana time, even with the app closed. Phone CPU does not mine.",
      ],
      [
        "Claim your share",
        "Each non-empty hourly cycle allocates 100,000 existing CATSHIT proportionally. Claim in the app with your wallet.",
      ],
    ],
    proofTitle: "Proof of Shit™. No phone treadmill.",
    proof:
      "Your tier’s rate × elapsed finalized chain time = Poop Points. Stake changes split that timeline into exact intervals. The app shows the result; animation does not create rewards. This is not proof-of-work.",
    continuity: [
      "Phone closed? Still accruing.",
      "App killed? Still accruing.",
      "Backend restarted? Replay the chain.",
    ],
    tiersTitle: "More CATSHIT. Less composure.",
    tierHeads: ["Rate · PP/s", "Cat state", "Locked CATSHIT ≥"],
    economicsTitle: "Fixed supply. Finite shit.",
    economyLabels: [
      "Total supply",
      "Initial faucet reserve",
      "Initial reward reserve",
      "Per non-empty hour",
      "Per wallet, once",
      "Empty-cycle emission",
    ],
    economics:
      "Mint authority: disabled. Freeze authority: disabled. The publisher allocates existing CATSHIT from a pre-funded vault; it cannot mint more. Rewards stop when the remaining uncommitted reserve cannot fund a cycle.",
    settlementTitle: "Your work. Your share.",
    formula: "100,000 CATSHIT × your cycle PP ÷ everyone’s cycle PP",
    rounding:
      "Integer arithmetic and deterministic largest-remainder allocation handle rounding. The on-chain ClaimReceipt prevents claiming the same cycle twice.",
    liveTitle: "Live devnet. Public receipts.",
    liveNote:
      "Read-only API snapshots, loaded once per visit. Refresh deliberately; no background polling. Chain time can lag wall-clock time.",
    refresh: "Refresh status",
    loading: "Loading public status…",
    unavailable: "Unavailable",
    stale:
      "Snapshot is stale or incomplete; inspect the explorer before relying on it.",
    observed: "Fetched",
    chainTime: "Finalized through",
    statusLabels: [
      "Current cycle",
      "Latest ended",
      "Latest published",
      "Latest verified",
      "Publication backlog",
      "API health",
      "Publisher health",
      "Reward vault balance",
      "Uncommitted reserve",
      "Latest publication check",
    ],
    statusNote:
      "Vault balance includes rewards already committed but not yet claimed. Latest verified is shown only when the latest publication has a complete VALID replay report. Publisher enablement is not exposed by the public API.",
    healthy: "Healthy",
    degraded: "Degraded",
    critical: "Critical",
    unknown: "Unknown",
    valid: "Valid",
    invalid: "Invalid",
    unverifiable: "Unverifiable",
    none: "None yet",
    verifyTitle: "Don’t trust the cat. Verify The Shit.",
    verify:
      "Replay finalized Solana history to check mining events, Poop Points, allocations, the manifest hash, Merkle root and on-chain cycle. The independent verifier does not use the accounting database as its source of truth.",
    verifyNote:
      "Public reports are cached, timestamped verification results. A green report is evidence of those checks, not an on-chain fraud proof. Full replay requires complete historical RPC data.",
    closedGate:
      "The configured publisher fails closed when independent verification cannot complete. It does not publish an unchecked settlement.",
    inspectTitle: "Inspect a miner",
    wallet: "Public Solana wallet address",
    inspect: "Inspect wallet",
    walletHint:
      "No connection or signature. See locked CATSHIT, tier, PP and claim history.",
    invalidWallet: "Enter a valid Solana wallet address.",
    architectureTitle: "The backend calculates. Solana settles.",
    lanes: [
      [
        "ON YOUR PHONE",
        [
          "Android app",
          "Mobile Wallet Adapter",
          "Wallet-signed devnet transactions",
          "MiningPosition · Cycle · ClaimReceipt",
        ],
      ],
      [
        "BEHIND EACH CYCLE",
        [
          "Finalized chain history",
          "Deterministic accounting",
          "Manifest + Merkle root → independent replay check",
          "On-chain cycle publication → wallet claim",
        ],
      ],
    ],
    rpc: "Primary RPC serves indexing and operational state. Verify RPC supplies independent chain replay. Neither the animated scene nor phone uptime is an accounting input.",
    trustTitle: "Publicly verifiable, not fully trustless.",
    trust:
      "The publisher is centralized. The program remains upgradeable and unaudited during the hackathon. A dishonest allocation can be detected by replay, but there is no on-chain challenge or fraud-proof mechanism. Fixed supply prevents minting; it does not prove fair allocation. The site, API and manifest storage currently share one VPS.",
    engineTitle: "Built for a phone. Unkind to a cat.",
    engine:
      "A native Android experience built with React Native: touch interactions, Mobile Wallet Adapter approvals, sound and real BONK haptics. A full animated chamber, tested on a physical device.",
    physics:
      "Cat Shit Engine uses fixed-step deterministic pseudo-physics: 2.5D thrust, wall collisions, squash and stretch. Your tier drives the visual state. The phone is the stage, not the miner.",
    skrTitle: "Hold SKR? The chamber has a secret.",
    skr: "The detector checks the connected wallet’s real SKR ownership on Solana mainnet. Look for 9♥: tap the neon cat nine times within four seconds to enter Nine Lives. Repeat to return.",
    cosmetic:
      "Music. Dancing cats. Same Yamc. Cosmetic only: no mining boost, no reward advantage, no SKR transfer. CATSHIT gameplay remains on devnet.",
    resourcesTitle: "Open the hood.",
    releaseDocs: "Release & API documentation (English)",
    resources: [
      "Architecture & trust",
      "Mining & settlement",
      "Independent verifier",
      "Canonical devnet",
      "Source / README",
    ],
    deployment: "Canonical devnet deployment",
    program: "Program",
    mint: "CATSHIT mint",
    built: "Built for Clock In — Solana Mobile Hackathon",
    description:
      "Yet Another Market Cat is a mobile Proof of Shit experiment on Solana: lock CATSHIT, mine Poop Points, and independently verify every settlement.",
  },
  ca: {
    pitch: "Bloqueja CATSHIT. El gat pateix. La cadena liquida.",
    intro:
      "Un experiment mòbil de Proof of Shit a Solana. Un gat cada cop més desgraciat al teu telèfon. Recompenses deterministes que pots verificar a la cadena.",
    kicker: "ANDROID / SOLANA MOBILE / DEVNET",
    download: "Descarrega l’APK",
    source: "Codi font",
    explore: "Explora els Shit Cycles",
    sceneAlt:
      "L’aplicació Android en funcionament: Yamc vola dins la cambra de contenció envellida, amb el detector SKR a la paret del fons.",
    sceneCaption: "Aplicació Android real. Problemes felins reals.",
    clubAlt:
      "Nine Lives a l’aplicació Android: gats de mems ballant, llums de neó i el mateix Yamc.",
    clubCaption: "Nine Lives · sala cosmètica · mateixa velocitat de mineria",
    closed: "El telèfon no mina. El gat pateix pel seu compte.",
    downloadTitle: "Un gat per al teu Android.",
    build:
      "Versió signada · demostració a devnet · provada en un telèfon Android físic",
    install:
      "Instal·la l’APK, connecta una cartera compatible amb Mobile Wallet Adapter, com ara Solflare, i selecciona devnet. Permet la instal·lació des del navegador quan Android ho demani. Els SOL gratuïts de devnet cobreixen les comissions i el dipòsit de lloguer dels comptes.",
    demo: "Inclou controls de demostració visual identificats clarament. Canvien l’escena, mai els tokens bloquejats ni les recompenses.",
    releaseUnavailable:
      "Les metadades de la versió no estan disponibles. L’enllaç a l’APK continua actiu; torna-ho a provar per carregar-ne la suma de verificació.",
    filename: "Nom del fitxer APK",
    version: "Versió",
    size: "Mida de la descàrrega",
    checksum: "Suma de verificació SHA-256",
    installDetails: "Instal·lació i suma de verificació",
    devnet:
      "La versió pública actual funciona a Solana devnet. Programa real a la cadena i aprovacions de la cartera; tokens de prova, sense cap valor monetari promès.",
    stepsTitle: "Quatre passos. Un gat desgraciat.",
    steps: [
      [
        "Aconsegueix CATSHIT",
        "Prem I MISSED THE CAT a l’aplicació: 2.000 CATSHIT de prova per cartera, una sola vegada, mentre quedi reserva a l’aixeta.",
      ],
      [
        "Bloqueja CATSHIT",
        "Aprova el bloqueig a la cartera. La quantitat bloquejada determina el nivell del gat i els PP per segon.",
      ],
      [
        "Ves a fer una altra cosa",
        "Els Poop Points s’acumulen segons el temps finalitzat de Solana, fins i tot amb l’aplicació tancada. La CPU del telèfon no mina.",
      ],
      [
        "Reclama la teva part",
        "Cada cicle horari no buit assigna proporcionalment 100.000 CATSHIT existents. Reclama’ls des de l’aplicació amb la cartera.",
      ],
    ],
    proofTitle: "Proof of Shit™. El telèfon pot descansar.",
    proof:
      "Velocitat del teu nivell × temps transcorregut finalitzat a la cadena = Poop Points. Els canvis en els tokens bloquejats divideixen aquesta línia temporal en intervals exactes. L’aplicació mostra el resultat; l’animació no crea recompenses. No és una prova de treball.",
    continuity: [
      "Telèfon tancat? Continues acumulant.",
      "Aplicació aturada? Continues acumulant.",
      "Servidor reiniciat? Es reconstrueix des de la cadena.",
    ],
    tiersTitle: "Més CATSHIT. Menys serenitat.",
    tierHeads: ["Velocitat · PP/s", "Estat del gat", "CATSHIT bloquejat ≥"],
    economicsTitle: "Oferta fixa. Merda finita.",
    economyLabels: [
      "Oferta total",
      "Reserva inicial de l’aixeta",
      "Reserva inicial de recompenses",
      "Per hora no buida",
      "Per cartera, un sol cop",
      "Emissió dels cicles buits",
    ],
    economics:
      "Autoritat d’encunyació: desactivada. Autoritat de congelació: desactivada. El publicador assigna CATSHIT existents d’una reserva finançada prèviament; no en pot crear més. Les recompenses s’aturen quan la reserva no compromesa ja no pot finançar un cicle.",
    settlementTitle: "La teva feina. La teva part.",
    formula: "100.000 CATSHIT × els teus PP del cicle ÷ els PP de tothom",
    rounding:
      "L’aritmètica entera i l’assignació determinista pel mètode de les restes més grans resolen l’arrodoniment. El ClaimReceipt a la cadena impedeix reclamar dues vegades el mateix cicle.",
    liveTitle: "Devnet en directe. Rebuts públics.",
    liveNote:
      "Instantànies de l’API de només lectura, carregades una vegada per visita. Actualització manual, sense consultes periòdiques en segon pla. El temps de la cadena pot anar endarrerit respecte del rellotge.",
    refresh: "Actualitza l’estat",
    loading: "S’està carregant l’estat públic…",
    unavailable: "No disponible",
    stale:
      "La instantània està desactualitzada o és incompleta; consulta l’explorador abans de basar-t’hi.",
    observed: "Consulta feta",
    chainTime: "Finalitzat fins a",
    statusLabels: [
      "Cicle actual",
      "Últim cicle acabat",
      "Últim publicat",
      "Últim verificat",
      "Cicles pendents de publicar",
      "Estat de l’API",
      "Estat del publicador",
      "Saldo de la reserva",
      "Reserva no compromesa",
      "Verificació de l’última publicació",
    ],
    statusNote:
      "El saldo inclou recompenses ja compromeses però encara no reclamades. Només es mostra l’últim cicle verificat si l’última publicació té un informe complet de reconstrucció VALID. L’API pública no exposa si el publicador està habilitat.",
    healthy: "Correcte",
    degraded: "Degradat",
    critical: "Crític",
    unknown: "Desconegut",
    valid: "Vàlid",
    invalid: "Invàlid",
    unverifiable: "No verificable",
    none: "Encara cap",
    verifyTitle: "No et refiïs del gat. Verify The Shit.",
    verify:
      "Reconstrueix l’historial finalitzat de Solana per comprovar els esdeveniments de mineria, els Poop Points, les assignacions, el hash del manifest, l’arrel de Merkle i el cicle a la cadena. El verificador independent no utilitza la base de dades comptable com a font de veritat.",
    verifyNote:
      "Els informes públics són resultats de verificació desats amb data i hora. Un informe verd acredita aquestes comprovacions; no és una prova de frau a la cadena. La reconstrucció completa necessita l’historial íntegre de l’RPC.",
    closedGate:
      "El publicador configurat atura la publicació si no pot completar la verificació independent. No publica una liquidació sense verificar.",
    inspectTitle: "Inspecciona un miner",
    wallet: "Adreça pública de la cartera Solana",
    inspect: "Inspecciona la cartera",
    walletHint:
      "Sense connexió ni signatura. Consulta CATSHIT bloquejats, nivell, PP i historial de reclamacions.",
    invalidWallet: "Introdueix una adreça de cartera Solana vàlida.",
    architectureTitle: "El servidor calcula. Solana liquida.",
    lanes: [
      [
        "AL TEU TELÈFON",
        [
          "Aplicació Android",
          "Mobile Wallet Adapter",
          "Transaccions a devnet signades amb la cartera",
          "MiningPosition · Cycle · ClaimReceipt",
        ],
      ],
      [
        "DARRERE DE CADA CICLE",
        [
          "Historial finalitzat de la cadena",
          "Comptabilitat determinista",
          "Manifest + arrel de Merkle → reconstrucció independent",
          "Publicació del cicle a la cadena → reclamació",
        ],
      ],
    ],
    rpc: "L’RPC principal serveix la indexació i l’estat operatiu. L’RPC de verificació proporciona la reconstrucció independent. Ni l’escena animada ni el temps d’ús del telèfon intervenen en la comptabilitat.",
    trustTitle: "Verificable públicament, amb dependències de confiança.",
    trust:
      "El publicador és centralitzat. El programa continua sent actualitzable i no auditat durant la hackató. Una assignació deshonesta es pot detectar reconstruint l’historial, però no hi ha cap mecanisme d’impugnació ni prova de frau a la cadena. L’oferta fixa impedeix crear tokens; no demostra que l’assignació sigui justa. El web, l’API i l’emmagatzematge de manifests comparteixen actualment un únic VPS.",
    engineTitle: "Pensat per al mòbil. Despietat amb el gat.",
    engine:
      "Una experiència Android nativa feta amb React Native: interaccions tàctils, aprovacions amb Mobile Wallet Adapter, so i vibració real amb BONK. Una cambra plenament animada, provada en un dispositiu físic.",
    physics:
      "Cat Shit Engine utilitza pseudofísica determinista de pas fix: impuls en 2,5D, col·lisions amb parets, aixafament i estirament. El nivell determina l’estat visual. El telèfon és l’escenari, no el miner.",
    skrTitle: "Tens SKR? La cambra amaga un secret.",
    skr: "El detector comprova que la cartera connectada tingui SKR reals a Solana mainnet. Busca el 9♥: toca el gat de neó nou vegades en quatre segons per entrar a Nine Lives. Repeteix-ho per tornar.",
    cosmetic:
      "Música. Gats que ballen. El mateix Yamc. Només cosmètic: cap augment de mineria, cap avantatge en les recompenses, cap transferència de SKR. El joc amb CATSHIT continua a devnet.",
    resourcesTitle: "Mira què hi ha dins.",
    releaseDocs: "Documentació de la versió i de l’API (anglès)",
    resources: [
      "Arquitectura i confiança",
      "Mineria i liquidació",
      "Verificador independent",
      "Devnet canònica",
      "Codi font / README",
    ],
    deployment: "Desplegament canònic a devnet",
    program: "Programa",
    mint: "Mint de CATSHIT",
    built: "Creat per a Clock In — Solana Mobile Hackathon",
    description:
      "Yet Another Market Cat és un experiment mòbil de Proof of Shit a Solana: bloqueja CATSHIT, acumula Poop Points i verifica independentment cada liquidació.",
  },
};
