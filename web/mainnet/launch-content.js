import { copy } from './content.js';

Object.assign(copy.en, {
  draft: 'MAINNET PLAN · NOT DEPLOYED',
  tokenCopy: '100 million tokens. A small starting faucet, a finite reward reserve, and daily allocations you can verify.',
  tokenLink: 'Explore the distribution',
  tokenLead: '100 million tokens, split between the starting faucet and participation rewards. Mainnet addresses and launch dates are not published yet.',
  emissionCopy: '250,000 CATSHIT are allocated per nonempty daily cycle. The 99 million reserve funds 396 nonempty cycles, roughly 13 months at one per day. Empty cycles spend no allocation and extend the calendar. Your share depends on your share of the cycle’s Poop Points; it is not a fixed payout per wallet.',
  faucetCopy: 'The faucet contains 1,000,000 CATSHIT: up to 1,000 allocations of 1,000 tokens. Wave 1 is for eligible Seeker Genesis Token holders. Wave 2 opens remaining allocations to other eligible wallets on a first-come, first-served basis. The two waves share one reserve; no separate Wave 2 allocation is guaranteed. Completing a check does not reserve tokens.',
  vestingTitle: 'Where the supply goes',
  vestingCopy: 'The selected allocation is 1% faucet and 99% rewards, with no separate team, treasury or vesting bucket. The mainnet mint and authorities must still be published and verified. CATSHIT remains the working ticker; YAMC is the project brand.',
  wavesTitle: 'TWO WAVES.\nONE STARTING PILE.',
  wavesLead: 'Feed the cat. Claim your shit. Up to 1,000 starting allocations; eligibility is not a guarantee of availability.',
  waves: [
    ['01 · The Chosen Cats', 'Sign in with Solana using a wallet holding a Seeker Genesis Token. Ownership is checked on mainnet. One allocation per SGT and wallet; moving the same SGT to a new wallet does not unlock another allocation.'],
    ['02 · The Great Shit Rush', 'Any remaining allocations open to eligible wallets through sign-in and a browser CAPTCHA. Return to the app to approve the faucet transaction. One allocation per wallet, first-come, first-served.'],
    ['03 · Mining starts together', 'Faucet opening, the second wave and mining start are separate on-chain timestamps. You can pre-lock after the faucet opens, but earn no PP before mining starts. Deposits made later earn points only from their own effective start.']
  ],
  scheduleNote: 'The intended windows are one hour for Wave 1, then one hour before mining starts. No mainnet date is set. The final on-chain schedule will be announced before launch.',
  admissionTrust: ['What admission does — and does not prove', 'The server verifies wallet sign-in, checks SGT ownership or CAPTCHA, and co-signs a short-lived faucet transaction. The program checks the issuer signature, recipient, wave, expiry, fixed amount and receipts. This limits repeat grants; it does not prove one wallet equals one person or eliminate device farms. The admission service can delay or deny new grants. Reward claims and withdrawals do not require its permission.'],
  steps: [['Connect & sign in', 'Use a compatible wallet. Sign-in proves control of its address; it is not a token transfer.'], ['Get your starting allocation', 'Follow the current wave’s SGT or CAPTCHA check, then review and sign the 1,000 CATSHIT faucet transaction. Availability is limited.'], ['Lock & earn points', 'Choose a lock amount. PP start at the scheduled mining time, or at your later deposit. Closing the app does not stop accrual.'], ['Verify & claim', 'After a cycle is published, inspect its allocation and approve your claim. Withdrawal requests start a 24-hour cooldown.']],
  trustDetails: 'The publisher submits allocations and can submit an incorrect one. An upgrade authority can change program logic. The faucet issuer controls eligibility for new grants. Independent replay detects allocation discrepancies; it does not veto or reverse them on-chain. Complete finalized history and canonical manifests must remain available. A Merkle proof demonstrates inclusion, not fairness.',
});
Object.assign(copy.ca, {
  draft: 'PLA MAINNET · SENSE DESPLEGAR',
  tokenCopy: '100 milions de tokens. Una aixeta inicial limitada, una reserva finita de recompenses i assignacions diàries que pots verificar.',
  tokenLink: 'Explora la distribució',
  tokenLead: '100 milions de tokens, repartits entre l’aixeta inicial i les recompenses per participació. Encara no s’han publicat les adreces mainnet ni les dates de llançament.',
  emissionCopy: 'S’assignen 250.000 CATSHIT per cicle diari no buit. La reserva de 99 milions cobreix 396 cicles no buits, aproximadament 13 mesos a un per dia. Els cicles buits no gasten assignació i allarguen el calendari. La teva part depèn de la proporció dels Poop Points del cicle que hagis acumulat; no és un pagament fix per cartera.',
  faucetCopy: 'L’aixeta conté 1.000.000 de CATSHIT: fins a 1.000 assignacions de 1.000 tokens. La primera onada és per als titulars elegibles d’un Seeker Genesis Token. La segona obre les assignacions restants a altres carteres elegibles per ordre d’arribada. Les dues onades comparteixen una única reserva; no es garanteix cap assignació separada per a la segona. Completar una comprovació no reserva tokens.',
  vestingTitle: 'Com es reparteix l’oferta',
  vestingCopy: 'L’assignació escollida és de l’1% per a l’aixeta i el 99% per a recompenses, sense partides separades per a equip, tresoreria o vesting. Encara cal publicar i verificar el mint mainnet i les autoritats. CATSHIT continua sent el símbol provisional; YAMC és la marca del projecte.',
  wavesTitle: 'DUES ONADES.\nUNA SOLA PILA INICIAL.',
  wavesLead: 'Alimenta el gat. Reclama la teva merda. Fins a 1.000 assignacions inicials; complir els requisits no en garanteix la disponibilitat.',
  waves: [
    ['01 · The Chosen Cats', 'Inicia sessió amb Solana mitjançant una cartera que tingui un Seeker Genesis Token. La propietat es comprova a mainnet. Una assignació per SGT i cartera; moure el mateix SGT a una altra cartera no permet obtenir-ne una altra.'],
    ['02 · The Great Shit Rush', 'Les assignacions restants s’obren a carteres elegibles mitjançant inici de sessió i una CAPTCHA al navegador. Torna a l’app per aprovar la transacció de l’aixeta. Una assignació per cartera, per ordre d’arribada.'],
    ['03 · La mineria comença alhora', 'L’obertura de l’aixeta, la segona onada i l’inici de la mineria tenen moments diferents registrats a la cadena. Pots bloquejar tokens des que s’obre l’aixeta, però no acumules PP abans de l’inici de la mineria. Els dipòsits posteriors només generen punts des del seu propi inici efectiu.']
  ],
  scheduleNote: 'Es preveu una hora per a la primera onada i una altra hora abans de començar la mineria. Encara no hi ha data mainnet. El calendari definitiu registrat a la cadena s’anunciarà abans del llançament.',
  admissionTrust: ['Què demostra l’admissió i què no', 'El servidor verifica la signatura d’inici de sessió, comprova la propietat de l’SGT o la CAPTCHA i cosigna una transacció de curta durada per a l’aixeta. El programa comprova la signatura de l’emissor, el destinatari, l’onada, la caducitat, l’import fix i els rebuts. Això limita les assignacions repetides; no demostra que cada cartera sigui una persona ni elimina les granges de dispositius. El servei pot retardar o denegar noves assignacions. Les reclamacions de recompenses i les retirades no necessiten el seu permís.'],
  steps: [['Connecta’t i inicia sessió', 'Fes servir una cartera compatible. L’inici de sessió demostra el control de l’adreça; no transfereix tokens.'], ['Rep l’assignació inicial', 'Completa la comprovació d’SGT o CAPTCHA de l’onada actual i després revisa i signa la transacció de 1.000 CATSHIT. La disponibilitat és limitada.'], ['Bloqueja i acumula punts', 'Tria l’import que vols bloquejar. Els PP comencen a l’hora programada o amb el teu dipòsit posterior. Tancar l’app no atura el càlcul.'], ['Verifica i reclama', 'Quan es publiqui un cicle, consulta l’assignació i aprova la reclamació. Les sol·licituds de retirada inicien una espera de 24 hores.']],
  trustDetails: 'El publicador envia les assignacions i en pot enviar una d’incorrecta. Una autoritat d’actualització pot canviar la lògica del programa. L’emissor de l’aixeta controla l’elegibilitat de les noves assignacions. La reconstrucció independent detecta discrepàncies, però no les veta ni les reverteix a la cadena. Cal conservar l’historial finalitzat complet i els manifests canònics. Una prova Merkle demostra inclusió, no equitat.',
});
for (const lang of ['en', 'ca']) {
  const t = copy[lang];
  t.docsSections.push(t.admissionTrust);
  t.faq.push(lang === 'en'
    ? ['Can I earn PP before mining starts?', 'No. Pre-lock is available after faucet opening, but PP remain zero until the scheduled mining start. The cat stays idle during that wait.']
    : ['Puc acumular PP abans de l’inici de la mineria?', 'No. Pots bloquejar tokens des de l’obertura de l’aixeta, però els PP es mantenen a zero fins a l’inici programat. Mentrestant, el gat continua en repòs.']);
  t.faq[6] = lang === 'en'
    ? ['What if I miss the faucet?', 'There are at most 1,000 allocations shared by both waves. Later participants can receive transfers from other holders. No exchange listing, liquidity or purchase route is promised.']
    : ['I si arribo tard a l’aixeta?', 'Hi ha un màxim de 1.000 assignacions compartides per les dues onades. Qui arribi més tard pot rebre transferències d’altres titulars. No es promet cap cotització, liquiditat ni via de compra.'];
}
export { copy };
