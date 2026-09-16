const { Medusa } = require("@medusajs/medusa")

const medusa = new Medusa()
medusa.init()

async function listPaymentProviders() {
  try {
    const paymentModule = medusa.modules.payment
    const providers = await paymentModule.listPaymentProviders()
    console.log("Available payment providers:", providers)
  } catch (error) {
    console.error("Error listing payment providers:", error)
  }
}

listPaymentProviders()