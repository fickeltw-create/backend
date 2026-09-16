import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createProductCategoriesWorkflow } from "@medusajs/medusa/core-flows";

interface ProductCategory {
  name: string;
  handle: string;
  description: string;
  is_active: boolean;
  parent_category_id?: string;
}

export default async function seed_categories({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  
  logger.info("Seeding your product categories...");

  // First create all root categories
  const rootCategories: ProductCategory[] = [
    { name: "Maison & Jardin", handle: "maison-jardin", description: "Tous les produits pour la maison et le jardin", is_active: true },
    { name: "Construction & Immobilier", handle: "construction-immobilier", description: "Tous les produits liés à la construction et l'immobilier", is_active: true },
    { name: "Vêtements & Accessoires", handle: "vetements-accessoires", description: "Vêtements et accessoires de mode", is_active: true },
    { name: "Électronique grand public", handle: "electronique-grand-public", description: "Appareils électroniques grand public", is_active: true },
    { name: "Sports & Loisirs", handle: "sports-loisirs", description: "Produits de sport et loisirs", is_active: true },
    { name: "Produits de beauté", handle: "produits-beaute", description: "Cosmétiques et produits de beauté", is_active: true },
    { name: "Bijoux, Lunettes & Montres", handle: "bijoux-lunettes-montres", description: "Bijouterie, lunetterie et horlogerie", is_active: true },
    { name: "Emballage & Impression", handle: "emballage-impression", description: "Services d'emballage et d'impression", is_active: true },
    { name: "Parents, Enfants & Jouets", handle: "parents-enfants-jouets", description: "Produits pour parents, enfants et jouets", is_active: true },
    { name: "Hygiène perso & Ménage", handle: "hygiene-perso-menage", description: "Produits d'hygiène personnelle et de ménage", is_active: true },
    { name: "Médical & Santé", handle: "medical-sante", description: "Produits médicaux et de santé", is_active: true },
    { name: "Cadeaux & Artisanat", handle: "cadeaux-artisanat", description: "Cadeaux et produits artisanaux", is_active: true },
    { name: "Animalerie", handle: "animalerie", description: "Produits pour animaux domestiques", is_active: true },
    { name: "Fournitures de bureau", handle: "fournitures-bureau", description: "Fournitures de bureau", is_active: true },
    { name: "Machines industrielles", handle: "machines-industrielles", description: "Machinerie industrielle", is_active: true },
    { name: "Équipements et machines commerciaux", handle: "equipements-machines-commerciaux", description: "Équipement pour commerces", is_active: true },
    { name: "Pièces & Accessoires pour véhicules", handle: "pieces-accessoires-vehicules", description: "Pièces de rechange et accessoires automobiles", is_active: true },
    { name: "Manutention", handle: "manutention", description: "Matériel de manutention", is_active: true },
    { name: "Instrument & Équipement de test", handle: "instrument-equipement-test", description: "Matériel de mesure et de test", is_active: true },
    { name: "Transmission d'énergie", handle: "transmission-energie", description: "Systèmes de transmission d'énergie", is_active: true },
    { name: "Composants électroniques", handle: "composants-electroniques", description: "Composants électroniques pour circuits", is_active: true },
    { name: "Véhicules et transport", handle: "vehicules-transport", description: "Véhicules et solutions de transport", is_active: true },
    { name: "Agriculture, Aliments & Boissons", handle: "agriculture-aliments-boissons", description: "Produits agricoles, alimentaires et boissons", is_active: true },
    { name: "Matières premières", handle: "matieres-premieres", description: "Matières premières industrielles", is_active: true },
    { name: "Services de fabrication", handle: "services-fabrication", description: "Services de fabrication industrielle", is_active: true }
  ];

  // Run root category creation workflow
  const { result: createdRootCategories } = await createProductCategoriesWorkflow(container).run({
    input: { product_categories: rootCategories }
  });
  logger.info(`Created ${createdRootCategories.length} root categories`);

  // Create category ID map for subcategories (fixed TypeScript error)
  const categoryMap = new Map(
    (createdRootCategories as Array<{ name: string; id: string }>).map(cat => [cat.name, cat.id])
  );

  // Create subcategories
  const subCategories = [
    { name: "Meubles", handle: "meubles", parent_category_name: "Maison & Jardin", description: "Meubles pour tous les espaces de la maison", is_active: true },
    { name: "Lumière & Éclairage", handle: "lumiere-eclairage", parent_category_name: "Maison & Jardin", description: "Solutions d'éclairage intérieur et extérieur", is_active: true },
    { name: "Électroménager", handle: "electromenager", parent_category_name: "Maison & Jardin", description: "Appareils électroménagers pour la maison", is_active: true },
    { name: "Bricolage & Quincaillerie", handle: "bricolage-quincaillerie", parent_category_name: "Maison & Jardin", description: "Outils et matériel de bricolage", is_active: true },
    { name: "Machines pour le Bâtiment & la Construction", handle: "machines-batiment-construction", parent_category_name: "Construction & Immobilier", description: "Machinerie spécialisée pour les chantiers", is_active: true },
    { name: "Équipements & Fournitures Électriques", handle: "equipements-fournitures-electriques", parent_category_name: "Construction & Immobilier", description: "Matériel électrique pour les installations", is_active: true },
    { name: "Sûreté & sécurité", handle: "surete-securite", parent_category_name: "Construction & Immobilier", description: "Solutions de sécurité pour bâtiments", is_active: true },
    { name: "Énergies renouvelables", handle: "energies-renouvelables", parent_category_name: "Construction & Immobilier", description: "Produits d'énergie verte et renouvelable", is_active: true },
    { name: "Vêtements de sport & Plein air", handle: "vetements-sport-plein-air", parent_category_name: "Vêtements & Accessoires", description: "Vêtements pour activités sportives", is_active: true },
    { name: "Chaussures & Accessoires", handle: "chaussures-accessoires", parent_category_name: "Vêtements & Accessoires", description: "Chaussures et accessoires de mode", is_active: true },
    { name: "Bagages, Sacs, Étuis", handle: "bagages-sacs-etuis", parent_category_name: "Vêtements & Accessoires", description: "Sacs et bagages pour tous usages", is_active: true },
    { name: "Fournitures & Outils auto", handle: "fournitures-outils-auto", parent_category_name: "Pièces & Accessoires pour véhicules", description: "Outils et fournitures automobiles", is_active: true }
  ].map(sub => {
    const parentId = categoryMap.get(sub.parent_category_name);
    return { ...sub, parent_category_id: parentId, parent_category_name: undefined };
  });

  // Run subcategory creation workflow
  if (subCategories.length > 0) {
    const { result: createdSubCategories } = await createProductCategoriesWorkflow(container).run({
      input: { product_categories: subCategories.filter(sub => sub.parent_category_id) }
    });
    logger.info(`Created ${createdSubCategories.length} subcategories`);
  }

  logger.info("✅ All categories imported successfully! Refresh your Medusa admin to see them all.");
}