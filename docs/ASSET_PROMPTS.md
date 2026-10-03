# Frontul de Fier – AI 3D Asset Generation Prompts

## Shared Style Block (prepend to all prompts below)

Stylized low-poly game asset, clean hard-surface shapes, readable silhouette from a 55° top-down isometric camera, hand-painted PBR look with worn military paint, a large neutral grey panel area reserved for team color customization, no text or logos, single object centered on plain grey background, ground-level pivot point.

---

## VEHICLES – COALITIA (Blue, Western sleek angular)

### Light Tank – Coalitia
- **Name:** Tanc Ușor / Light Tank
- **Tool:** Tripo
- **Prompt:** Compact tracked light tank with sloped angular armor plates, single-person turret, 40mm cannon. Sleek Western design with sharp lines and minimal surface detail.
- **Negative Prompt:** Round shapes, rounded edges, asymmetrical, heavy armor, ERA blocks, reactive armor
- **Triangle Budget:** 3,000–4,500
- **Parts to generate separately:** Hull + tracks, Turret, Barrel
- **Pivot Notes:** Turret pivot at ring center (z-axis), barrel articulation, tracks ground-gripping

### Heavy Tank – Coalitia
- **Name:** Tanc Greu / Heavy Tank
- **Tool:** Tripo
- **Prompt:** Large tracked heavy tank with angular composite armor, tall cylindrical turret, dual coaxial 120mm cannon setup. Heavily sloped side plates, Western low-profile chassis.
- **Negative Prompt:** Round turret, bulky silhouette, asymmetrical design, side skirts, vertical surfaces
- **Triangle Budget:** 5,000–6,000
- **Parts to generate separately:** Hull + tracks, Turret, Cannon barrel (dual-mounted), Coaxial MG
- **Pivot Notes:** Turret rotation z-axis, independent barrel pitch, track animation points

### Rocket Launcher Truck – Coalitia
- **Name:** Lansator de Rachete / Rocket Launcher Truck
- **Tool:** Tripo
- **Prompt:** Wheeled truck chassis with angled rectangular body, elevated 12-tube rocket pod array mounted on rotating ring. Sleek cab design, minimal armor, exposed frame.
- **Negative Prompt:** Tracked, closed turret, vertical tubes, symmetrical sides, heavy plating
- **Triangle Budget:** 4,000–5,000
- **Parts to generate separately:** Truck cab + chassis, Rocket pod frame, Rotating ring mount
- **Pivot Notes:** Pod assembly rotates on centerline, elevation angle adjustable

### Artillery – Coalitia
- **Name:** Artilerie / Self-Propelled Gun
- **Tool:** Tripo
- **Prompt:** Long-barreled self-propelled 155mm howitzer on tracked chassis. Tilted gun cradle, open-top fighting compartment, angular gun shield. Western angular design language.
- **Negative Prompt:** Turretless, cupola, closed breech, round surfaces, symmetrical barrel
- **Triangle Budget:** 4,500–5,500
- **Parts to generate separately:** Chassis + hull, Gun assembly, Elevation mechanism (visual only)
- **Pivot Notes:** Barrel articulates at cradle ring, chassis stays fixed

### Anti-Air Vehicle – Coalitia
- **Name:** Antiaerian / Air Defense Vehicle
- **Tool:** Tripo
- **Prompt:** Wheeled chassis with quad-barrel rotary cannon mounted on elevated rotating turret. Compact radar dome behind turret, exposed frame construction, Western sleek proportions.
- **Negative Prompt:** Tracked, missile pods, large turret, covered radar, heavy armor
- **Triangle Budget:** 3,500–4,500
- **Parts to generate separately:** Chassis, Turret, Quad-barrel cannons (as single unit), Radar dome
- **Pivot Notes:** Turret 360° z-rotation, cannon elevation on u-axis

### Harvester – Coalitia
- **Name:** Cositor de Minereuri / Ore Harvester
- **Tool:** Tripo
- **Prompt:** Tracked vehicle with large rectangular ore hopper (exposed tank structure), conveyor arm folded on top, mining drill or scoop at front. Industrial angular design, minimal weapons.
- **Negative Prompt:** Weaponized turret, sleek profile, enclosed hopper, light armor
- **Triangle Budget:** 3,500–4,500
- **Parts to generate separately:** Track chassis, Ore hopper (separate to show fill state), Conveyor arm, Drill/scoop head
- **Pivot Notes:** Hopper lid opens along front edge, conveyor can articulate

