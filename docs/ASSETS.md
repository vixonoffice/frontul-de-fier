# Modele 3D (GLB) folosite

Toate sunt CC0 1.0 (domeniu public), descarcate de pe poly.pizza (pagina fiecarui model arata `Licence: CC0 1.0`).
Fisierele din `public/models/` sunt versiuni optimizate (vezi mai jos); originalele nu sunt in repo.

| Fisier | Folosit pentru | Titlu | Autor | Licenta | Sursa |
|---|---|---|---|---|---|
| tank.glb | tank | Tank | Quaternius | CC0 1.0 | https://poly.pizza/m/cW3zvvkMOM |
| rocket.glb | rocket (vehicul lansator; rastelul de rachete e procedural) | Pickup Truck Armored | Quaternius | CC0 1.0 | https://poly.pizza/m/RUwMItmU4B |
| harvester.glb | harvester | Truck | Quaternius | CC0 1.0 | https://poly.pizza/m/cXw6oiFtZ8 |
| soldier.glb | soldier, bazooka (la bazooka se adauga procedural un tub) | SWAT | Quaternius | CC0 1.0 | https://poly.pizza/m/Btfn3G5Xv4 |
| bomber.glb | bomber | Spaceship (nava Ultimate Space Kit, folosita ca avion) | Quaternius | CC0 1.0 | https://poly.pizza/m/PQzePrvBCD |
| hq.glb | hq | Base Large | Quaternius | CC0 1.0 | https://poly.pizza/m/UyH95ZAeJ2 |
| refinery.glb | refinery | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/ilWoURnbZW |
| factory.glb | factory | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/PB5Cd3dL24 |
| barracks.glb | barracks | Structure | Quaternius | CC0 1.0 | https://poly.pizza/m/oUkHO0kbQt |
| airfield.glb | airfield (pista e procedurala) | Building L | Quaternius | CC0 1.0 | https://poly.pizza/m/dsH7KEfuPP |
| turret.glb | turret | Turret Cannon | Quaternius | CC0 1.0 | https://poly.pizza/m/mNJ6poH7Cp |
| rocketturret.glb | rocketTurret | Double Turret | Kenney | CC0 1.0 | https://poly.pizza/m/wMb4gh6STL |
| rock1.glb | decor: stanci pe tile-urile de stanca | Rock | Quaternius | CC0 1.0 | https://poly.pizza/m/RtLRqYjfMs |
| rock2.glb | decor: stanci pe tile-urile de stanca | Rock Large | Quaternius | CC0 1.0 | https://poly.pizza/m/54jZKTAt5p |

## Prelucrare

Cu `@gltf-transform` (core + functions): `prune`, `dedup`, texturi redimensionate (512 px; 256 px pentru soldat si roci), `quantize`
(fara quantize pentru soldat si roci). La tanc s-au scos scheletul si animatiile (modelul ramane in pozitia de repaus, tureta ramane
nod separat). La soldat s-au pastrat doar animatiile `Idle_Gun`, `Run`, `Run_Shoot`, `Idle_Gun_Shoot`.
Marimea totala `public/models`: ~3 MB.

## Ce ramane procedural

Placeholderele din `src/render/models.ts` (se vad pana se incarca GLB-ul sau daca un fisier lipseste), rastelul de rachete al lansatorului,
tubul bazookei, pista aerodromului, platforma / chenarul / steagul de echipa al cladirilor, inelul de echipa de sub unitati,
bombele, umbra bombardierului.
