import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const ENV_FILE = path.resolve(process.cwd(), ".env");
const IGNORED_ENV_FILES = [
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.vault",
];

if (!globalThis.__appEnvLoaded) {
  globalThis.__appEnvLoaded = true;

  const extraEnvFiles = IGNORED_ENV_FILES.filter((name) =>
    fs.existsSync(path.resolve(process.cwd(), name)),
  );
  if (extraEnvFiles.length > 0) {
    console.warn(`Ignoring extra env files (not loaded): ${extraEnvFiles.join(", ")}`);
  }

  if (!fs.existsSync(ENV_FILE)) {
    console.warn("No .env file found; using existing process environment only");
  } else {
    const fromFile = dotenv.parse(fs.readFileSync(ENV_FILE));
    const override = process.env.NODE_ENV !== "production";
    dotenv.config({ path: ENV_FILE, override, quiet: true });
    console.log(
      `Loaded env from .env only | keys=${Object.keys(fromFile).length} | override=${override} | OPENAI_API_KEY matches file=${process.env.OPENAI_API_KEY === fromFile.OPENAI_API_KEY}`,
    );
  }
}