### Attack Helicopter – Coalitia
- **Name:** Elicopter de Atac / Attack Helicopter
- **Tool:** Tripo
- **Prompt:** Sleek attack helicopter with twin turbines, thin fuselage, tandem cockpit bubble, rocket pods on short wings. Minimal landing gear, angular frame. Western design aesthetic.
- **Negative Prompt:** Transport helicopter, large cabin, round fuselage, full landing gear, no rocket hardpoints
- **Triangle Budget:** 4,000–5,500
- **Parts to generate separately:** Fuselage + cockpit + tail boom, Main rotor blades (4-blade), Rocket pods (left + right), Landing skids
- **Pivot Notes:** Rotor blades spin on main mast z-axis, fuselage stationary

---

## VEHICLES – LEGIUNEA (Red, Eastern-bloc heavy blocky)

### Light Tank – Legiunea
- **Name:** Tanc Ușor / Light Tank
- **Tool:** Tripo
- **Prompt:** Compact tracked light tank with boxy armor shape, cylindrical turret, 40mm gun. Heavy Eastern-bloc aesthetic with blocky surfaces, thick armor plating, minimal angles.
- **Negative Prompt:** Sloped armor, angular design, minimal surfaces, Western profile, light construction
- **Triangle Budget:** 3,000–4,500
- **Parts to generate separately:** Hull + tracks, Turret, Barrel
- **Pivot Notes:** Turret pivot at ring center, tracks articulate independently

### Heavy Tank – Legiunea
- **Name:** Tanc Greu / Heavy Tank
- **Tool:** Tripo
- **Prompt:** Massive tracked heavy tank with thick vertical armor plates, oversized cylindrical turret, long 125mm cannon. Flat-sided hull, boxy construction, heavy bolt detail. Eastern-bloc industrial design.
- **Negative Prompt:** Sloped composite armor, angular sides, low profile, minimal detail, light weight appearance
- **Triangle Budget:** 5,500–6,500
- **Parts to generate separately:** Hull + tracks, Large turret, Cannon barrel, Coaxial MG mount
- **Pivot Notes:** Turret heavy rotation, barrel sag-free appearance

### Rocket Launcher Truck – Legiunea
- **Name:** Lansator de Rachete / Rocket Launcher Truck
- **Tool:** Tripo
- **Prompt:** Boxy wheeled truck with enclosed cabin, massive elevated 16-tube rocket pod array in vertical rectangular frame. Heavy blocky profile, industrial mounting structure.
- **Negative Prompt:** Angled construction, open frame, sleek design, light materials
- **Triangle Budget:** 4,500–5,500
- **Parts to generate separately:** Truck cab + chassis, Rocket pod frame, Vertical support beams
- **Pivot Notes:** Pod array rotates as unit on turntable

### Artillery – Legiunea
- **Name:** Artilerie / Self-Propelled Gun
- **Tool:** Tripo
- **Prompt:** Heavy self-propelled 152mm howitzer on tracked chassis. Boxy gun cradle with tall gun shield, enclosed fighting compartment with hatch, vertical armor surfaces. Eastern-bloc heavy industrial appearance.
- **Negative Prompt:** Angled gun shield, open compartment, thin construction, Western design
- **Triangle Budget:** 5,000–6,000
- **Parts to generate separately:** Chassis + hull, Gun assembly + shield, Ammunition handling detail (visual)
- **Pivot Notes:** Barrel pitches at cradle, no turret rotation

### Anti-Air Vehicle – Legiunea
- **Name:** Antiaerian / Air Defense Vehicle
- **Tool:** Tripo
- **Prompt:** Heavy tracked chassis with enclosed turret, dual 30mm auto-cannon, exposed missile rails on turret sides, prominent radar array. Boxy Eastern-bloc construction.
- **Negative Prompt:** Wheeled, rotary cannons, minimalist radar, sleek profile
- **Triangle Budget:** 4,000–5,000
- **Parts to generate separately:** Tracked chassis, Turret, Cannons + missile rails, Radar array
- **Pivot Notes:** Full turret rotation, cannon elevation linked

