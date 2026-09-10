import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows";

const STOCKED_QUANTITY = 100;

export default async function ensureCatalogInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });
  const stockLocation = (stockLocations as Array<{ id: string; name?: string }>).find(
    (location) =>
      location.name?.toLowerCase().includes("warehouse") ||
      location.name?.toLowerCase().includes("europe")
  ) ?? (stockLocations as Array<{ id: string }>)[0];

  if (!stockLocation?.id) {
    throw new Error("A stock location is required.");
  }

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "location_levels.location_id"],
  });
  const missingInventoryItems = (inventoryItems as Array<{
    id: string;
    location_levels?: Array<{ location_id?: string }>;
  }>).filter(
    (item) =>
      !item.location_levels?.some(
        (level) => level.location_id === stockLocation.id
      )
  );

  if (!missingInventoryItems.length) {
    logger.info("Every inventory item already has a level at the warehouse.");
    return;
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: missingInventoryItems.map((item) => ({
        inventory_item_id: item.id,
        location_id: stockLocation.id,
        stocked_quantity: STOCKED_QUANTITY,
      })),
    },
  });

  logger.info(
    `Created warehouse inventory for ${missingInventoryItems.length} item(s).`
  );
}
