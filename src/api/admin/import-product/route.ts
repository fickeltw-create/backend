﻿﻿﻿﻿import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { CreateProductDTO, CreateProductVariantDTO } from "@medusajs/framework/types";
import { createInventoryLevelsWorkflow, createProductsWorkflow, linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows";

// We'll use puppeteer for web scraping
const puppeteer = require('puppeteer');

// Interface for scraped product data
interface AmazonVariant {
  name: string;
  value: string;
  price?: number;
}

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
  amazonVariants: AmazonVariant[];
}

const IMPORTED_INVENTORY_QUANTITY = 100;
const MAX_IMPORTED_IMAGES = 10;

const normalizeImportedImages = (images: string[]): string[] => {
  const seen = new Set<string>();
  const normalized = images
    .map((image) => image.trim())
    .filter((image) => Boolean(image) && /^https?:\/\//i.test(image) && !image.startsWith('data:'))
    .filter((image) => {
      const url = image.toLowerCase();
      return !url.includes('svg') && !url.includes('gif');
    })
    .map((image) => {
      const url = image.replace(/\?.*$/, '');
      return url.endsWith('/') ? url.slice(0, -1) : url;
    })
    .filter((image) => {
      const incoming = image.toLowerCase();
      return incoming.includes('.jpg') || incoming.includes('.jpeg') || incoming.includes('.png') || incoming.includes('.webp');
    })
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, MAX_IMPORTED_IMAGES);

  return normalized;
};

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
    // Validate price before calculating margin to prevent nonsensical prices
    if (!scrapedData.originalPrice || scrapedData.originalPrice <= 0 || scrapedData.originalPrice > 10000) {
      throw new Error(`Invalid product price detected: ${scrapedData.originalPrice}. Please check the URL and try again.`);
    }
    const finalPrice = Math.round(scrapedData.originalPrice * 1.3 * 100) / 100;
    // Create variants from scraped Amazon variants (size/color) or fall back to default
    const importedVariants = scrapedData.amazonVariants.length > 0
      ? scrapedData.amazonVariants.map((variant) => {
          const variantPrice = variant.price ? Math.round(variant.price * 1.3 * 100) / 100 : finalPrice;
          return {
            title: `${variant.value} - ${variant.name}`,
            prices: [{ currency_code: "eur", amount: variantPrice }],
            options: { [variant.name]: variant.value },
            manage_inventory: true,
            allow_backorder: false,
          } as unknown as CreateProductVariantDTO;
        })
      : scrapedData.priceTiers.length > 0
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
    
    // Create product options from unique variant names (supports multiple options like Size, Color)
    const uniqueOptionNames = [...new Set(scrapedData.amazonVariants.map(v => v.name))];
    const productOption = uniqueOptionNames.length > 0
      ? uniqueOptionNames.map(name => ({
          title: name,
          values: [...new Set(scrapedData.amazonVariants.filter(v => v.name === name).map(v => v.value))]
        }))
      : scrapedData.priceTiers.length > 0
        ? [{ title: "Price range", values: importedVariants.map((variant) => (variant as unknown as { options: { "Price range": string } }).options["Price range"]) }]
        : [{ title: "Default", values: ["Default"] }];

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
    const importedImages = normalizeImportedImages(scrapedData.images);
    const productData: CreateProductDTO = {
      title: scrapedData.title,
      description: scrapedData.description,
      status: "published",
      is_giftcard: false,
      options: productOption,
      variants: importedVariants,
      sales_channels: defaultSalesChannelId ? [{ id: defaultSalesChannelId }] : [],
      images: importedImages.map(imgUrl => ({ url: imgUrl })),
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
    const hostname = new URL(url).hostname.toLowerCase();
    const isAlibaba = /(^|\.)alibaba\.com$/i.test(hostname);
    const isAliExpress = /(^|\.)aliexpress\.(com|us|ru|es|fr|it|de|nl|pl)$/i.test(hostname);
    const isAmazon = /(^|\.)amazon\.[a-z.]+$/i.test(hostname);
    const titleSelector = isAmazon
      ? "#productTitle, meta[property='og:title'], meta[name='twitter:title'], title"
      : isAlibaba || isAliExpress
        ? "meta[property='og:title'], meta[name='twitter:title'], h1[data-testid=product-title], h1[class*=title], .ma-title, h1"
        : "h1.sr-proMainInfo-baseInfoH1.J-baseInfo-name, h1 a.title";
    const imageSelector = isAmazon
      ? "#landingImage, #imgTagWrapperId img, #altImages img, meta[property='og:image'], img[src*=amazon], img[data-old-hires*=amazon], img[data-a-dynamic-image]"
      : isAlibaba || isAliExpress
        ? "meta[property='og:image'], meta[property='og:image:url'], img[src*=alicdn], img[data-src*=alicdn], img[data-original*=alicdn], img[class*=image]"
        : "img.J-picImg-zoom-in, [fetchpriority=\"high\"][src*=\"image.made-in-china.com\"], .thumb-nail .image-container img, .filmstrip-image .image-item img";
    const priceSelector = isAmazon
      ? "#corePriceDisplay_desktop_feature_div .a-offscreen, #corePrice_feature_div .a-price, #newBuyBoxPrice, #priceblock_ourprice, #priceblock_dealprice, #desktop_unifiedPrice .a-price, meta[property='product:price:amount'], meta[itemprop='price'], [class*=price], [data-testid*=price]"
      : isAlibaba || isAliExpress
        ? "meta[property='product:price:amount'], meta[itemprop='price'], [class*=price], [data-testid*=price]"
        : ".sr-proMainInfo-baseInfo-propertyPrice .swiper-money-container, .price-wrapper .price-item .price";
    page.on('requestfailed', (request: { url(): string; failure(): { errorText?: string } | null }) => console.error('[import-product] Request failed:', request.url(), request.failure()?.errorText || 'unknown error'));
    await page.goto(url, { waitUntil: isAliExpress ? 'domcontentloaded' : 'networkidle2', timeout: 60000 });
    if (isAliExpress) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await Promise.all([
      page.waitForSelector(titleSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Title wait failed:", error.message)),
      page.waitForSelector(imageSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Image wait failed:", error.message)),
      page.waitForSelector(priceSelector, { timeout: 30000 }).catch((error: Error) => console.warn("Price wait failed:", error.message)),
    ]);

    // Extract basic product information - made-in-china.com specific selectors
    let title = await page.$eval(titleSelector, (el: Element) => {
      if (el instanceof HTMLMetaElement) return el.content?.trim() || "";
      return el.textContent?.trim() || "";
    }).catch(() => "Untitled Product");
    
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
        // Amazon-specific footer markers to exclude footer content
        /Amazon MusicStream/i,
        /AbeBooksBooks/i,
        /Conditions of Use & Sale/i,
        /Privacy Notice/i,
        /© 1996-\d{4}, Amazon.com/i,
        /Host an Amazon Hub/i,
        /See More Make Money with Us/i,
      ];
      const endPositions = endMarkers.map((marker) => sectionText.search(marker)).filter((position) => position > 40);
      const end = endPositions.length > 0 ? Math.min(...endPositions) : sectionText.length;
      const section = sectionText.slice(0, end).replace(/^(?:description de produit|description du produit|product description)\s*/i, "").trim();
      const images = Array.from(body.querySelectorAll(".detail-content img, #productDescription img, .J-description img, .product-description img, .J-proDetail-content img")).map((img: Element) => (img as HTMLImageElement).src || img.getAttribute("data-src") || img.getAttribute("data-original") || "").filter(Boolean);
      return { text: section || fullText.slice(0, 2000), images: [...new Set(images)] };
    }).catch(() => ({ text: "", images: [] as string[] }));
    let description = descriptionData.text;
    const descriptionImages = descriptionData.images;

    const structuredData = await page.evaluate(() => {
      const readJson = (value: string | null): unknown => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      };
      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map((script) => readJson(script.textContent))
        .filter(Boolean);
      const stateScripts = Array.from(document.scripts)
        .map((script) => script.textContent || "")
        .filter((text) => /price|image|sku|description/i.test(text));
      const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content") || "";
      const images = Array.from(document.images)
        .flatMap((image) => [
          image.currentSrc,
          image.src,
          image.getAttribute("data-src"),
          image.getAttribute("data-original"),
          image.getAttribute("srcset")?.split(",").map((part) => part.trim().split(/\s+/)[0]),
        ])
        .flat()
        .filter((value): value is string => Boolean(value));
      const rows = Array.from(document.querySelectorAll("table tr, dl, li"))
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("th, td, dt, dd"))
            .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() || "")
            .filter(Boolean);
          return cells.length >= 2 ? { key: cells[0], value: cells.slice(1).join(" ") } : null;
        })
        .filter((row): row is { key: string; value: string } => Boolean(row));
      return {
        jsonLd,
        stateScripts,
        title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]'),
        description: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
        price: meta('meta[property="product:price:amount"]') || meta('meta[itemprop="price"]'),
        currency: meta('meta[property="product:price:currency"]') || meta('meta[itemprop="priceCurrency"]'),
        sku: meta('meta[itemprop="sku"]'),
        images,
        rows,
        bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() || "",
      };
    }).catch(() => null);

    const amazonData = isAmazon ? await page.evaluate(() => {
      const readText = (selector: string): string => {
        const element = document.querySelector(selector);
        return element ? (element.textContent || element.getAttribute('content') || '').replace(/\s+/g, ' ').trim() : '';
      };
      const toImageList = (...values: Array<string | null | undefined>): string[] => {
        return values
          .filter((value): value is string => Boolean(value))
          .flatMap((value) => {
            const trimmed = value.trim();
            if (!trimmed) return [];
            try {
              if (trimmed.startsWith('{')) return Object.keys(JSON.parse(trimmed));
            } catch {
              // Ignore malformed JSON fragments.
            }
            return [trimmed];
          })
          .filter((value, index, array) => array.indexOf(value) === index);
      };
      const title = readText('#productTitle') || document.title.replace(/\s*:\s*Amazon(?:\.[a-z.]+)?$/i, '').trim() || 'Untitled Product';
      const description = readText('#productDescription') || readText('#feature-bullets') || readText('#detailBullets_feature_div') || readText('meta[property="og:description"]') || '';
      const priceText = readText('#corePriceDisplay_desktop_feature_div .a-offscreen')
        || readText('#priceblock_ourprice')
        || readText('#priceblock_dealprice')
        || readText('#newBuyBoxPrice')
        || readText('meta[property="product:price:amount"]')
        || '';
      const priceValue = (() => {
        const match = priceText.match(/\d+(?:[.,]\d+)?/);
        return match ? Number(match[0].replace(',', '.')) : null;
      })();
      const imageValues = toImageList(
        ...Array.from(document.querySelectorAll('#landingImage, #imgTagWrapperId img, #altImages img, .a-dynamic-image')).flatMap((img) => [
          // Convert thumbnail URLs to full resolution by removing size parameters
          (img as HTMLImageElement).src?.replace(/\._[A-Za-z0-9]+_.*\.jpg/, '.jpg')?.replace(/\?.*$/, ''),
          (img as HTMLImageElement).getAttribute('data-old-hires')?.replace(/\._[A-Za-z0-9]+_.*\.jpg/, '.jpg')?.replace(/\?.*$/, ''),
          (img as HTMLImageElement).getAttribute('data-src')?.replace(/\._[A-Za-z0-9]+_.*\.jpg/, '.jpg')?.replace(/\?.*$/, ''),
          (img as HTMLImageElement).getAttribute('data-a-dynamic-image'),
        ]),
        document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.replace(/\._[A-Za-z0-9]+_.*\.jpg/, '.jpg')?.replace(/\?.*$/, '') || '',
      );
      const specificationMap: Record<string, string> = {};
      Array.from(document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, table tr')).forEach((row) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        if (cells.length >= 2) {
          const key = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
          const value = (cells[1].textContent || '').replace(/\s+/g, ' ').trim();
          if (key && value) specificationMap[key] = value;
        }
      });
      return {
        title,
        description,
        priceText,
        priceValue,
        images: imageValues.filter((value) => /^https?:\/\//i.test(value)),
        specifications: specificationMap,
      };
    }).catch(() => null) : null;

    // Extract Amazon variants (size/color options with their prices)
    const amazonVariants: Array<{
      name: string;
      value: string;
      price?: number;
    }> = [];
    
    if (isAmazon) {
      // Detect Amazon's variant dropdowns/swatches
      const variantElements = await page.$$('#variation_color_name li, #variation_size_name li, .a-dropdown-prompt, #size_name_0, #color_name_0');
      for (const variantEl of variantElements) {
        const variantText = await variantEl.evaluate((el: Element) => el.textContent?.trim() || '');
        const variantPrice = await variantEl.$eval('.a-price-whole', (el: Element) => el.textContent?.trim() || '').catch(() => '');
        if (variantText) {
          // Check if it's a size or color variant
          if (variantText.match(/cm|inch|size|x/i) || variantPrice) {
            amazonVariants.push({
              name: variantText.includes('cm') || variantText.includes('x') ? 'Size' : 'Color',
              value: variantText,
              price: variantPrice ? parseFloat(variantPrice.replace(',', '.')) : undefined
            });
          }
        }
      }
      title = amazonData?.title || title;
      description = amazonData?.description || description;
    }

    // Extract images - made-in-china.com image gallery selectors
    const productImages: string[] = await page.$$eval(imageSelector, (els: Element[]): string[] => {
      return els
        .map((el): string => el instanceof HTMLMetaElement
          ? el.content || ''
          : (el as HTMLImageElement).src || el.getAttribute('data-src') || el.getAttribute('data-original') || '')
        .filter(Boolean)
        .filter((src, index, self) => self.indexOf(src) === index);
    }).catch(() => [] as string[]);
    if (isAmazon && amazonData?.images?.length) {
      productImages.push(...amazonData.images);
    }

    // If no images found, try meta image
    if (productImages.length === 0) {
      const metaImage = await page.$eval('meta[property="og:image"]', (el: Element) => (el as HTMLMetaElement).content || "").catch(() => "");
      if (metaImage) productImages.push(metaImage);
    }

    productImages.push(...descriptionImages);

    if (isAliExpress && structuredData) {
      const structuredObjects = structuredData.jsonLd.flatMap((value: any) =>
        Array.isArray(value) ? value : [value]
      );
      const productObject = structuredObjects.find((value: any) =>
        value && (value["@type"] === "Product" || value.product)
      ) as any;
      const productOffer = productObject?.offers?.[0] || productObject?.offers || productObject?.product?.offers?.[0];
      const structuredImages = [
        ...(Array.isArray(productObject?.image) ? productObject.image : [productObject?.image]),
        ...(Array.isArray(productObject?.product?.image) ? productObject.product.image : [productObject?.product?.image]),
        ...structuredData.images,
      ].filter((image): image is string => typeof image === "string");
      productImages.push(...structuredImages);

      const embeddedText = structuredData.stateScripts.join(" ");
      if (!title || title === "Untitled Product") {
        const structuredTitle = productObject?.name || productObject?.product?.name || structuredData.title;
        if (structuredTitle) title = String(structuredTitle).trim();
      }
      if (!description) description = structuredData.description || productObject?.description || "";
    }
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
    const uniquePriceParts = [...new Set(priceParts)].filter((part: unknown) => typeof part === 'string' && /(?:US\s*\$|US\$|\$|USD|€|EUR)\s*[\d]/i.test(part)) as string[];
    const amazonPriceText = isAmazon ? amazonData?.priceText || '' : '';
    const priceText = isAmazon ? amazonPriceText : uniquePriceParts.slice(0, 4).join(" - ");
    const detectedPriceText = isAmazon
      ? (priceText || pageText)
      : isAlibaba || isAliExpress
        ? (priceText || (pageText.match(/(?:US\s*\$|US\$|USD|EUR|€|\$)\s*[\d.,]+/gi) || []).slice(0, 4).join(" - "))
        : (priceText || pageText);
    // Only capture prices that are preceded by currency symbols to avoid picking up dimensions (46.9 x 33.5 etc.)
    const currencyPriceMatches = detectedPriceText.match(/(?:US\s*\$|US\$|\$|USD|€|EUR)\s*([\d]+(?:[.,][\d]+)?)/gi) || [];
    const numericPrices = currencyPriceMatches
      .map((match: string) => {
         const numMatch = match.match(/[\d]+(?:[.,][\d]+)?/);
         return numMatch ? parseSupplierNumber(numMatch[0]) : null;
       })
      .filter((value: number | null): value is number => Number.isFinite(value));
    if (isAmazon && amazonData?.priceValue && !numericPrices.includes(amazonData.priceValue)) {
      numericPrices.unshift(amazonData.priceValue);
    }
    if (isAliExpress && structuredData) {
      const structuredObjects = structuredData.jsonLd.flatMap((value: any) => Array.isArray(value) ? value : [value]);
      const productObject = structuredObjects.find((value: any) => value && (value["@type"] === "Product" || value.product)) as any;
      const productOffer = productObject?.offers?.[0] || productObject?.offers || productObject?.product?.offers?.[0];
      const embeddedText = structuredData.stateScripts.join(" ");
      const priceCandidates = [
        structuredData.price,
        productOffer?.price,
        productOffer?.lowPrice,
        ...((embeddedText.match(/(?:salePrice|originalPrice|discountPrice|price)["']?\s*[:=]\s*["']?([0-9]+(?:[.,][0-9]{1,2})?)/gi) || [])
          .map((match: string) => match.match(/[0-9]+(?:[.,][0-9]{1,2})?/)?.[0] || "")),
        ...((structuredData.bodyText.match(/(?:€|EUR|US\$|USD|\$)\s*[0-9]+(?:[.,][0-9]{1,2})?/gi) || [])
          .map((value: string) => value.match(/[0-9]+(?:[.,][0-9]{1,2})?/)?.[0] || "")),
      ].filter(Boolean);
      const structuredPrice = priceCandidates
        .map((value) => parseFloat(String(value).replace(",", ".")))
        .find((value) => Number.isFinite(value) && value > 0);
      if (structuredPrice && !numericPrices.includes(structuredPrice)) numericPrices.unshift(structuredPrice);
    }
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
    
    // Filter out unrealistic prices (greater than €10,000 is likely a parsing error)
    const validPrices = numericPrices.filter((price: number) => price > 0 && price < 10000);
    const finalOriginalPrice = validPrices[0] || priceTiers.find(tier => tier.amount > 0 && tier.amount < 10000)?.amount || 0;
    
    if (!finalOriginalPrice) {
      throw new Error("Could not find a valid product price on the source page. Please check the URL and try again.");
    }
    const pricingNote = priceRangeMax
      ? `Price range shown by supplier: ${detectedPriceText}. Import price uses the lowest listed price (${finalOriginalPrice}) plus 30% margin; the supplier price may vary by quantity or order terms.`
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
    if (isAliExpress && structuredData) {
      structuredData.rows.forEach(({ key, value }: { key: string; value: string }) => {
        if (key && value && !specifications[key]) specifications[key] = value;
      });
    }

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

    // Clean images for all platforms: remove thumbnails, get full resolution
    const cleanImages = productImages.map(img => {
      // Amazon image cleaning
      if (img.includes('amazon.com')) {
        return img.replace(/\._[A-Za-z0-9]+_.*\.jpg/, '.jpg').replace(/\?.*$/, '');
      }
      // Alibaba/AliExpress image cleaning
      return img.replace(/_\d+x\d+\./, '.').replace(/\?.*$/, '');
    }).filter((img, index, self) => self.indexOf(img) === index); // Remove duplicates

    const safeImages = normalizeImportedImages([
      ...cleanImages,
      ...descriptionImages,
    ]);

    // Fallback values if scraping fails
    return {
      title,
      description: (description || `${title} - Premium quality product available at Modura`).trim(),
      descriptionImages,
      originalPrice: finalOriginalPrice,
      priceText,
      priceRangeMax,
      priceTiers,
      pricingNote,
      images: safeImages,
      specifications,
      features,
      amazonVariants // Pass variants to Medusa to create options
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}