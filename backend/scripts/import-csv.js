import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { csvService } from "../src/services/csv.service.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    // eslint-disable-next-line no-console
    console.error("Usage: node scripts/import-csv.js <path-to-csv>");
    process.exit(1);
  }

  const abs = path.resolve(filePath);
  const csvText = fs.readFileSync(abs, "utf8");
  const preview = await csvService.previewCsv(csvText);

  const result = await csvService.commitMappedCsv({
    csvText: preview.csvText,
    mapping: preview.autoMapping,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ autoMapping: preview.autoMapping, result }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

