import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
} from "@medusajs/framework/utils";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";

export default async function repairSalesChannelStockLocations({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const [{ data: stockLocations }, { data: salesChannels }] = await Promise.all([
    query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
    }),
    query.graph({
      entity: "sales_channel",
      fields: ["id"],
    }),
  ]);

  const stockLocation = (stockLocations as Array<{ id: string; name?: string }>).find(
    (location) =>
      location.name?.toLowerCase().includes("warehouse") ||
      location.name?.toLowerCase().includes("europe")
  ) ?? (stockLocations as Array<{ id: string }>)[0];
  const salesChannelIds = (salesChannels as Array<{ id: string }>).map(
    (channel) => channel.id
  );

  if (!stockLocation?.id || !salesChannelIds.length) {
    logger.warn(
      "Skipping sales-channel stock-location repair: no stock location or sales channel exists."
    );
    return;
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: salesChannelIds,
    },
  });

  logger.info(
    `Linked ${salesChannelIds.length} sales channel(s) to stock location ${stockLocation.id}.`
  );
}
