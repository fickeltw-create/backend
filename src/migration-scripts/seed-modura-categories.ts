import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";

const MODURA_CATEGORY_NAMES = [
  "Vêtements & Accessoires",
  "Électronique grand public",
  "Sports & Loisirs",
  "Produits de beauté",
  "Bijoux, Lunettes & Montres",
  "Maison & Jardin",
  "Vêtements de sport & Plein air",
  "Chaussures & Accessoires",
  "Bagages, Sacs, Étuis",
  "Emballage & Impression",
  "Parents, Enfants & Jouets",
  "Hygiène perso & Ménage",
  "Médical & Santé",
  "Cadeaux & Artisanat",
  "Animalerie",
  "Fournitures de bureau",
  "Machines industrielles",
  "Équipements et machines commerciaux",
  "Machines pour le Bâtiment & la Construction",
  "Construction & Immobilier",
  "Meubles",
  "Lumière & Éclairage",
  "Électroménager",
  "Fournitures & Outils auto",
  "Pièces & Accessoires pour véhicules",
  "Bricolage & Quincaillerie",
  "Énergies renouvelables",
  "Équipements & Fournitures Électriques",
  "Sûreté & sécurité",
  "Manutention",
  "Instrument & Équipement de test",
  "Transmission d'énergie",
  "Composants électroniques",
  "Véhicules et transport",
  "Agriculture, Aliments & Boissons",
  "Matières premières",
  "Services de fabrication",
] as const;

export default async function seed_modura_categories({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: existingData } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
    filters: { name: [...MODURA_CATEGORY_NAMES] },
  });

  const existingNames = new Set(
    (existingData as Array<{ name?: string }>).map((category) => category.name)
  );
  const missingNames = MODURA_CATEGORY_NAMES.filter(
    (name) => !existingNames.has(name)
  );

  if (missingNames.length > 0) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingNames.map((name) => ({
          name,
          is_active: true,
        })),
      },
    });
  }

  logger.info(
    `Modura categories ready: ${MODURA_CATEGORY_NAMES.length} exact names (${missingNames.length} created).`
  );

  return MODURA_CATEGORY_NAMES;
}
