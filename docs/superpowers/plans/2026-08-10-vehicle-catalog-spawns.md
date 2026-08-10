# Vehicle Catalog + Spawn Locations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Vehicles" to the guide's front-page catalog, and on each vehicle's page show which spawn groups it belongs to and which overmap locations it spawns in.

**Architecture:** Part 1 is two small edits in `App.svelte` (routing/detail/search are already generic over `vehicle`). Part 2 mirrors the existing **furniture** spawn path in `src/types/item/spawnLocations.ts` — vehicle placement is symbol-keyed in palettes / explicit-coordinate in `place_vehicles`, never inline in the ASCII `rows` grid — producing a `Loot` map keyed by vehicle id, rendered by the existing `LocationTable.svelte`.

**Tech Stack:** Svelte 3/4, TypeScript, Vitest. Data comes from Cataclysm-DDA JSON loaded into `CddaData`.

## Global Constraints

- All source-file edits happen in the worktree: `/mnt/ssd_pool/martin/repos/cdda-guide/.claude/worktrees/cdda-fork-deploy`. Never edit the shared checkout.
- Typecheck command: `npm run validate` (runs `svelte-check && tsc --noEmit`).
- Run a single unit-test file: `npx vitest run src/types/item/spawnLocations.test.ts`.
- Format before commit: `npx prettier -w <files>` (precommit hook runs `prettier -c` via lint-staged).
- `ItemChance = { prob: number; expected: number }`; `Loot = Map<string, ItemChance>`. For vehicles, `prob === expected` (a vehicle is placed 0-or-1 times, no repeat semantics).
- The **vehicle_group quirk**: a `vehicle` field always resolves through the vehicle_group table; a bare id with no matching group is an implicit 100% single-entry group (its own id). This differs from item_group parsing — do not add a group fallback anywhere else.
- `CddaData` needs no constructor changes: `_byTypeById` indexes every raw object by `mapType(obj.type)`, so `byIdMaybe("vehicle_group", id)` and `byType("vehicle_group")` work at runtime once such objects are loaded.

---

### Task 1: Add Vehicles to the catalog (Part 1)

**Files:**
- Modify: `src/App.svelte` (catalog `<ul>` ~line 516; `randomableItemTypes` set ~line 257-270)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (independent quick win).

- [ ] **Step 1: Add the catalog list entry**

In `src/App.svelte`, find this line in the Catalogs `<ul>`:

```svelte
      <li><a href="/vehicle_part{location.search}">{t("Vehicle Parts")}</a></li>
```

Add a new `<li>` immediately **before** it:

```svelte
      <li><a href="/vehicle{location.search}">{t("Vehicles")}</a></li>
```

- [ ] **Step 2: Add vehicle to the random-page set**

In the `randomableItemTypes` set, find:

```ts
  "vehicle_part",
```

Add on the line **before** it:

```ts
  "vehicle",
```

- [ ] **Step 3: Typecheck**

Run: `npm run validate`
Expected: PASS (no new type errors).

- [ ] **Step 4: Verify the wiring**

Run: `npx vitest run src/App.test.ts` if it exists, otherwise `npm run build`.
Expected: build succeeds. (Manual visual check later: `/` shows a "Vehicles" link; `/vehicle` lists vehicles.)

- [ ] **Step 5: Format and commit**

```bash
npx prettier -w src/App.svelte
git add src/App.svelte
git commit -m "feat: add Vehicles to the front-page catalog"
```

---

### Task 2: Type plumbing for vehicles (types.ts)

**Files:**
- Modify: `src/types.ts` (MapgenObject ~1246-1247; PaletteData ~1360; new types near `MapgenPlaceFurniture` ~1220 and `Vehicle` ~1892; `SupportedTypes` ~2139)