### Harvester – Legiunea
- **Name:** Cositor de Minereuri / Ore Harvester
- **Tool:** Tripo
- **Prompt:** Heavy tracked vehicle with massive cubic ore hopper, chain conveyor on side or top, mining bucket/clamshell jaw at front. Utilitarian blocky design, reinforced frame.
- **Negative Prompt:** Sleek construction, enclosed hopper, light materials
- **Triangle Budget:** 4,000–5,000
- **Parts to generate separately:** Track chassis, Ore hopper (large cubic), Conveyor chain structure, Bucket/jaw assembly
- **Pivot Notes:** Hopper tilts to dump, jaw opens/closes

### Attack Helicopter – Legiunea
- **Name:** Elicopter de Atac / Attack Helicopter
- **Tool:** Tripo
- **Prompt:** Heavy attack helicopter with twin turbines, stubby wide fuselage, tandem cockpit with armor glass, heavy missile racks on short fat wings. Boxy tail boom. Eastern-bloc rugged design.
- **Negative Prompt:** Light construction, single turbine, minimal weapons mounts, sleek profile
- **Triangle Budget:** 4,500–6,000
- **Parts to generate separately:** Fuselage + cockpit, Rotor blades (4-blade), Missile racks (left + right), Tail boom with fin
- **Pivot Notes:** Rotor spins on mast, fuselage anchored

---

## INFANTRY – BOTH FACTIONS

### Rifleman
- **Name:** Pușcaș / Rifleman
- **Tool:** Meshy (with auto-rigging for walk/shoot/death)
- **Prompt:** Soldier in combat stance, holding modern rifle (assault rifle profile), full combat gear: helmet, body armor plates, tactical vest. Realistic proportions, distinct limbs for animation.
- **Negative Prompt:** Unarmed, fantasy armor, oversized limbs, abstracted form
- **Triangle Budget:** 2,000–3,000
- **Animations needed:** Walk cycle (4 frames), shoot stance (hold + recoil), death fall
- **Pivot Notes:** Pelvis center for locomotion, spine for upper-body aim, shoulder for rifle raise

### Rocket Soldier
- **Name:** Soldat cu Rachete / Rocket Soldier
- **Tool:** Meshy (with auto-rigging)
- **Prompt:** Soldier holding large shoulder-fired rocket launcher (RPG profile), combat gear, stance optimized for weapon weight. Explosive ordnance color accent on launcher.
- **Negative Prompt:** Unarmed, rifle, oversized proportions, non-human silhouette
- **Triangle Budget:** 2,000–3,000
- **Animations needed:** Walk cycle, aimed stance (raised launcher), fire recoil, death
- **Pivot Notes:** Center pelvis, launcher articulation at shoulder

### Engineer
- **Name:** Inginer / Engineer
- **Tool:** Meshy (with auto-rigging)
- **Prompt:** Soldier in light armor with tool harness, carrying wrench or cutting tool (identifiable), tech-forward gear with visible cables/pouches. Lighter armored profile than rifleman.
- **Negative Prompt:** Heavy armor, rifle, fantasy elements, oversized tools
- **Triangle Budget:** 1,800–2,800
- **Animations needed:** Walk, repair stance (bent over), death
- **Pivot Notes:** Standard humanoid rig, tool harness pivots at torso

---

## BUILDINGS – COALITIA (Blue, Western sleek)

### HQ / Construction Yard
- **Name:** Cartierul General / HQ
- **Tool:** Tripo
- **Prompt:** Multi-story angular command center, flat roof with antenna arrays, large rectangular windows, sleek aluminum-clad walls. Ground-level entrance ramp, minimal armor.
- **Negative Prompt:** Round surfaces, heavy plating, fortified walls, squat profile
- **Triangle Budget:** 8,000–10,000
- **Parts to generate separately:** Main structure, Antenna array, Roof section, Entrance ramp
- **Pivot Notes:** Antennas rotate on mast, all parts ground-level aligned

### Power Plant
- **Name:** Centrala Electrică / Power Plant
- **Tool:** Tripo
- **Prompt:** Industrial power facility: rectangular reactor core building, tall exhaust/cooling stack, transformer banks on side. Angular frames, steel superstructure visible. Western industrial aesthetic.
- **Negative Prompt:** Dome reactor, spherical tanks, enclosed design, fortress-like
- **Triangle Budget:** 7,000–9,000
- **Parts to generate separately:** Main reactor block, Cooling tower/stack, External transformer unit, Power lines (visual)
- **Pivot Notes:** Stack is stationary visual element

