# Modele 3D (GLB) folosite

Toate sunt CC0 1.0 (domeniu public), descarcate de pe poly.pizza (pagina fiecarui model arata `Licence: CC0 1.0`).
Fisierele din `public/models/` sunt versiuni optimizate (vezi mai jos); originalele nu sunt in repo.

| Fisier | Folosit pentru | Titlu | Autor | Licenta | Sursa |
|---|---|---|---|---|---|
| tank.glb | tank | Tank | Quaternius | CC0 1.0 | https://poly.pizza/m/cW3zvvkMOM |
| rocket.glb | rocket (camion blindat; rastelul de rachete e procedural) | Truck Armored | Quaternius | CC0 1.0 | https://poly.pizza/m/VvX8nmoCN5 |
| harvester.glb | harvester si warHarvester (la warHarvester se adauga tureta procedurala) | Truck | Quaternius | CC0 1.0 | https://poly.pizza/m/cXw6oiFtZ8 |
| soldier.glb | soldier, bazooka (la bazooka se adauga procedural un tub) | SWAT | Quaternius | CC0 1.0 | https://poly.pizza/m/Btfn3G5Xv4 |
| hq.glb | hq | Base Large | Quaternius | CC0 1.0 | https://poly.pizza/m/UyH95ZAeJ2 |
| refinery.glb | refinery | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/ilWoURnbZW |
| factory.glb | factory | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/PB5Cd3dL24 |
| barracks.glb | barracks | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/oUkHO0kbQt |
| airfield.glb | airfield (pista e procedurala) | Building L | Quaternius | CC0 1.0 | https://poly.pizza/m/dsH7KEfuPP |
| turret.glb | turret | Turret Cannon | Quaternius | CC0 1.0 | https://poly.pizza/m/mNJ6poH7Cp |
| rocketturret.glb | rocketTurret (tuburi de rachete procedurale pe tureta) | Turret Gun | Quaternius | CC0 1.0 | https://poly.pizza/m/hThPXDCbwl |
| rock1.glb | decor: stanci pe tile-urile de stanca | Rock | Quaternius | CC0 1.0 | https://poly.pizza/m/RtLRqYjfMs |
| rock2.glb | decor: stanci pe tile-urile de stanca | Rock Large | Quaternius | CC0 1.0 | https://poly.pizza/m/54jZKTAt5p |
| tree1.glb, tree2.glb, tree3.glb | decor: copaci pe stanca si pe marginea hartii | Tree | Quaternius | CC0 1.0 | https://poly.pizza/m/9nvGuZlbpE , https://poly.pizza/m/i4QMw4L64D , https://poly.pizza/m/2paAm1ja4w |
| bush1.glb | decor: tufis | Bush | Quaternius | CC0 1.0 | https://poly.pizza/m/92EytlU1El |

Nu exista avion CC0 (Quaternius/Kenney) care sa para bombardier (doar nave spatiale), deci bombardierul si centrala (power) sunt procedurale.

## Prelucrare

Cu `@gltf-transform` (core + functions): `prune`, `dedup`, texturi redimensionate (512 px; 256 px pentru soldat si roci), `quantize`
(fara quantize pentru soldat si roci). La tanc s-au scos scheletul si animatiile (modelul ramane in pozitia de repaus, tureta ramane
nod separat). La soldat s-au pastrat doar animatiile `Idle_Gun`, `Run`, `Run_Shoot`, `Idle_Gun_Shoot`.
Marimea totala `public/models`: ~3 MB.
La incarcare, mesh-urile statice ale fiecarui model se fuzioneaza (`src/render/merge.ts`) ca sa scada numarul de desenari.

## Ce ramane procedural

Placeholderele din `src/render/models.ts` (se vad pana se incarca GLB-ul sau daca un fisier lipseste), bombardierul (aripa zburatoare), centrala electrica, tureta recoltorului blindat, rastelul de rachete al lansatorului, tuburile turelei anti-aeriene,
tubul bazookei, pista aerodromului, platforma / chenarul / steagul de echipa al cladirilor, inelul de echipa de sub unitati,
bombele, umbra bombardierului.

## Audio

Muzica e in `public/audio/` (se incarca prin URL relativ `audio/<fisier>`, ca site-ul sa mearga si intr-un sub-folder). Doar CC0; licenta a fost
verificata pe pagina fiecarui fisier (OpenGameArt, eticheta "CC0"). Piesele au fost reincodate in OGG Vorbis (q3, stereo) cu ffmpeg, fara taiere.

| Fisier | Rol | Titlu | Autor | Licenta | Sursa |
|---|---|---|---|---|---|
| calm.ogg | muzica de constructie (calma, sci-fi intunecat) | Bleak Terminal (theme) | Ruskerdax | CC0 1.0 | https://opengameart.org/content/bleak-terminal |
| tense.ogg | lupta / baza atacata (orchestra, viori si corni) | Battle Theme A (redone) | cynicmusic / The Cynic Project | CC0 1.0 | https://opengameart.org/content/battle-theme-a |

Marime totala `public/audio`: ~2,7 MB. Alte piese cercetate si ocolite: "Synth Wave" (Alex McCulloch) cere mentionarea autorului in
textul paginii, desi e etichetata CC0; "Cybersecutor" nu are autor indicat pe pagina; freepd.com e inchis.

Efectele sonore NU sunt fisiere: sunt sintetizate in `src/ui/audio.ts` cu WebAudio (tun, racheta, rafala de pusca, bomba, explozii, plasare,
vanzare, unitate gata pe tip de producator, avansare, strivire, curent insuficient, numaratoare de bani, interfata). Confirmarile radio la
ordine sunt ciripituri sintetizate cu zgomot filtrat, fara voce.

Fara fisierele din `public/audio` (de exemplu in varianta intr-un singur fisier HTML) muzica lipseste in tacere, fara erori; efectele raman.
