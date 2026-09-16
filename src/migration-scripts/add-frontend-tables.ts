import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { neon } from '@neondatabase/serverless';

export default async function add_frontend_tables({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  
  const databaseUrl = process.env.DATABASE_URL!;
  const sql = neon(databaseUrl);

  logger.info("Creating frontend tables (leads and reservations)...");

  // Enable UUID extension
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  logger.info("UUID extension ready");

  // Create leads table
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type VARCHAR(50) NOT NULL CHECK (type IN ('quote', 'financing', 'distributor', 'installer', 'contact')),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      company VARCHAR(255),
      model VARCHAR(255),
      budget VARCHAR(100),
      region VARCHAR(255),
      partnership_type VARCHAR(100),
      message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;
  logger.info("Leads table created or already exists");

  // Create reservations table
  await sql`
    CREATE TABLE IF NOT EXISTS reservations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      model VARCHAR(255) NOT NULL,
      stripe_session_id VARCHAR(255),
      status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
      amount DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;
  logger.info("Reservations table created or already exists");

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reservations_email ON reservations(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reservations_stripe_session_id ON reservations(stripe_session_id)`;
  logger.info("Indexes created");

  logger.info("✅ Frontend tables migration completed successfully!");
}