### Refinery (with silos + dock)
- **Name:** Rafinerie / Refinery
- **Tool:** Tripo
- **Prompt:** Industrial refinery cluster: cylindrical storage silos (3–4 units), central processing tower with catwalks and piping, loading dock with conveyor ramp. Exposed framework, Western clean lines.
- **Negative Prompt:** Spherical tanks, buried pipes, minimal infrastructure, compact design
- **Triangle Budget:** 10,000–12,000
- **Parts to generate separately:** Storage silos (1x main, 2x small), Processing tower, Dock ramp, Visible pipes (visual detail)
- **Pivot Notes:** Silos stack vertically, dock ramp aligned to ground

### Barracks
- **Name:** Cazarmă / Barracks
- **Tool:** Tripo
- **Prompt:** Multi-bay soldier training facility, rectangular layout, corrugated metal walls with reinforcement ribs, wide sliding bay doors (3x), minimal windows, flat roof.
- **Negative Prompt:** Residential architecture, many windows, sloped roof, enclosed fortress
- **Triangle Budget:** 6,000–8,000
- **Parts to generate separately:** Main structure, Bay doors (separate to animate open), Roof section
- **Pivot Notes:** Doors slide horizontally in tracks

### War Factory
- **Name:** Fabrica de Luptă / War Factory
- **Tool:** Tripo
- **Prompt:** Large industrial vehicle assembly plant, gridded roof trusses (exposed), towering wall-mounted gantry crane, multiple ground-level reinforced garage bays. Steel framework dominant.
- **Negative Prompt:** Residential factory, enclosed spaces, minimal crane, rounded surfaces
- **Triangle Budget:** 10,000–12,000
- **Parts to generate separately:** Factory shell, Overhead gantry crane, Garage doors (×3), Internal support columns (visual)
- **Pivot Notes:** Gantry moves along rail (visual animation support)

### Airfield / Helipad
- **Name:** Liniștă de Decolare / Airfield
- **Tool:** Tripo
- **Prompt:** Open tarmac airfield with runway markings (visual), control tower (small angular tower), helicopter landing pad (marked X), fuel depot (small building), minimal structures.
- **Negative Prompt:** Enclosed airport terminal, large hangars, dense buildings, rounded tower
- **Triangle Budget:** 7,000–9,000
- **Parts to generate separately:** Control tower, Landing pad platform, Fuel station structure, Runway markings (texture)
- **Pivot Notes:** Tower top rotates for radar dish effect, all ground-aligned

### Tech Lab
- **Name:** Laborator Tehnologic / Tech Lab
- **Tool:** Tripo
- **Prompt:** Modern research facility, compact rectangular building with sloped glass front panel, exposed laboratory equipment visible through windows (minimal internal detail), roof-mounted server/satellite array.
- **Negative Prompt:** Fortress design, minimal windows, oversized, industrial appearance
- **Triangle Budget:** 6,000–8,000
- **Parts to generate separately:** Main structure, Glass front panel, Roof equipment array
- **Pivot Notes:** Glass panel angled for visual interest

### Defensive Turret
- **Name:** Turelă de Apărare / Gun Turret
- **Tool:** Tripo
- **Prompt:** Small rotating gun emplacement, single 20mm cannon in enclosed rotating turret mounted on squat concrete base, minimal armor, open top gun ring.
- **Negative Prompt:** Missile launcher, heavy turret, fully enclosed design, large base
- **Triangle Budget:** 3,000–4,000
- **Parts to generate separately:** Concrete base, Rotating turret, Gun barrel (articulated)
- **Pivot Notes:** Turret rotates z-axis on base, cannon pitches independently

### AA Turret
- **Name:** Turelă Antiaeriană / AA Turret
- **Tool:** Tripo
- **Prompt:** Anti-aircraft turret, quad-barrel rotary cannon mounted on elevated rotating pedestal, minimal ammo drum visible, open framework concrete base.
- **Negative Prompt:** Single cannon, enclosed turret, heavy base, missile array
- **Triangle Budget:** 3,500–4,500
- **Parts to generate separately:** Pedestal base, Rotating turret, Quad-barrels (as unit)
- **Pivot Notes:** Full 360° turret rotation, cannon elevation u-axis

