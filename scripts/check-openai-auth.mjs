// Verifies the configured OpenAI key authenticates. Prints status only, never the key.
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ quiet: true });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
try {
  const models = await client.models.list();
  console.log("auth: OK |", models.data.length, "models visible");
} catch (error) {
  console.log("auth: FAILED |", error.status, error.code ?? error.message);
  process.exitCode = 1;
}
