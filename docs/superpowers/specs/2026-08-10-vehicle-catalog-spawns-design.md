# Vehicles catalog + spawn locations — design

**Date:** 2026-08-10
**Branch:** `vehicle-catalog-spawns` (off `main`)

## Goal

Two-part feature for the guide:

1. Add **Vehicles** to the front-page catalog list.
2. On each vehicle's page, show **where it spawns** in the world (overmap
   specials) and **which spawn groups** it belongs to.

Vehicle detail (`Vehicle.svelte`), routing, search, and `Catalog.svelte` are
already generic over `vehicle`; the only real work is the catalog list entry and
the green-field spawn parsing.

## Part 1 — Catalog wiring (trivial)

Two edits in `src/App.svelte`:

1. Add to the Catalogs `<ul>` (next to Vehicle Parts):
   `<li><a href="/vehicle{location.search}">{t("Vehicles")}</a></li>`
2. Add `"vehicle"` to the `randomableItemTypes` set, so the random-page link can
   land on vehicles.

No changes needed to routing, `Catalog.svelte` (vehicle falls through to a
single ungrouped list, which is correct), search, or `Thing.svelte` (already
maps `vehicle: Vehicle`).

## Part 2 — Spawn data

### Game JSON shapes (verified against live data)

- `place_vehicles` (explicit placement, in ~220 mapgen files):
  `{ vehicle, x, y, chance: 0-100, rotation?, status?, fuel? }`. `chance` is
  always a scalar percent (never a range). No `repeat`/count semantics.
- Object-level `vehicles` symbol map (~63 mapgen files) and palette `vehicles`
  (~12 palette files): `{ sym: { vehicle, chance?, rotation? } }` — structurally
  identical to `furniture` symbol maps.
- `vehicle_group` (`vehicle_groups.json`, ~60 entries):
  `{ type: "vehicle_group", id, vehicles: [[vehicle_id, weight], ...] }`.

**Critical quirk:** the `vehicle` field in `place_vehicles` / palette is a
`mapgen_value<vgroup_id>` that ALWAYS resolves through the vehicle_group table.
In C++, every vehicle prototype auto-registers as its own single-entry group
(weight 100). So resolution must: look up `byIdMaybe("vehicle_group", field)` —
if found, use its weighted `vehicles` array; else treat `field` as a direct
vehicle id (an implicit 100% single-entry group). There is no such auto-group
fallback in item_group parsing, so this differs from the item path.

### Types (`src/types.ts`)

- Uncomment + type on `MapgenObject`: `place_vehicles?: MapgenPlaceVehicle[]`
  and `vehicles?` (symbol map). Uncomment + type `PaletteData.vehicles?`
  (symbol map).
- New types:
  - `MapgenPlaceVehicle = { vehicle: MapgenValue; x; y; chance?: number; rotation?; status?; fuel? }`
    (mirror `MapgenPlaceFurniture`).
  - Palette/object symbol-map value: `{ vehicle: MapgenValue; chance?: number; rotation? }`
    (mirror the furniture `PlaceMapping` value; symbol map keyed like
    `PlaceMappingAlternative`).
  - `export type VehicleGroup = { id: string; type: "vehicle_group"; vehicles: (string | [string, number])[] }`
    near `Vehicle`.
- Add `vehicle_group: VehicleGroup` to `SupportedTypes`.
- No `CddaData` constructor changes: it is generic over `obj.type`, so
  `data.byType("vehicle_group")` / `byId` work once the type exists in loaded
  JSON.

### Spawn logic (`src/types/item/spawnLocations.ts`)

Mirror the **furniture** path (not the item path — vehicle placement is
symbol-keyed / explicit-coordinate, never inline in the ASCII `rows` grid).
Produce a `Loot` = `Map<vehicle_id, { prob, expected }>`.

- `resolveVehicleField(data, field) -> Map<vehicle_id, weightFraction>`:
  run `field` through `getMapgenValueDistribution` (handles plain string,
  `distribution`, `param`); for each resulting id, `byIdMaybe("vehicle_group", id)`
  — if found, normalize its weighted `vehicles` array into fractions summing to
  1; else `Map([[id, 1]])` (implicit single-entry group). Combine with the
  mapgen-value distribution weights.
- `parseVehiclePalette(data, palette) -> Map<sym, Loot>`: like
  `parseFurniturePalette`. For each `palette.vehicles[sym] = { vehicle, chance }`,
  resolve the field and emit, per resolved vehicle,
  `{ prob: (chance ?? 100)/100 * frac, expected: same }`. Recurse into referenced
  `palettes` (string, `distribution`) via `mergePalettes` / `attenuatePalette`,
  same as furniture.
- `getVehiclesForMapgen(data, mapgen) -> Loot` (WeakMap-cached like the others):
  - `const palette = parseVehiclePalette(data, mapgen.object)` — handles the
    object-level `vehicles` symbol map plus referenced palettes.
  - Count symbol occurrences in `mapgen.object.rows`, multiply each symbol's
    `Loot` by its count (`repeatItemChance([count, count])`), like furniture.
  - `place_vehicles`: each entry -> resolve `vehicle` field ->
    `{ prob: (chance ?? 100)/100 * frac, expected: same }` per resolved vehicle.
  - `collection([...])` everything; delete any null/empty ids.
- `vehicleByOMSAppearance = lazily(data => computeLootByOMSAppearance(data, mg => getVehiclesForMapgen(data, mg)))`
  — reuses the existing memoized OMS-appearance machinery (as loot/furniture/terrain do).
- `vehicleGroupMembership = lazily(data => ...)`: reverse index
  `vehicle_id -> Array<{ group_id, weight, groupTotal }>`, built by walking all
  `vehicle_group`s and summing each group's total weight. Only explicit JSON
  groups (not the implicit self-groups).

### Presentation

- New `src/types/vehicle/VehicleSpawns.svelte`, prop `vehicle_id: string`:
  1. **Spawn groups** section: for each membership entry, show `group_id`,
     `weight`, and `weight / groupTotal` as a percentage. Group names are plain
     text (vehicle_group has no detail page to link to). Omit the section if the
     vehicle is in no explicit groups.
  2. Delegate to the existing `LocationTable.svelte` unchanged:
     `id={vehicle_id}`, `loots={vehicleByOMSAppearance(data)}`,
     `heading={t("Where it spawns")}`. Both existing columns (Avg. Count +
     Chance) are kept as-is.
- `Vehicle.svelte`: render `<VehicleSpawns vehicle_id={item.id} />`.

## Testing

Follow the existing `spawnLocations` vitest pattern:

- `resolveVehicleField`: bare prototype -> `{id: 1}`; explicit group -> weighted
  fractions summing to 1; missing/unknown id -> that id at 100% (implicit group),
  matching game behavior.
- `getVehiclesForMapgen`: small synthetic mapgen exercising both a
  `place_vehicles` entry and a palette/object symbol map; assert the resulting
  `Loot` probabilities.
- Verify the app typechecks and builds.

## Scope

**In scope:** catalog entry, `place_vehicles` + object/palette `vehicles` symbol
maps + `vehicle_group` resolution, the two vehicle-page sections.

**Out of scope:**

- Legacy `vehicle_spawn` / `vehicle_placement` (only ~5 objects, C++ consumer
  path appears unreferenced by current mapgen — dead).
- Displaying `fuel` / `status` / `rotation`.
- A `vehicle_group` detail page or browsable catalog.
- Reverse "which vehicles spawn here" on overmap_special pages.