### Walls Segment
- **Name:** Segment de Zid / Wall Section
- **Tool:** Tripo
- **Prompt:** Modular fortification wall segment (single unit), angular reinforced concrete construction, crenellated top with gun ports, minimal interior structure. Western fortress aesthetic.
- **Negative Prompt:** Stone masonry, smooth walls, no crenellations, curved profile
- **Triangle Budget:** 2,000–3,000
- **Parts to generate separately:** Wall body (single piece, modular repeat)
- **Pivot Notes:** Ground-level base, can be tiled horizontally

---

## BUILDINGS – LEGIUNEA (Red, Eastern-bloc heavy)

### HQ / Construction Yard
- **Name:** Cartierul General / HQ
- **Tool:** Tripo
- **Prompt:** Brutalist command center, thick concrete walls, narrow slit windows, flat roof with boxy superstructure, heavy tower corner element. Eastern-bloc fortress aesthetic.
- **Negative Prompt:** Sleek aluminum cladding, many windows, angled design, minimal armor
- **Triangle Budget:** 8,500–10,500
- **Parts to generate separately:** Main block, Corner guard tower, Roof structures
- **Pivot Notes:** Tower top rotates on center axis

### Power Plant
- **Name:** Centrala Electrică / Power Plant
- **Tool:** Tripo
- **Prompt:** Brutalist power station: massive rectangular reactor core (blocky), thick cylindrical cooling tower (4x tall), external turbine housings with visible ribbing. Heavy Eastern-bloc industrial.
- **Negative Prompt:** Sleek design, minimal external detail, modern materials appearance
- **Triangle Budget:** 8,000–10,000
- **Parts to generate separately:** Reactor block, Cooling towers (×2), Turbine housings, Exhaust stacks
- **Pivot Notes:** All structures stationary visual elements

### Refinery (with silos + dock)
- **Name:** Rafinerie / Refinery
- **Tool:** Tripo
- **Prompt:** Heavy industrial refinery: massive vertical storage silos (5–6 large cylinders), central cracking tower (tall rectangular with external catwalks/piping), heavy loading dock with articulated arm. Utilitarian brutalist.
- **Negative Prompt:** Modern streamlined design, minimal silos, interior-focused
- **Triangle Budget:** 11,000–13,000
- **Parts to generate separately:** Main silos (modular: 3x large + 2x small), Central tower, Dock with loading arm, Visible pipes (substantial)
- **Pivot Notes:** Silos static stack, dock arm articulates for animation

### Barracks
- **Name:** Cazarmă / Barracks
- **Tool:** Tripo
- **Prompt:** Heavy brutalist barracks, thick concrete walls, narrow horizontal windows, arched roof bays, deep bay doors recessed in concrete. Fortress-like soldier housing.
- **Negative Prompt:** Light corrugated walls, many windows, sleek appearance
- **Triangle Budget:** 7,000–9,000
- **Parts to generate separately:** Main structure, Arched roof sections, Bay doors (×2, recessed)
- **Pivot Notes:** Doors slide in deep recessed track

### War Factory
- **Name:** Fabrica de Luptă / War Factory
- **Tool:** Tripo
- **Prompt:** Massive brutalist vehicle factory, fortress-thick concrete outer walls, exposed industrial beams, heavy overhead gantry crane on thick supports, cavernous interior bays visible. Eastern-bloc industrial.
- **Negative Prompt:** Light construction, minimal crane, enclosed modern design
- **Triangle Budget:** 11,000–13,000
- **Parts to generate separately:** Factory walls (thick), Massive gantry on supports, Interior bay openings, Support columns
- **Pivot Notes:** Gantry traverses on rails

### Airfield / Helipad
- **Name:** Liniștă de Decolare / Airfield
- **Tool:** Tripo
- **Prompt:** Soviet-style military airfield, concrete runway with military markings, solid control tower (cubical concrete tower), fortified hangar bay entrances, fuel storage (squat tanks), minimal aesthetic.
- **Negative Prompt:** Modern airport, light structures, minimal military appearance
- **Triangle Budget:** 8,000–10,000
- **Parts to generate separately:** Control tower (massive), Runway section (visual), Fortified hangar doors, Fuel tanks
- **Pivot Notes:** Tower top static (radar mast visual)

