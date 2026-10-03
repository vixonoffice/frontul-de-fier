# Arhitectură

```
src/
  sim/        simularea deterministă (fără three, fără DOM, fără Math.random)
    types.ts  CONTRACT — doar orchestratorul îl modifică
    index.ts  implementează SimAPI: createWorld, step, canPlace, hash
    rng.ts    RNG cu seed (mulberry32), state în world.rng
    fmath.ts  sin/cos/atan2/sqrt deterministe (tabele sau aproximări fixe)
    map.ts    generare hartă din seed (teren, relief, minereu, starturi)
    path.ts   A* pe grilă + flow field pentru grupuri mari
    ai.ts     jucătorul calculator — produce Command-uri, rulează în step()
    *.test.ts teste vitest
  data/       statistici: units.ts, buildings.ts (cost, hp, damage, rază, viteză, timp)
  render/     Three.js — implementează RenderAPI din render/api.ts
  ui/         DOM: bară de construcție, minihartă, mesaje, ecrane; input mouse/touch/tastatură
  main.ts     leagă totul: buclă fixă 20 tick/s + randare la fiecare frame cu interpolare
reference/prototip-v1.html   prototipul 2D jucabil (comportamentul de referință)
```

Fluxul unui frame:
1. UI adună input și îl transformă în `Command[]` pentru echipa locală.
2. `main.ts` rulează `sim.step(world, commands)` de câte ori e nevoie ca să țină 20 tick/s.
3. `renderer.render(world, alpha, dt)` desenează, interpolând pozițiile între tick-uri. Efectele (explozii, flăcări) pornesc din `world.events`.
4. UI-ul își actualizează bara, minihartă și mesajele din `world` și `world.events`.

Randarea și UI-ul citesc `world`, nu îl modifică niciodată.
