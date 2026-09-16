import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Button, Container, Heading, Input, toast } from "@medusajs/ui";
import { useState } from "react";

const ProductImportWidget = () => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleImport = async () => {
    if (!url) {
      toast.error("Please enter a product URL");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/admin/import-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Product imported: ${data.product.title}`);
        setResult(data);
        setUrl("");
      } else {
        toast.error(`Import failed: ${data.error}`);
      }
    } catch (error) {
      toast.error("Failed to import product");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="p-6 mb-6">
      <Heading level="h2" className="mb-4">Import Product from URL</Heading>
      <p className="text-gray-500 mb-4">
        Paste a product URL from any website, and we'll automatically scrape all information, 
        add a 30% margin, and create a new product in your store.
      </p>
      
      <div className="flex gap-4 mb-4">
        <Input
          placeholder="https://example.com/your-product-page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
        />
        <Button 
          onClick={handleImport} 
          disabled={loading || !url}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {loading ? "Importing..." : "Import Product"}
        </Button>
      </div>

      {result && (
        <div className="mt-4 p-4 bg-green-50 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">✅ Product Imported Successfully!</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Title:</span> {result.product.title}
            </div>
            <div>
              <span className="text-gray-600">Original Price:</span> €{result.scraped_data.original_price}
            </div>
            <div>
              <span className="text-gray-600">Final Price (30% margin):</span> €{result.scraped_data.final_price}
            </div>
            <div>
              <span className="text-gray-600">Images Imported:</span> {result.product.images?.length || 0}
            </div>
          </div>
        </div>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.list.before",
});

export default ProductImportWidget;