**Interfaces:**
- Consumes: `MapgenValue`, `PlaceMapping<T>`, `PlaceList<T>` (existing).
- Produces:
  - `MapgenVehicle = { vehicle: MapgenValue; chance?: number; rotation?: number | [number, number]; fuel?: number; status?: number }`
  - `MapgenObject.vehicles?: PlaceMapping<MapgenVehicle>`, `MapgenObject.place_vehicles?: PlaceList<MapgenVehicle>`
  - `PaletteData.vehicles?: PlaceMapping<MapgenVehicle>`
  - `VehicleGroup = { id: string; type: "vehicle_group"; vehicles: (string | [string, number])[] }`
  - `SupportedTypes.vehicle_group: VehicleGroup`

- [ ] **Step 1: Add the `MapgenVehicle` type**

In `src/types.ts`, immediately after the `MapgenPlaceFurniture` type (~line 1222), add:

```ts
export type MapgenVehicle = {
  vehicle: MapgenValue;
  chance?: number;
  rotation?: number | [number, number];
  fuel?: number;
  status?: number;
};
```

- [ ] **Step 2: Uncomment + type the MapgenObject fields**

In `interface MapgenObject`, replace:

```ts
  //place_vehicles?: PlaceVehicle[];
  //vehicles?: ObjectVehicles;
```

with:

```ts
  place_vehicles?: PlaceList<MapgenVehicle>;
  vehicles?: PlaceMapping<MapgenVehicle>;
```

- [ ] **Step 3: Uncomment + type the PaletteData field**

In `interface PaletteData`, replace:

```ts
  //vehicles?: Vehicles;
```

with:

```ts
  vehicles?: PlaceMapping<MapgenVehicle>;
```

- [ ] **Step 4: Add the `VehicleGroup` type**

In `src/types.ts`, immediately before `export type Vehicle = {` (~line 1892), add:

```ts
export type VehicleGroup = {
  id: string;
  type: "vehicle_group";
  vehicles: (string | [string, number])[];
};
```

- [ ] **Step 5: Register in SupportedTypes**

In `export type SupportedTypes`, find:

```ts
  vehicle_part: VehiclePart;
```

Add immediately **after** it:

```ts
  vehicle_group: VehicleGroup;
```

- [ ] **Step 6: Typecheck**

Run: `npm run validate`
Expected: PASS. (The new fields are optional and the new type has no consumers yet, so nothing breaks.)

- [ ] **Step 7: Format and commit**

```bash
npx prettier -w src/types.ts
git add src/types.ts
git commit -m "feat: add vehicle spawn types (MapgenVehicle, VehicleGroup)"
```

---

### Task 3: `resolveVehicleField` — vehicle_group resolution

**Files:**
- Modify: `src/types/item/spawnLocations.ts` (add near `getMapgenValueDistribution` ~line 478)
- Test: `src/types/item/spawnLocations.test.ts`

**Interfaces:**
- Consumes: `getMapgenValueDistribution(val): Map<string, number>` (existing, module-private — call it directly, same file); `data.byIdMaybe("vehicle_group", id)`.
- Produces: `export function resolveVehicleField(data: CddaData, field: raw.MapgenValue): Map<string, number>` — maps each resolved vehicle id to a weight fraction (fractions within one field sum to ~1).

- [ ] **Step 1: Write the failing tests**

In `src/types/item/spawnLocations.test.ts`, add `resolveVehicleField` to the import from `./spawnLocations`, then add:

```ts
describe("resolveVehicleField()", () => {
  it("treats a bare id with no group as a 100% single-entry group", () => {
    const got = resolveVehicleField(emptyData, "car");
    expect(got).toStrictEqual(new Map([["car", 1]]));
  });
  it("resolves an explicit group into normalized weight fractions", () => {
    const data = new CddaData([
      {
        type: "vehicle_group",
        id: "g",
        vehicles: [
          ["car", 700],
          ["bike", 300],
        ],
      },
    ]);
    const got = resolveVehicleField(data, "g");
    expect(got).toStrictEqual(
      new Map([
        ["car", 0.7],
        ["bike", 0.3],
      ]),
    );
  });
  it("treats an unknown id as itself at 100%", () => {
    const got = resolveVehicleField(emptyData, "nonexistent");
    expect(got).toStrictEqual(new Map([["nonexistent", 1]]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "resolveVehicleField"`
