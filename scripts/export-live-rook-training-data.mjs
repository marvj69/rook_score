import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTrainingSnapshot } from "./rook-training-normalizer.mjs";

const DEFAULT_PROJECT_ID = "rookscore-dadfd";
const DEFAULT_OUTPUT_DIRECTORY = "Logistic Regression Model/generated";

function parseArgs(argv) {
  const options = {
    projectId: DEFAULT_PROJECT_ID,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") options.projectId = argv[++index];
    else if (arg === "--output-dir") options.outputDirectory = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/export-live-rook-training-data.mjs [options]

Options:
  --project <id>       Firebase project ID (default: ${DEFAULT_PROJECT_ID})
  --output-dir <path>  Private generated output directory
  --help               Show this help

This command performs a read-only Firestore runQuery. It does not update or
delete Firebase documents and never writes raw user IDs or player names.`);
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function sourceKey(documentName) {
  return `source_${createHash("sha256").update(documentName).digest("hex").slice(0, 20)}`;
}

function loadFirebaseAuthModule() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.FIREBASE_TOOLS_AUTH_MODULE,
    path.join(os.homedir(), ".npm-global/lib/node_modules/firebase-tools/lib/auth.js"),
  ].filter(Boolean);

  try {
    candidates.push(require.resolve("firebase-tools/lib/auth.js"));
  } catch {}

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error(
    "Firebase CLI authentication was not found. Install firebase-tools and sign in with firebase login.",
  );
}

async function getFirebaseAccessToken() {
  const auth = loadFirebaseAuthModule();
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("No Firebase CLI session is available. Run firebase login --reauth.");
  }
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  if (!token?.access_token) throw new Error("Firebase CLI did not return an access token.");
  return token.access_token;
}

async function queryRookData(projectId) {
  const accessToken = await getFirebaseAccessToken();
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + "/databases/(default)/documents:runQuery";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "rookData" }],
      },
    }),
  });
  if (!response.ok) throw new Error(`Firestore read-only query failed (${response.status}).`);

  const rows = await response.json();
  return rows
    .map(row => row.document)
    .filter(Boolean)
    .map(document => {
      const data = decodeFirestoreFields(document.fields || {});
      return {
        sourceKey: sourceKey(document.name),
        games: Array.isArray(data.savedGames) ? data.savedGames : [],
      };
    });
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputDirectory = path.resolve(repoRoot, options.outputDirectory);
  const sourceDocuments = await queryRookData(options.projectId);
  const { dataset, audit } = normalizeTrainingSnapshot(sourceDocuments, {
    projectId: options.projectId,
  });

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const datasetPath = path.join(outputDirectory, "games_normalized_v2.json");
  const auditPath = path.join(outputDirectory, "normalization_audit_v2.json");
  await writePrivateJson(datasetPath, dataset);
  await writePrivateJson(auditPath, audit);

  console.log(JSON.stringify({
    firebaseOperation: "read-only runQuery",
    firebaseMutated: false,
    datasetPath,
    auditPath,
    rawStoredGameCopies: audit.rawStoredGameCopies,
    normalizedLogicalGames: audit.normalizedLogicalGames,
    quarantinedLogicalGames: audit.quarantinedLogicalGames,
    nonTerminalTrainingObservations: audit.nonTerminalTrainingObservations,
    identityCoveragePct: audit.identity.completeIdentityCoveragePct,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

export const __test = {
  decodeFirestoreValue,
  decodeFirestoreFields,
  sourceKey,
};
