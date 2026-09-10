import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { CreateProductDTO, CreateProductVariantDTO } from "@medusajs/framework/types";
import { createInventoryLevelsWorkflow, createProductsWorkflow, linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";

// We'll use puppeteer for web scraping
const puppeteer = require('puppeteer');

// Interface for scraped product data
interface ScrapedProductData {
  title: string;
  description: string;
  originalPrice: number;
  priceText: string;
  priceRangeMax?: number;
  pricingNote: string;
  priceTiers: Array<{ amount: number; min_quantity: number; max_quantity?: number }>;
  images: string[];
  specifications: Record<string, string>;
  descriptionImages: string[];
  features: string[];
}

const IMPORTED_INVENTORY_QUANTITY = 100;

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = req.body as { url: string };
    const { url } = body;

    if (!url) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "URL is required");
    }

    // 1. Scrape product data from the URL
    const scrapedData = await scrapeProduct(url);

    // 2. Calculate 30% margin
    const finalPrice = Math.round(scrapedData.originalPrice * 1.3 * 100) / 100;
    const importedVariants = scrapedData.priceTiers.length > 0
      ? scrapedData.priceTiers.map((tier) => {
          const range = tier.max_quantity ? `${tier.min_quantity}-${tier.max_quantity} m2` : `${tier.min_quantity}+ m2`;
          return {
            title: `${range} - Custom Size`,
            prices: [{ currency_code: "eur", amount: Math.round(tier.amount * 1.3 * 100) / 100 }],
            options: { "Price range": range },
            manage_inventory: true,
            allow_backorder: false,
          } as unknown as CreateProductVariantDTO;
        })
      : [{
          title: "Default Variant",
          prices: [{ currency_code: "eur", amount: finalPrice }],
          options: { Default: "Default" },
          manage_inventory: true,
          allow_backorder: false,
        } as unknown as CreateProductVariantDTO];
    const productOption = scrapedData.priceTiers.length > 0
      ? { title: "Price range", values: importedVariants.map((variant) => (variant as unknown as { options: { "Price range": string } }).options["Price range"]) }
      : { title: "Default", values: ["Default"] };

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["default_sales_channel_id"],
    });
    const defaultSalesChannelId = stores[0]?.default_sales_channel_id;
    const { data: salesChannels } = await query.graph({
      entity: "sales_channel",
      fields: ["id"],
    });
    const salesChannelIds = (salesChannels as Array<{ id: string }>).map(({ id }) => id);

    const getSpecification = (label: string): string | undefined =>
      scrapedData.specifications[label]?.trim() || undefined;
    const parseNumericValue = (value: string | undefined): number | null => {
      if (!value) return null;
      const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const parseWeightToGrams = (value: string | undefined): number | null => {
      const number = parseNumericValue(value);
      if (number === null) return null;
      const normalized = value?.toLowerCase() || "";
      if (normalized.includes("kg")) return Math.round(number * 1000);
      if (normalized.includes("lb") || normalized.includes("lbs")) return Math.round(number * 453.592);
      return Math.round(number);
    };
    const parseDimensions = (value: string | undefined): number[] => {
      if (!value) return [];
      const numbers = value.match(/-?\d+(?:[.,]\d+)?/g)?.map((part) => Number(part.replace(",", "."))) || [];
      const normalized = value.toLowerCase();
      const factor = normalized.includes("mm")
        ? 1
        : normalized.includes("cm")
        ? 10
        : normalized.includes("in") || normalized.includes('"')
        ? 25.4
        : normalized.includes("m")
        ? 1000
        : 1;
      return numbers.map((number) => Math.round(number * factor));
    };
    const productMaterial = getSpecification("Material") || null;
    const sourceOrigin = getSpecification("Country of origin") || null;
    const normalizedOrigin = sourceOrigin?.toLowerCase() || "";
    const productOriginCountry = normalizedOrigin.includes("china") || normalizedOrigin.includes("chine")
      ? "cn"
      : sourceOrigin && sourceOrigin.length === 2
      ? sourceOrigin.toLowerCase()
      : sourceOrigin;
    const productWeight = parseWeightToGrams(getSpecification("Weight"));
    const dimensionValues = parseDimensions(getSpecification("Dimensions"));
    const productData: CreateProductDTO = {
      title: scrapedData.title,
      description: scrapedData.description,
      status: "published",
      is_giftcard: false,
      options: [productOption],
      variants: importedVariants,
      sales_channels: defaultSalesChannelId ? [{ id: defaultSalesChannelId }] : [],
      images: scrapedData.images.map(imgUrl => ({ url: imgUrl })),
      material: productMaterial,
      origin_country: productOriginCountry,
      weight: productWeight,
      length: dimensionValues[0] ?? null,
      width: dimensionValues[1] ?? null,
      height: dimensionValues[2] ?? null,
      metadata: {
        original_price: scrapedData.originalPrice,
        source_price_text: scrapedData.priceText,
        price_range_max: scrapedData.priceRangeMax,
        pricing_note: scrapedData.pricingNote,
        price_tiers: scrapedData.priceTiers,
        margin_applied: "30%",
        imported_inventory_quantity: IMPORTED_INVENTORY_QUANTITY,
        source_url: url,
        ...scrapedData.specifications,
        features: scrapedData.features,
      },
    } as unknown as CreateProductDTO;

    console.log('[' + 'import-product' + '] Product payload:', JSON.stringify(productData, null, 2));
    const { result: createdProducts } = await createProductsWorkflow(req.scope).run({
      input: { products: [productData] },
    });
    const product = createdProducts[0];
    if (!product) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, 'Product was not created');
    const createdVariantIds = (product.variants ?? [])
      .map((variant) => variant.id)
      .filter((id): id is string => Boolean(id));
    const { data: variantInventoryData } = await query.graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: createdVariantIds },
    });
    const typedVariantInventory = variantInventoryData as Array<{
      id: string;
      inventory_items?: Array<{ inventory_item_id?: string }>;
    }>;
    const inventoryItemIds = [...new Set(
      typedVariantInventory.flatMap((variant) =>
        (variant.inventory_items ?? [])
          .map((item) => item.inventory_item_id)
          .filter((id): id is string => Boolean(id))
      )
    )];
    const { data: stockLocationData } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
    });
    const stockLocations = stockLocationData as Array<{ id: string; name?: string }>;
    const stockLocation = stockLocations.find((location) =>
      location.name?.toLowerCase().includes("warehouse") ||
      location.name?.toLowerCase().includes("europe")
    ) ?? stockLocations[0];
    if (!stockLocation?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "No stock location is configured. Run the initial data seed before importing products."
      );
    }
    if (!inventoryItemIds.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Imported variants were not linked to inventory items."
      );
    }
    const channelsToLink = [...new Set(
      [...salesChannelIds, defaultSalesChannelId].filter(
        (id): id is string => Boolean(id)
      )
    )];
    if (channelsToLink.length) {
      await linkSalesChannelsToStockLocationWorkflow(req.scope).run({
        input: { id: stockLocation.id, add: channelsToLink },
      });
    }
    await createInventoryLevelsWorkflow(req.scope).run({
      input: {
        inventory_levels: inventoryItemIds.map((inventory_item_id) => ({
          inventory_item_id,
          location_id: stockLocation.id,
          stocked_quantity: IMPORTED_INVENTORY_QUANTITY,
        })),
      },
    });
    console.log('[' + 'import-product' + '] Inventory created:', JSON.stringify({
      quantity: IMPORTED_INVENTORY_QUANTITY,
      inventory_item_ids: inventoryItemIds,
      stock_location_id: stockLocation.id,
      sales_channel_id: defaultSalesChannelId,
    }, null, 2));

    console.log('[' + 'import-product' + '] Created product:', JSON.stringify({ id: product.id, title: product.title, images: product.images, metadata: product.metadata }, null, 2));

    res.json({
      success: true,
      message: "Product imported successfully!",
      product,
      scraped_data: {
        ...scrapedData,
        final_price: finalPrice,
        margin_calculation: `${scrapedData.originalPrice} * 1.3 = ${finalPrice}`
      }
    });
  } catch (error: unknown) {
    console.error('[import-product] Import failed:', error instanceof Error ? error.stack || error.message : error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
}

// Scraping function - optimized for made-in-china.com
async function scrapeProduct(url: string): Promise<ScrapedProductData> {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36');
    const isAlibaba = /(^|\.)alibaba\.com$/i.test(new URL(url).hostname);
    const titleSelector = isAlibaba ? "h1[data-testid=product-title], h1[class*=title], .ma-title, h1" : "h1.sr-proMainInfo-baseInfoH1.J-baseInfo-name, h1 a.title";
    const imageSelector = isAlibaba ? "img[src*=alicdn], img[data-src*=alicdn], img[class*=image], meta[property=og:image]" : "img.J-picImg-zoom-in, [fetchpriority=\"high\"][src*=\"image.made-in-china.com\"], .thumb-nail .image-container img, .filmstrip-image .image-item img";
    const priceSelector = isAlibaba ? "[class*=price], [data-testid*=price], meta[property=product:price:amount]" : ".sr-proMainInfo-baseInfo-propertyPrice .swiper-money-container, .price-wrapper .price-item .price";
    page.on('requestfailed', (request: { url(): string; failure(): { errorText?: string } | null }) => console.error('[import-product] Request failed:', request.url(), request.failure()?.errorText || 'unknown error'));
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await Promise.all([
      page.waitForSelector(titleSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Title wait failed:", error.message)),
      page.waitForSelector(imageSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Image wait failed:", error.message)),
      page.waitForSelector(priceSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Price wait failed:", error.message)),
    ]);

    // Extract basic product information - made-in-china.com specific selectors
    const title = await page.$eval(titleSelector, (el: Element) => el.textContent?.trim() || "Untitled Product").catch(() => "Untitled Product");
    
    const descriptionData = await page.$eval("body", (body: Element): { text: string; images: string[] } => {
      const fullText = body.textContent?.replace(/\s+/g, " ").trim() || "";
      const markers = [...fullText.matchAll(/description de produit|product description/gi)];
      const start = markers.length > 0 ? markers[markers.length - 1].index || 0 : -1;
      if (start < 0) return { text: "", images: [] };
      const sectionText = fullText.slice(start);
      const endMarkers = [
        /photos?\s+d.{0,3}taill/i,
        /la table de tailles/i,
        /profil de.{0,2}entreprise/i,
        /people who viewed/i,
        /company profile/i,
        /information d.entreprise/i,
        /packaging & shipping/i,
        /emballage\s+et\s+exp.dition/i,
      ];
      const endPositions = endMarkers.map((marker) => sectionText.search(marker)).filter((position) => position > 40);
      const end = endPositions.length > 0 ? Math.min(...endPositions) : sectionText.length;
      const section = sectionText.slice(0, end).replace(/^(?:description de produit|description du produit|product description)\s*/i, "").trim();
      const images = Array.from(body.querySelectorAll(".detail-content img, #productDescription img, .J-description img, .product-description img, .J-proDetail-content img")).map((img: Element) => (img as HTMLImageElement).src || img.getAttribute("data-src") || img.getAttribute("data-original") || "").filter(Boolean);
      return { text: section, images: [...new Set(images)] };
    }).catch(() => ({ text: "", images: [] as string[] }));
    const description = descriptionData.text;
    const descriptionImages = descriptionData.images;

    // Extract images - made-in-china.com image gallery selectors
    const productImages: string[] = await page.$$eval(imageSelector, (els: Element[]): string[] => {
      return els
        .map((el): string => (el as HTMLImageElement).src || (el as HTMLImageElement).getAttribute('data-src') || (el as HTMLImageElement).getAttribute('data-original') || '')
        .filter(Boolean)
        .filter((src, index, self) => self.indexOf(src) === index);
    }).catch(() => [] as string[]);

    // If no images found, try meta image
    if (productImages.length === 0) {
      const metaImage = await page.$eval('meta[property="og:image"]', (el: Element) => (el as HTMLMetaElement).content || "").catch(() => "");
      if (metaImage) productImages.push(metaImage);
    }

    productImages.push(...descriptionImages);
    // Extract price - made-in-china.com specific
    const pageText = await page.$eval("body", (el: Element) => el.textContent || "").catch(() => "");
    const priceTiers: Array<{ amount: number; min_quantity: number; max_quantity?: number }> = [];
    const parseSupplierNumber = (value: string): number => { const normalized = value.includes(",") && !value.includes(".") ? value.replace(",", ".") : value.replace(/,/g, ""); return parseFloat(normalized); };
    const suffixTierPattern = /([\d]+(?:[.,][\d]+)?)\s*(?:US\$|\$US|USD)\s*(?:\/\s*[^\d\r\n]+)?\s*(\d+)\s*(?:-|\u2013)\s*(\d+)/gi;
    for (const match of pageText.matchAll(suffixTierPattern)) {
      const amount = parseSupplierNumber(match[1]);
      if (Number.isFinite(amount)) priceTiers.push({ amount, min_quantity: Number(match[2]), max_quantity: Number(match[3]) });
    }
    const suffixLastTierPattern = /([\d]+(?:[.,][\d]+)?)\s*(?:US\$|\$US|USD)\s*(?:\/\s*[^\d\r\n]+)?\s*(\d+)\s*\+/gi;
    for (const match of pageText.matchAll(suffixLastTierPattern)) {
      const amount = parseSupplierNumber(match[1]);
      if (Number.isFinite(amount)) priceTiers.push({ amount, min_quantity: Number(match[2]) });
    }
    const tierPattern = /(?:US\$|\$US|USD)\s*([\d]+(?:[.,][\d]+)?)\s*(?:\/\s*[^\d\r\n]+)?\s*(\d+)\s*(?:-|\u2013)\s*(\d+)/gi;
    for (const match of pageText.matchAll(tierPattern)) {
      const amount = parseSupplierNumber(match[1]);
      if (Number.isFinite(amount)) priceTiers.push({ amount, min_quantity: Number(match[2]), max_quantity: Number(match[3]) });
    }
    const lastTierPattern = /(?:US\$|\$US|USD)\s*([\d]+(?:[.,][\d]+)?)\s*(?:\/\s*[^\d\r\n]+)?\s*(\d+)\s*\+/gi;
    for (const match of pageText.matchAll(lastTierPattern)) {
      const amount = parseSupplierNumber(match[1]);
      if (Number.isFinite(amount)) priceTiers.push({ amount, min_quantity: Number(match[2]) });
    }
    const priceParts = await page.$$eval(priceSelector, (els: Element[]): string[] => {
      return els.map((el: Element) => el instanceof HTMLMetaElement ? (el.content || "") : (el.textContent?.trim() || "")).filter(Boolean);
    }).catch(() => [] as string[]);
    const uniquePriceParts = [...new Set(priceParts)].filter((part: string) => /(?:US\s*\$|US\$|\$|USD)\s*[\d]/i.test(part));
    const priceText = uniquePriceParts.slice(0, 4).join(" - ");
    const detectedPriceText = isAlibaba ? (priceText || (pageText.match(/(?:US\s*\$|US\$|\$|USD)\s*[\d.,]+/gi) || []).slice(0, 4).join(" - ")) : (priceText || pageText);
    const numericPrices = (detectedPriceText.match(/[\d]+(?:[.,][\d]+)?/g) || []).map((value: string) => parseSupplierNumber(value)).filter(Number.isFinite);
    if (priceTiers.length > 0) priceTiers.sort((a, b) => a.min_quantity - b.min_quantity);
    const quantityRanges = [...pageText.matchAll(/(\d+)\s*(?:-|\u2013)\s*(\d+)\s*(?:m|M)/g), ...pageText.matchAll(/(\d+)\s*\+\s*(?:m|M)/g)];
    if (quantityRanges.length >= 2 && numericPrices.length >= quantityRanges.length) {
      priceTiers.length = 0;
      quantityRanges.slice(0, numericPrices.length).forEach((match) => {
        const amount = numericPrices[priceTiers.length];
        if (!Number.isFinite(amount)) return;
        const minQuantity = Number(match[1]);
        const maxQuantity = match[2] ? Number(match[2]) : undefined;
        priceTiers.push(maxQuantity ? { amount, min_quantity: minQuantity, max_quantity: maxQuantity } : { amount, min_quantity: minQuantity });
      });
    }
    const originalPrice = numericPrices[0] || priceTiers[0]?.amount || 0;
    const priceRangeMax = numericPrices.length > 1 ? numericPrices[1] : undefined;
    if (!originalPrice) {
      throw new Error("Could not find a product price on the source page.");
    }
    const pricingNote = priceRangeMax
      ? `Price range shown by supplier: ${detectedPriceText}. Import price uses the lowest listed price (${originalPrice}) plus 30% margin; the supplier price may vary by quantity or order terms.`
      : `Supplier price shown: ${detectedPriceText}. Import price includes a 30% margin.`;

    // Extract specifications (tables on made-in-china.com)
    const specifications: Record<string, string> = {};
    const specRows = await page.$$eval("table tr, dl, .spec-table tr, .parameter tr, .J-specification-table tr, .specification-table tr, .product-params tr, .product-specifications tr, [class*=spec] tr", (rows: Element[]) => {
      return rows.map(row => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          return {
            key: cells[0].textContent?.trim() || "",
            value: cells[1].textContent?.trim() || ""
          };
        }
        return null;
      }).filter(Boolean);
    }).catch(() => [] as {key: string, value: string}[]);

    const additionalSpecRows = await page.$$eval("dl", (lists: Element[]): { key: string; value: string }[] => {
      return lists.flatMap((list) =>
        Array.from(list.querySelectorAll("dt")).map((term) => {
          const value = term.nextElementSibling?.textContent?.trim() || "";
          return { key: term.textContent?.trim() || "", value };
        }).filter((row) => row.key && row.value)
      );
    }).catch(() => [] as { key: string; value: string }[]);
    specRows.push(...additionalSpecRows);
    
    specRows.forEach((row: {key: string, value: string} | null) => {
      if (row?.key && row?.value) specifications[row.key] = row.value;
    });

    // Normalize common supplier attributes so they remain easy to find in Medusa.
    const normalizeSpecificationKey = (value: string): string =>
      value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const requestedAttributeAliases: Record<string, string[]> = {
      Material: ["material", "materiau", "matiere"],
      "Country of origin": ["countryoforigin", "paysorigine", "paysdorigine", "origine"],
      Type: ["type", "typeduproduit", "producttype"],
      Weight: ["weight", "poids"],
      Dimensions: ["dimensions", "dimension", "taille", "size"],
    };
    Object.entries(requestedAttributeAliases).forEach(([label, aliases]) => {
      const normalizedAliases = aliases.map(normalizeSpecificationKey);
      const matchingKey = Object.keys(specifications).find((key: string) => {
        const normalizedKey = normalizeSpecificationKey(key);
        return normalizedAliases.some((alias) =>
          normalizedKey === alias || normalizedKey.includes(alias) || alias.includes(normalizedKey)
        );
      });
      if (matchingKey && specifications[matchingKey]) specifications[label] = specifications[matchingKey];
    });

    // Extract features (lists on made-in-china.com)
    const features = await page.$$eval('.features li, .advantage li, [class*="feature"] li', (lis: Element[]) => {
      return lis.map(li => li.textContent?.trim() || "").filter(text => text);
    }).catch(() => [] as string[]);

    await browser.close();

    // Fallback values if scraping fails
    return {
      title,
      description: (description || `${title} - Premium quality product available at Modura`).trim(),
      descriptionImages,
      originalPrice,
      priceText,
      priceRangeMax,
      priceTiers,
      pricingNote,
      images: [...new Set(productImages.concat(descriptionImages).map((image: string): string => { try { return new URL(image, page.url()).href; } catch { return ""; } }).filter((image: string) => image.startsWith("http://") || image.startsWith("https://")))],
      specifications,
      features
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}