Expected: FAIL with "resolveVehicleField is not a function" (or import error).

- [ ] **Step 3: Implement `resolveVehicleField`**

In `src/types/item/spawnLocations.ts`, after `getMapgenValueDistribution` (~line 509), add:

```ts
export function resolveVehicleField(
  data: CddaData,
  field: raw.MapgenValue,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [id, prob] of getMapgenValueDistribution(field).entries()) {
    const group = data.byIdMaybe("vehicle_group", id);
    const members: [string, number][] = group
      ? (group.vehicles ?? []).map((v) =>
          Array.isArray(v) ? [v[0], v[1]] : [v, 1],
        )
      : [[id, 1]];
    const total = members.reduce((m, [, w]) => m + w, 0) || 1;
    for (const [vid, weight] of members) {
      result.set(vid, (result.get(vid) ?? 0) + prob * (weight / total));
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "resolveVehicleField"`
Expected: PASS (3 tests).

- [ ] **Step 5: Format and commit**

```bash
npx prettier -w src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git add src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git commit -m "feat: add resolveVehicleField for vehicle_group resolution"
```

---

### Task 4: `parseVehiclePalette` + `getVehiclesForMapgen`

**Files:**
- Modify: `src/types/item/spawnLocations.ts` (add `parseVehiclePalette` near `parseFurniturePalette` ~line 871; add `getVehiclesForMapgen` near `getFurnitureForMapgen` ~line 627)
- Test: `src/types/item/spawnLocations.test.ts`

**Interfaces:**
- Consumes: `resolveVehicleField` (Task 3); `parsePlaceMapping`, `attenuatePalette`, `mergePalettes`, `collection`, `repeatItemChance` (existing, same file); `data.byId("palette", id)`.
- Produces:
  - `export function parseVehiclePalette(data: CddaData, palette: raw.PaletteData): Map<string, Loot>`
  - `export function getVehiclesForMapgen(data: CddaData, mapgen: raw.Mapgen): Loot`

- [ ] **Step 1: Write the failing test**

In `src/types/item/spawnLocations.test.ts`, add `getVehiclesForMapgen` to the import from `./spawnLocations` and `Mapgen` is already imported. Add:

```ts
describe("getVehiclesForMapgen()", () => {
  it("handles place_vehicles with an explicit group and a palette symbol", () => {
    const data = new CddaData([
      {
        type: "vehicle_group",
        id: "g",
        vehicles: [
          ["car", 700],
          ["bike", 300],
        ],
      },
      {
        type: "mapgen",
        method: "json",
        om_terrain: "test_ter",
        object: {
          rows: ["V", "V"],
          vehicles: { V: { vehicle: "motorcycle", chance: 50 } },
          place_vehicles: [{ vehicle: "g", x: 0, y: 0, chance: 100 }],
        },
      } as Mapgen,
    ]);
    const loot = getVehiclesForMapgen(data, data.byType("mapgen")[0]);
    // place_vehicles: group "g" at 100% -> car 0.7, bike 0.3
    expect(loot.get("car")).toStrictEqual({ prob: 0.7, expected: 0.7 });
    expect(loot.get("bike")).toStrictEqual({ prob: 0.3, expected: 0.3 });
    // palette symbol "V" appears twice at 50% each:
    //   prob = 1-(1-0.5)^2 = 0.75 ; expected = 0.5+0.5 = 1
    expect(loot.get("motorcycle")).toStrictEqual({ prob: 0.75, expected: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "getVehiclesForMapgen"`
Expected: FAIL with "getVehiclesForMapgen is not a function".

- [ ] **Step 3: Implement `parseVehiclePalette`**

In `src/types/item/spawnLocations.ts`, after `parseFurniturePalette` (~line 909), add:

