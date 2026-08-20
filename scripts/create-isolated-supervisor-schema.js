#!/usr/bin/env node
"use strict";

/*
 * Extracts table definitions only from an exported BrokerChain MySQL dump.
 * It intentionally discards DROP TABLE, INSERT, and every row of chain or
 * account state. Use only for a fresh isolated test database.
 */

const fs = require("fs");
const path = require("path");

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/create-isolated-supervisor-schema.js <dump.sql> <schema.sql>");
  process.exit(2);
}

const dump = fs.readFileSync(inputPath, "utf8");
const creates = dump.match(/CREATE TABLE[\s\S]*?;\r?\n/g) || [];
if (creates.length === 0) {
  throw new Error("No CREATE TABLE statements found; refusing to create an empty schema.");
}

const output = [
  "-- Generated schema-only file for an isolated BrokerChain Android test database.",
  "-- Source data rows, DROP statements, and credentials are intentionally excluded.",
  "SET NAMES utf8mb4;",
  "SET FOREIGN_KEY_CHECKS = 0;",
  ...creates.map((statement) => statement.trim()),
  "SET FOREIGN_KEY_CHECKS = 1;",
  "",
].join("\n\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, { encoding: "utf8", mode: 0o600 });
console.log(`Wrote ${creates.length} table definitions to ${outputPath}`);