### Tech Lab
- **Name:** Laborator Tehnologic / Tech Lab
- **Tool:** Tripo
- **Prompt:** Soviet-era research facility, brutalist concrete block, small recessed windows, roof-mounted antenna arrays, heavy steel door entrance, functional utilitarian design.
- **Negative Prompt:** Modern sleek lab, large windows, aluminum cladding, minimal antennas
- **Triangle Budget:** 7,000–9,000
- **Parts to generate separately:** Main structure, Antenna array (large, multiple), Steel entry door
- **Pivot Notes:** Antennas rotate on roof base

### Defensive Turret
- **Name:** Turelă de Apărare / Gun Turret
- **Tool:** Tripo
- **Prompt:** Heavy gun emplacement, single 25mm cannon in rotating armored turret, thick concrete circular base with firing ports, gun shield present.
- **Negative Prompt:** Light turret, exposed gun, minimal armor
- **Triangle Budget:** 3,500–4,500
- **Parts to generate separately:** Concrete base, Armored turret, Cannon barrel
- **Pivot Notes:** Turret rotates on circular base, cannon pitches

### AA Turret
- **Name:** Turelă Antiaeriană / AA Turret
- **Tool:** Tripo
- **Prompt:** Heavy anti-aircraft installation, dual 30mm auto-cannon in rotating turret, missile magazine racks visible on turret sides, thick cylindrical base with reinforced ring.
- **Negative Prompt:** Single cannon, quad-barrel, minimal missiles
- **Triangle Budget:** 4,000–5,000
- **Parts to generate separately:** Reinforced base, Rotating turret, Dual-cannons, Missile racks
- **Pivot Notes:** Full rotation, independent cannon elevation

### Walls Segment
- **Name:** Segment de Zid / Wall Section
- **Tool:** Tripo
- **Prompt:** Heavy fortification wall segment (single repeating unit), thick reinforced concrete, angular reinforcement buttresses, loop-holes for defense, utilitarian Soviet fortress style.
- **Negative Prompt:** Smooth walls, minimal reinforcement, decorative crenellations
- **Triangle Budget:** 2,500–3,500
- **Parts to generate separately:** Wall body (modular)
- **Pivot Notes:** Ground-level base, tiled horizontally

---

## PROPS – GENERIC (Both Factions)

### Ore Crystal Cluster – Size Small
- **Name:** Cristal de Minereuri (Mic) / Ore Crystal (Small)
- **Tool:** Tripo
- **Prompt:** Small jagged ore crystal outcropping, angular faceted shape, translucent amber/green tint, rough mineral surface. Single small piece, 0.5–1m scale.
- **Negative Prompt:** Smooth sphere, symmetric shape, polished surface
- **Triangle Budget:** 300–500
- **Pivot Notes:** Base-centered for placement

### Ore Crystal Cluster – Size Medium
- **Name:** Cristal de Minereuri (Mediu) / Ore Crystal (Medium)
- **Tool:** Tripo
- **Prompt:** Medium ore crystal cluster, multiple jagged shards radiating from base, amber/teal mineral coloration, rough faceted surfaces. 1–2m scale.
- **Negative Prompt:** Symmetric arrangement, smooth surfaces, single shard
- **Triangle Budget:** 600–900
- **Pivot Notes:** Base-level cluster assembly

### Ore Crystal Cluster – Size Large
- **Name:** Cristal de Minereuri (Mare) / Ore Crystal (Large)
- **Tool:** Tripo
- **Prompt:** Large ore crystal formation, substantial jagged shards in irregular cluster, deep amber or cyan tint depending on ore type, weathered surface. 3–4m scale.
- **Negative Prompt:** Polished, symmetric, small scale
- **Triangle Budget:** 1,200–1,500
- **Pivot Notes:** Grounded base, multiple faces for visual interest

### Rocks – Variant 1 (Angular)
- **Name:** Piatră (Angular) / Rock (Angular)
- **Tool:** Tripo
- **Prompt:** Angular broken rock outcrop, sharp faceted edges, weathered grey-brown surface, cracked stratified appearance.
- **Negative Prompt:** Smooth sphere, organic shapes, minimal detail
- **Triangle Budget:** 400–600
- **Pivot Notes:** Base-stable placement