```ts
const vehiclePaletteCache = new WeakMap<raw.PaletteData, Map<string, Loot>>();
export function parseVehiclePalette(
  data: CddaData,
  palette: raw.PaletteData,
): Map<string, Loot> {
  if (vehiclePaletteCache.has(palette))
    return vehiclePaletteCache.get(palette)!;
  const vehicles = parsePlaceMapping(
    palette.vehicles,
    function* ({ vehicle, chance = 100 }) {
      const loot: Loot = new Map();
      for (const [vid, frac] of resolveVehicleField(data, vehicle).entries()) {
        const p = (chance / 100) * frac;
        loot.set(vid, { prob: p, expected: p });
      }
      yield loot;
    },
  );
  const palettes = (palette.palettes ?? []).flatMap((val) => {
    if (typeof val === "string") {
      return [parseVehiclePalette(data, data.byId("palette", val))];
    } else if ("distribution" in val) {
      const opts = val.distribution;
      function prob<T>(it: T | [T, number]) {
        return Array.isArray(it) ? it[1] : 1;
      }
      function id<T>(it: T | [T, number]) {
        return Array.isArray(it) ? it[0] : it;
      }
      const totalProb = opts.reduce((m, it) => m + prob(it), 0);
      return opts.map((it) =>
        attenuatePalette(
          parseVehiclePalette(data, data.byId("palette", id(it))),
          prob(it) / totalProb,
        ),
      );
    } else return [];
  });
  const ret = mergePalettes([vehicles, ...palettes]);
  vehiclePaletteCache.set(palette, ret);
  return ret;
}
```

- [ ] **Step 4: Implement `getVehiclesForMapgen`**

In `src/types/item/spawnLocations.ts`, after `getFurnitureForMapgen` (~line 657), add:

```ts
const vehiclesForMapgenCache = new WeakMap<raw.Mapgen, Loot>();
export function getVehiclesForMapgen(
  data: CddaData,
  mapgen: raw.Mapgen,
): Loot {
  if (vehiclesForMapgenCache.has(mapgen))
    return vehiclesForMapgenCache.get(mapgen)!;
  const palette = parseVehiclePalette(data, mapgen.object);
  const place_vehicles: Loot[] = (mapgen.object.place_vehicles ?? []).map(
    ({ vehicle, chance = 100 }) => {
      const loot: Loot = new Map();
      for (const [vid, frac] of resolveVehicleField(data, vehicle).entries()) {
        const p = (chance / 100) * frac;
        loot.set(vid, { prob: p, expected: p });
      }
      return loot;
    },
  );
  const additional_items = collection([...place_vehicles]);
  const countByPalette = new Map<string, number>();
  for (const row of mapgen.object.rows ?? [])
    for (const char of row)
      if (palette.has(char))
        countByPalette.set(char, (countByPalette.get(char) ?? 0) + 1);
  const items: Loot[] = [];
  for (const [sym, count] of countByPalette.entries()) {
    const loot = palette.get(sym)!;
    const multipliedLoot: Loot = new Map();
    for (const [id, chance] of loot.entries()) {
      multipliedLoot.set(id, repeatItemChance(chance, [count, count]));
    }
    items.push(multipliedLoot);
  }
  items.push(additional_items);
  const loot = collection(items);
  vehiclesForMapgenCache.set(mapgen, loot);
  return loot;
}
```

Note: `parseVehiclePalette(data, mapgen.object)` handles the object-level `vehicles` symbol map because `MapgenObject` is structurally assignable to `PaletteData` (all `PaletteData` fields are optional and the shared `vehicles` field has an identical type).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "getVehiclesForMapgen"`
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
npx prettier -w src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git add src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git commit -m "feat: parse vehicle palettes and mapgen vehicle placement"
```

---

### Task 5: Public entry points — `vehicleByOMSAppearance` + `vehicleGroupMembership`

**Files:**
- Modify: `src/types/item/spawnLocations.ts` (add near `furnitureByOMSAppearance` ~line 352)
- Test: `src/types/item/spawnLocations.test.ts`

