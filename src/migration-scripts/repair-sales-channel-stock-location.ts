import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";

export default async function repairSalesChannelStockLocation({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const [{ data: stockLocations }, { data: stores }] = await Promise.all([
    query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
    }),
    query.graph({
      entity: "store",
      fields: ["default_sales_channel_id"],
    }),
  ]);

  const stockLocation = (stockLocations as Array<{ id: string; name?: string }>).find(
    (location) =>
      location.name?.toLowerCase().includes("warehouse") ||
      location.name?.toLowerCase().includes("europe")
  ) ?? (stockLocations as Array<{ id: string }>)[0];
  const salesChannelId = (stores as Array<{
    default_sales_channel_id?: string;
  }>)[0]?.default_sales_channel_id;

  if (!stockLocation?.id || !salesChannelId) {
    throw new Error("A stock location and a store default sales channel are both required.");
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [salesChannelId],
    },
  });

  logger.info(
    `Linked sales channel ${salesChannelId} to stock location ${stockLocation.id}.`
  );
}
