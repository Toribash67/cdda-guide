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