**Interfaces:**
- Consumes: `getVehiclesForMapgen` (Task 4); `computeLootByOMSAppearance` and `lazily` (existing, same file); `data.byType("vehicle_group")`.
- Produces:
  - `export const vehicleByOMSAppearance: (data: CddaData) => Promise<Map<string, { loot: Loot; ids: string[] }>>`
  - `export type VehicleGroupMembership = { group_id: string; weight: number; groupTotal: number }`
  - `export const vehicleGroupMembership: (data: CddaData) => Map<string, VehicleGroupMembership[]>`

- [ ] **Step 1: Write the failing test**

In `src/types/item/spawnLocations.test.ts`, add `vehicleGroupMembership` to the import from `./spawnLocations`, then add:

```ts
describe("vehicleGroupMembership()", () => {
  it("indexes each vehicle to its groups with weight and group total", () => {
    const data = new CddaData([
      {
        type: "vehicle_group",
        id: "city_vehicles",
        vehicles: [
          ["car", 700],
          ["bike", 300],
        ],
      },
      {
        type: "vehicle_group",
        id: "road_vehicles",
        vehicles: [["car", 400]],
      },
    ]);
    const got = vehicleGroupMembership(data);
    expect(got.get("car")).toStrictEqual([
      { group_id: "city_vehicles", weight: 700, groupTotal: 1000 },
      { group_id: "road_vehicles", weight: 400, groupTotal: 400 },
    ]);
    expect(got.get("bike")).toStrictEqual([
      { group_id: "city_vehicles", weight: 300, groupTotal: 1000 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "vehicleGroupMembership"`
Expected: FAIL with "vehicleGroupMembership is not a function".

- [ ] **Step 3: Implement both entry points**

In `src/types/item/spawnLocations.ts`, after the `furnitureByOMSAppearance`/`terrainByOMSAppearance` block (~line 356), add:

```ts
export const vehicleByOMSAppearance = lazily((data: CddaData) =>
  computeLootByOMSAppearance(data, (mg) => getVehiclesForMapgen(data, mg)),
);

export type VehicleGroupMembership = {
  group_id: string;
  weight: number;
  groupTotal: number;
};
export const vehicleGroupMembership = lazily((data: CddaData) => {
  const membership = new Map<string, VehicleGroupMembership[]>();
  for (const group of data.byType("vehicle_group")) {
    if (!group.id) continue;
    const members: [string, number][] = (group.vehicles ?? []).map((v) =>
      Array.isArray(v) ? [v[0], v[1]] : [v, 1],
    );
    const groupTotal = members.reduce((m, [, w]) => m + w, 0);
    for (const [vid, weight] of members) {
      if (!membership.has(vid)) membership.set(vid, []);
      membership.get(vid)!.push({ group_id: group.id, weight, groupTotal });
    }
  }
  return membership;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types/item/spawnLocations.test.ts -t "vehicleGroupMembership"`
Expected: PASS.

- [ ] **Step 5: Full-file test + typecheck**

Run: `npx vitest run src/types/item/spawnLocations.test.ts && npm run validate`
Expected: PASS (all spawnLocations tests + typecheck).

- [ ] **Step 6: Format and commit**

```bash
npx prettier -w src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git add src/types/item/spawnLocations.ts src/types/item/spawnLocations.test.ts
git commit -m "feat: add vehicleByOMSAppearance and vehicleGroupMembership entry points"
```

---

### Task 6: `VehicleSpawns.svelte` + mount in `Vehicle.svelte`

**Files:**
- Create: `src/types/vehicle/VehicleSpawns.svelte`
- Modify: `src/types/Vehicle.svelte` (import + render after the `<ItemTable ... />` at ~line 244)
- Test: manual/visual + typecheck + build

**Interfaces:**
- Consumes: `vehicleByOMSAppearance`, `vehicleGroupMembership` (Task 5); `LocationTable.svelte` (existing, `{ id, loots, heading }`).
- Produces: `VehicleSpawns` component with prop `vehicle_id: string`.