### Rocks – Variant 2 (Rounded)
- **Name:** Piatră (Rotundă) / Rock (Rounded)
- **Tool:** Tripo
- **Prompt:** Rounded weathered boulder, smooth eroded surface, grey-brown patina, organic form. 1–2m diameter.
- **Negative Prompt:** Angular sharp edges, faceted shape, minimal erosion
- **Triangle Budget:** 400–600
- **Pivot Notes:** Ground-stable center

### Rocks – Variant 3 (Cracked)
- **Name:** Piatră (Fisurata) / Rock (Cracked)
- **Tool:** Tripo
- **Prompt:** Large cracked fractured rock, deep fissures, broken segments still connected, weathered surface, volcanic or sedimentary appearance.
- **Negative Prompt:** Smooth surface, minimal cracks, uniform shape
- **Triangle Budget:** 500–700
- **Pivot Notes:** Base-centered despite irregular top

### Rocks – Variant 4 (Columnar)
- **Name:** Piatră (Coloanar) / Rock (Columnar)
- **Tool:** Tripo
- **Prompt:** Tall columnar rock formation, hexagonal or irregular vertical shaft, weathered basalt-like appearance, flat base.
- **Negative Prompt:** Rounded, organic form, minimal vertical emphasis
- **Triangle Budget:** 400–600
- **Pivot Notes:** Base-centered for stability

### Dead Tree
- **Name:** Copac Mort / Dead Tree
- **Tool:** Tripo
- **Prompt:** Skeletal dead tree, bare twisted branches reaching upward, cracked grey bark, weathered broken sections. Minimal foliage, utilitarian wasteland aesthetic.
- **Negative Prompt:** Living tree with leaves, healthy bark, minimal branches
- **Triangle Budget:** 800–1,200
- **Pivot Notes:** Base-rooted, branch collision points optional

### Ruined Car Wreck
- **Name:** Mașină Distrusă / Car Wreck
- **Tool:** Tripo
- **Prompt:** Abandoned wrecked civilian car, rusted chassis exposed, shattered windows, crushed panels, destroyed engine visible. Weathered metal and broken glass.
- **Negative Prompt:** Intact vehicle, working condition, minimal rust
- **Triangle Budget:** 1,500–2,000
- **Parts to generate separately:** Chassis, Doors + body panels (bent), Engine block (visible), Wheel rims
- **Pivot Notes:** Ground-settled position

### Sandbag Line
- **Name:** Linie de Saci de Nisip / Sandbag Fortification
- **Tool:** Tripo
- **Prompt:** Linear fortification of stacked sandbags, 3–4 bags high in row formation, canvas fabric texture, filled sagging appearance, dirt and weathering visible.
- **Negative Prompt:** Symmetric perfect stacks, clean canvas, minimal dirt
- **Triangle Budget:** 1,000–1,500
- **Parts to generate separately:** Sandbag line (single modular unit to tile)
- **Pivot Notes:** Ground-level placement, tile horizontally

---

## WORKFLOW

**Generation Phase:**
1. Generate each asset at highest quality setting (highest poly count / resolution available in tool).
2. Export as **GLB** format (binary glTF with embedded textures).
3. Create one **reference image per faction** (one Coalitia gameplay screenshot, one Legiunea gameplay screenshot) to establish visual consistency.
4. For later assets within the same faction, use the tool's **image-to-3D feature** (if available) with reference imagery to maintain cohesion.

**File Management:**
- **Naming convention:** `faction_type_part.glb`
  - Example: `coalitia_tank_turret.glb`, `legiunea_refinery_silo.glb`, `generic_rock_variant1.glb`
- **Destination:** `public/models/raw/` folder (awaiting cleanup/optimization pipeline).
- **Reference images:** Store in `public/models/reference/` with names `coalitia_style.png`, `legiunea_style.png`.

**Quality Assurance:**
- Verify silhouettes read clearly from 55° top-down camera angle.
- Confirm all pivot points align to ground level for placement in engine.
- Test animation parts separately (e.g., turrets, rotor blades) for collision independence.
- Validate neutral grey panel areas are present and distinct on vehicles/buildings.

---

## Asset Count: 76

**Vehicles:** 14 (7 per faction)  
**Infantry:** 9 (3 base × 2 factions + role variants)  
**Buildings:** 22 (11 per faction)  
**Props:** 11 (generic + variants)
