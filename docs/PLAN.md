# Frontul de Fier — plan 0 to hero

Joc de strategie în timp real (gen Red Alert), în browser, 3D izometric, apoi multiplayer și lansare pe CrazyGames / Poki.
Orchestrator: Claude (decizii, arhitectură, review). Execuție: subagenți Sonnet (cod) și Haiku (sarcini mecanice).
Iulian: joacă versiunile livrate, dă feedback, plătește ce e de plătit (Tripo/Meshy, server).

## Reguli de lucru
1. Simularea e separată de randare. `src/sim` nu importă nimic din `three`, DOM sau `Math.random`.
2. Simularea e deterministă: tick fix 20/s, RNG cu seed, trigonometrie doar din `src/sim/fmath.ts`. Asta face posibil multiplayerul (lockstep) și replay-urile.
3. Singura cale prin care jucătorul schimbă lumea: `Command` (vezi `src/sim/types.ts`). UI-ul și AI-ul trimit comenzi, nu modifică state-ul direct.
4. Tot ce ține de echilibru (cost, viață, damage, viteză) stă în `src/data/`. Codul nu are numere magice de gameplay.
5. Fiecare agent lucrează doar în folderele lui. Contractele din `src/sim/types.ts` se schimbă doar de orchestrator.
6. `npm run build` și `npm test` trec înainte de orice merge.

## Etape

### M1 — Motorul (acum)
- Sim: hartă pe tile-uri, pathfinding (A* + flow field pentru grupuri), mișcare cu evitare, luptă, proiectile, recoltare, producție, ceață de război, condiții de victorie.
- Render 3D: cameră izometrică cu zoom/pan, teren cu relief ușor, minereu, umbre, modele temporare low-poly, efecte (foc de armă, explozii, fum, urme), selecție, bare de viață, ceață.
- UI: bară laterală de construcție cu cozi, minihartă, controale touch + mouse + tastatură, mesaje, ecrane start/victorie/înfrângere.
- AI: economie, construcție, apărare, atacuri în valuri, 3 dificultăți.
- Ținta M1: tot ce avea prototipul, dar în 3D, mai fluid și cu arhitectura pe care se construiește restul.

### M2 — Conținut
- Infanterie (pușcaș, rachetă antitanc, inginer care capturează clădiri), vehicule (tanc ușor, tanc greu, artilerie, antiaerian, recoltor), aer (elicopter de atac).
- Energie: centrală electrică; fără curent producția merge încet și turelele se opresc.
- Arbore tehnologic: cladiri care deblochează unități (cazarmă, fabrică, aeroport, laborator).
- Reparații, veterani (unitățile cresc în grad), formații, ordine: patrulare, gardă, atac-deplasare.
- 4 hărți, 2 facțiuni cu unități diferite (Coaliția vs Legiunea).

### M3 — Grafică și sunet adevărate
- Modele 3D generate cu Tripo (vehicule, clădiri) și Meshy (infanterie cu animații), curățate automat (Blender headless), stil unitar.
- Teren texturat, apă, copaci, decor.
- Sunete de arme și explozii, muzică, voce „Unitate gata / Baza e atacată” (ElevenLabs).

### M4 — Multiplayer
- Lockstep determinist: clienții trimit doar comenzi, server relay mic (WebSocket).
- Lobby cu link de invitație, 1v1 și 2v2, reconectare, verificare desincronizare (hash de state).

### M5 — Lansare
- SDK CrazyGames / Poki (reclame între meciuri, salvare progres), tutorial, campanie scurtă de 5 misiuni.
- Analytics: cât joacă oamenii, unde renunță.

### M6 — Mobil și bani
- Variantă de telefon (Capacitor), achiziții cosmetice.
- Meciuri pe miză: doar după aviz juridic (ONJN) și cu simulare pe server (anti-cheat).