- [ ] **Step 1: Create the component**

Create `src/types/vehicle/VehicleSpawns.svelte`:

```svelte
<script lang="ts">
import { getContext } from "svelte";
import { t } from "@transifex/native";

import { CddaData } from "../../data";
import {
  vehicleByOMSAppearance,
  vehicleGroupMembership,
} from "../item/spawnLocations";
import LocationTable from "../item/LocationTable.svelte";

export let vehicle_id: string;

const data = getContext<CddaData>("data");
const _context = "Vehicle";

const memberships = (vehicleGroupMembership(data).get(vehicle_id) ?? [])
  .slice()
  .sort((a, b) => b.weight / b.groupTotal - a.weight / a.groupTotal);
</script>

{#if memberships.length}
  <section>
    <h1>{t("Spawn groups", { _context })}</h1>
    <ul>
      {#each memberships as m}
        <li>
          {m.group_id} &mdash; {m.weight}
          ({((m.weight / m.groupTotal) * 100).toFixed(1)}%)
        </li>
      {/each}
    </ul>
  </section>
{/if}

<LocationTable
  id={vehicle_id}
  loots={vehicleByOMSAppearance(data)}
  heading={t("Where it spawns", { _context })} />
```

- [ ] **Step 2: Mount it in `Vehicle.svelte`**

In `src/types/Vehicle.svelte`, add to the imports block (after `import ItemTable from "./item/ItemTable.svelte";` ~line 18):

```ts
import VehicleSpawns from "./vehicle/VehicleSpawns.svelte";
```

At the end of the markup, after the final line:

```svelte
<ItemTable loot={data.flattenItemGroupLoot(itemGroupFromVehicle(item))} />
```

add:

```svelte
<VehicleSpawns vehicle_id={item.id} />
```

- [ ] **Step 3: Typecheck**

Run: `npm run validate`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`, open a vehicle page (e.g. `/vehicle/car`). Confirm a "Spawn groups" list (groups + %) and a "Where it spawns" table (overmap specials with Avg. Count + Chance) appear. Confirm `/` shows "Vehicles" and `/vehicle` lists vehicles.

- [ ] **Step 6: Format and commit**

```bash
npx prettier -w src/types/vehicle/VehicleSpawns.svelte src/types/Vehicle.svelte
git add src/types/vehicle/VehicleSpawns.svelte src/types/Vehicle.svelte
git commit -m "feat: show spawn groups and spawn locations on vehicle pages"
```

---

## Self-Review

**Spec coverage:**
- Part 1 catalog `<li>` + `randomableItemTypes` → Task 1. ✓
- Types: `MapgenVehicle`, `place_vehicles`/`vehicles`/`PaletteData.vehicles`, `VehicleGroup`, `SupportedTypes` → Task 2. ✓
- `resolveVehicleField` (group quirk) → Task 3. ✓
- `parseVehiclePalette` + `getVehiclesForMapgen` (object-level `vehicles` handled via structural assignability) → Task 4. ✓
- `vehicleByOMSAppearance` + `vehicleGroupMembership` → Task 5. ✓
- `VehicleSpawns.svelte` (both sections, reuse `LocationTable` unchanged) + `Vehicle.svelte` mount → Task 6. ✓
- Out of scope (legacy `vehicle_spawn`/`vehicle_placement`, fuel/status/rotation display, vehicle_group detail page, reverse OMS view) → not implemented. ✓

**Type consistency:** `resolveVehicleField(data, field): Map<string, number>` is called identically in Tasks 4 and its own test. `VehicleGroupMembership` fields (`group_id`, `weight`, `groupTotal`) match between Task 5's type, its test, and Task 6's component. `getVehiclesForMapgen(data, mapgen): Loot` signature matches the `computeLootByOMSAppearance` callback in Task 5. `MapgenVehicle` (Task 2) is the destructured shape in Task 4's `{ vehicle, chance }`.

**Placeholder scan:** none — every code step has full content.
