// Diagnoses which env file the backend loads. Never prints secret values.
import fs from "fs";
import dotenv from "dotenv";

const shape = (value) =>
  value == null
    ? "(missing)"
    : {
        length: value.length,
        looksLikeOpenAiKey: value.startsWith("sk-"),
        wrappedInQuotes: /^["']|["']$/.test(value),
        containsWhitespace: /\s/.test(value),
        containsCR: value.includes("\r"),
      };

const preexisting = process.env.OPENAI_API_KEY;

const raw = fs.readFileSync(".env");
console.log("cwd:", process.cwd());
console.log(".env size:", raw.length, "| BOM:", raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);
console.log(".env keys:", Object.keys(dotenv.parse(raw)).join(", "));
console.log(".env OPENAI_API_KEY:", shape(dotenv.parse(raw).OPENAI_API_KEY));
console.log("shell OPENAI_API_KEY (would win over .env):", shape(preexisting));
console.log(".env.development.local exists:", fs.existsSync(".env.development.local"));

dotenv.config();
const effective = process.env.OPENAI_API_KEY;
console.log("effective after dotenv.config():", shape(effective));
console.log("effective equals .env value:", effective === dotenv.parse(raw).OPENAI_API_KEY);
