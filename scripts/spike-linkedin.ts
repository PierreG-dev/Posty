// =============================================================================
// scripts/spike-linkedin.ts — SPIKE JETABLE (CDC-01 §17, Lot 0)
// =============================================================================
//
// Objectif : lever 3 incertitudes AVANT tout code de production.
//   1. Publication texte via /rest/posts.
//   2. Caractérisation de l'échappement du `commentary` (§10.5).
//   3. Publication avec image (Images API).
//   4. Tentative de post avec PDF (Documents API).
//   5. Tentative de premier commentaire (/rest/socialActions/{urn}/comments).
//
// Ce script :
//   - N'A AUCUNE DÉPENDANCE sur l'app (pas de Mongo, pas de Next).
//   - PUBLIE DE VRAIS POSTS sur ton profil quand --live est passé.
//   - Le mode par défaut est --dry (safe).
//   - --cleanup DELETE /rest/posts/{urn} sur tous les URN créés pendant le run.
//   - Émet docs/spike-linkedin.json : synthèse structurée à reporter dans le .md.
//
// Prérequis :
//   LINKEDIN_ACCESS_TOKEN=<token 3-legged OAuth avec scopes openid profile w_member_social>
//   LINKEDIN_API_VERSION=<YYYYMM, ex 202506>       (optionnel, défaut ci-dessous)
//   LINKEDIN_AUTHOR_URN=<urn:li:person:...>        (optionnel, sinon /v2/userinfo)
//
// Usage :
//   tsx scripts/spike-linkedin.ts --dry
//   tsx scripts/spike-linkedin.ts --live --only=text
//   tsx scripts/spike-linkedin.ts --live --cleanup
//   tsx scripts/spike-linkedin.ts --live --only=chars --chars="( ) @ |"
//
// =============================================================================

import { writeFile } from "node:fs/promises";
import path from "node:path";

// --- Config ------------------------------------------------------------------

const DEFAULT_API_VERSION = "202506";
const CHARS_TO_TEST = ["(", ")", "[", "]", "{", "}", "<", ">", "@", "|", "~", "_", "*"] as const;

type TestId = "text" | "chars" | "image" | "pdf" | "comment";
const ALL_TESTS: TestId[] = ["text", "chars", "image", "pdf", "comment"];

interface Cli {
  live: boolean;
  cleanup: boolean;
  only: TestId[];
  chars: string[];
  charBatchDelayMs: number;
}

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const has = (f: string) => args.includes(f);
  const get = (f: string): string | undefined => {
    const a = args.find((x) => x.startsWith(`${f}=`));
    return a ? a.slice(f.length + 1) : undefined;
  };

  const dry = has("--dry");
  const live = has("--live");
  if (dry && live) throw new Error("--dry et --live sont mutuellement exclusifs.");

  const onlyRaw = get("--only");
  const only = onlyRaw
    ? (onlyRaw.split(",").map((s) => s.trim()) as TestId[])
    : ALL_TESTS;
  for (const t of only) {
    if (!ALL_TESTS.includes(t)) throw new Error(`--only : test inconnu "${t}"`);
  }

  const charsRaw = get("--chars");
  const chars = charsRaw
    ? charsRaw.split(/[,\s]+/).filter((x) => x.length === 1)
    : [...CHARS_TO_TEST];

  return {
    live: live && !dry,
    cleanup: has("--cleanup"),
    only,
    chars,
    charBatchDelayMs: Number(get("--delay-ms") ?? "500"),
  };
}

interface Env {
  token: string;
  apiVersion: string;
  authorUrn: string | null;
}

function loadEnv(): Env {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "LINKEDIN_ACCESS_TOKEN manquant. Récupère un token 3-legged OAuth (scopes: openid profile w_member_social) sur https://www.linkedin.com/developers/tools/oauth/token-generator et exporte-le.",
    );
  }
  return {
    token,
    apiVersion: process.env.LINKEDIN_API_VERSION ?? DEFAULT_API_VERSION,
    authorUrn: process.env.LINKEDIN_AUTHOR_URN ?? null,
  };
}

// --- HTTP client -------------------------------------------------------------

interface HttpResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickHeaders(h: Headers): Record<string, string> {
  const keep = ["x-restli-id", "content-type", "x-li-fabric", "x-li-uuid", "retry-after"];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = h.get(k);
    if (v) out[k] = v;
  }
  return out;
}

async function lhttp(
  env: Env,
  method: string,
  urlPath: string,
  init?: { body?: string; extraHeaders?: Record<string, string>; useVersion?: boolean },
): Promise<HttpResult> {
  const url = urlPath.startsWith("http") ? urlPath : `https://api.linkedin.com${urlPath}`;
  const useVersion = init?.useVersion ?? true;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    ...(useVersion ? { "LinkedIn-Version": env.apiVersion } : {}),
    ...init?.extraHeaders,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: init?.body,
  });
  const bodyText = await res.text();
  const truncated = bodyText.length > 4096 ? bodyText.slice(0, 4096) + `…[truncated ${bodyText.length - 4096}]` : bodyText;
  return {
    status: res.status,
    ok: res.ok,
    headers: pickHeaders(res.headers),
    bodyText: truncated,
    bodyJson: safeParseJson(bodyText),
  };
}

// --- Logging + synthèse ------------------------------------------------------

interface RunReport {
  startedAt: string;
  mode: "dry" | "live";
  apiVersion: string;
  authorUrn: string | null;
  createdUrns: string[];
  tests: {
    text?: TestResult;
    chars?: CharResult[];
    image?: TestResult;
    pdf?: TestResult;
    comment?: TestResult;
  };
  cleanup?: { attempted: number; deleted: number; failures: Array<{ urn: string; status: number; body: string }> };
}

interface TestResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  message: string;
  urn?: string;
  raw?: unknown;
}

interface CharResult {
  char: string;
  unescaped: { status: number; ok: boolean; message: string; urn?: string };
  escaped: { status: number; ok: boolean; message: string; urn?: string };
}

const report: RunReport = {
  startedAt: new Date().toISOString(),
  mode: "dry",
  apiVersion: "",
  authorUrn: null,
  createdUrns: [],
  tests: {},
};

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function section(title: string): void {
  log("\n" + "=".repeat(78));
  log(title);
  log("=".repeat(78));
}

function logHttp(label: string, method: string, urlPath: string, res: HttpResult): void {
  log(`\n[${label}] ${method} ${urlPath}`);
  log(`  status: ${res.status} ${res.ok ? "OK" : "FAIL"}`);
  if (Object.keys(res.headers).length) log(`  headers: ${JSON.stringify(res.headers)}`);
  const body = res.bodyText.length > 400 ? res.bodyText.slice(0, 400) + "…" : res.bodyText;
  log(`  body: ${body || "(empty)"}`);
}

function shortError(res: HttpResult): string {
  const b = res.bodyJson as { message?: string; serviceErrorCode?: number; code?: string } | null;
  if (b?.message) return b.message + (b.serviceErrorCode ? ` [sec=${b.serviceErrorCode}]` : "");
  return res.bodyText.slice(0, 200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Payloads ---------------------------------------------------------------

function buildTextPayload(authorUrn: string, commentary: string): Record<string, unknown> {
  return {
    author: authorUrn,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

function buildImagePayload(
  authorUrn: string,
  commentary: string,
  imageUrn: string,
  altText: string,
): Record<string, unknown> {
  return {
    ...buildTextPayload(authorUrn, commentary),
    content: { media: { id: imageUrn, altText } },
  };
}

function buildDocumentPayload(
  authorUrn: string,
  commentary: string,
  documentUrn: string,
  title: string,
): Record<string, unknown> {
  return {
    ...buildTextPayload(authorUrn, commentary),
    content: { media: { id: documentUrn, title } },
  };
}

// Wrap Uint8Array dans un Blob compatible avec le fetch typé DOM.
// (Node accepte Uint8Array direct au runtime, mais TS DOM refuse le mix Node/DOM.)
function toBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

// PNG 4x4 rouge, valide, ~70 octets.
function tinyPng(): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR4nGP8z8DwnwEHYMIlMKphmAAAeF8DBQfjqAsAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

// PDF minimal 1 page (~350 octets).
function tinyPdf(): Uint8Array {
  const src = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R>>endobj",
    "4 0 obj<</Length 44>>stream",
    "BT /F1 24 Tf 50 150 Td (Posty spike) Tj ET",
    "endstream endobj",
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "0000000010 00000 n ",
    "0000000053 00000 n ",
    "0000000100 00000 n ",
    "0000000180 00000 n ",
    "trailer<</Size 5/Root 1 0 R>>",
    "startxref",
    "260",
    "%%EOF",
    "",
  ].join("\n");
  return new Uint8Array(Buffer.from(src, "utf8"));
}

// --- Tests ------------------------------------------------------------------

async function resolveAuthorUrn(env: Env, dry: boolean): Promise<string> {
  if (env.authorUrn) {
    log(`\nauthor URN (fourni par env) : ${env.authorUrn}`);
    return env.authorUrn;
  }
  if (dry) {
    log("\n[dry] URN fictif utilisé : urn:li:person:DRY_RUN_ID");
    return "urn:li:person:DRY_RUN_ID";
  }
  log("\nGET /v2/userinfo (résolution de l'URN auteur)");
  const res = await lhttp(env, "GET", "/v2/userinfo", { useVersion: false });
  logHttp("userinfo", "GET", "/v2/userinfo", res);
  if (!res.ok) throw new Error(`Impossible de résoudre l'URN : ${res.status} ${shortError(res)}`);
  const b = res.bodyJson as { sub?: string } | null;
  if (!b?.sub) throw new Error("userinfo : champ 'sub' absent.");
  const urn = `urn:li:person:${b.sub}`;
  log(`  → ${urn}`);
  return urn;
}

async function publishText(env: Env, authorUrn: string, commentary: string, dry: boolean): Promise<TestResult> {
  const payload = buildTextPayload(authorUrn, commentary);
  const body = JSON.stringify(payload);
  if (dry) {
    log("\n[dry] POST /rest/posts");
    log("  body: " + body.slice(0, 300) + (body.length > 300 ? "…" : ""));
    return { attempted: false, ok: true, message: "dry-run" };
  }
  const res = await lhttp(env, "POST", "/rest/posts", {
    body,
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("publishText", "POST", "/rest/posts", res);
  const urn = res.headers["x-restli-id"];
  if (res.ok && urn) report.createdUrns.push(urn);
  return {
    attempted: true,
    ok: res.ok,
    status: res.status,
    message: res.ok ? "ok" : shortError(res),
    urn,
    raw: res.bodyJson,
  };
}

async function testText(env: Env, authorUrn: string, dry: boolean): Promise<void> {
  section("TEST 1 — publication texte");
  const commentary = `Posty spike — smoke test.\n\nSi tu vois ce post, ce script marche. (à supprimer)\n\n#posty #spike #test`;
  const r = await publishText(env, authorUrn, commentary, dry);
  report.tests.text = r;
  log(r.ok ? "→ RÉSULTAT : OK" : `→ RÉSULTAT : FAIL — ${r.message}`);
}

async function testChars(env: Env, authorUrn: string, chars: string[], delay: number, dry: boolean): Promise<void> {
  section(`TEST 2 — caractérisation de l'échappement (${chars.length} caractères)`);
  const results: CharResult[] = [];
  for (const c of chars) {
    log(`\n--- caractère : ${JSON.stringify(c)} ---`);
    const unescCommentary = `Posty spike — test unescaped "${c}"`;
    const escCommentary = `Posty spike — test escaped "\\${c}"`;

    const u = await publishText(env, authorUrn, unescCommentary, dry);
    await sleep(delay);
    const e = await publishText(env, authorUrn, escCommentary, dry);
    await sleep(delay);

    results.push({
      char: c,
      unescaped: {
        status: u.status ?? 0,
        ok: u.ok,
        message: u.message,
        urn: u.urn,
      },
      escaped: {
        status: e.status ?? 0,
        ok: e.ok,
        message: e.message,
        urn: e.urn,
      },
    });

    log(
      `  → unescaped: ${u.ok ? "OK" : `FAIL ${u.status ?? ""}`} | escaped: ${e.ok ? "OK" : `FAIL ${e.status ?? ""}`}`,
    );
  }
  report.tests.chars = results;

  // Petit récap synthétique en fin de test
  log("\n--- SYNTHÈSE échappement ---");
  log(padCell("char", 6) + padCell("unescaped", 14) + padCell("escaped", 14) + "requiresEscape?");
  for (const r of results) {
    const req = !r.unescaped.ok && r.escaped.ok ? "OUI" : r.unescaped.ok ? "non" : "inclassable";
    log(
      padCell(JSON.stringify(r.char), 6) +
        padCell(`${r.unescaped.status} ${r.unescaped.ok ? "OK" : "FAIL"}`, 14) +
        padCell(`${r.escaped.status} ${r.escaped.ok ? "OK" : "FAIL"}`, 14) +
        req,
    );
  }
}

function padCell(s: string, w: number): string {
  return (s + " ".repeat(w)).slice(0, w);
}

async function testImage(env: Env, authorUrn: string, dry: boolean): Promise<void> {
  section("TEST 3 — publication avec image");
  const initPayload = { initializeUploadRequest: { owner: authorUrn } };
  const initBody = JSON.stringify(initPayload);

  if (dry) {
    log("\n[dry] POST /rest/images?action=initializeUpload");
    log("  body: " + initBody);
    log("[dry] PUT <uploadUrl> (binaire PNG)");
    log("[dry] POST /rest/posts (avec content.media.id)");
    report.tests.image = { attempted: false, ok: true, message: "dry-run" };
    return;
  }

  const init = await lhttp(env, "POST", "/rest/images?action=initializeUpload", {
    body: initBody,
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("images.initializeUpload", "POST", "/rest/images?action=initializeUpload", init);
  if (!init.ok) {
    report.tests.image = { attempted: true, ok: false, status: init.status, message: shortError(init), raw: init.bodyJson };
    return;
  }
  const body = init.bodyJson as { value?: { uploadUrl?: string; image?: string } } | null;
  const uploadUrl = body?.value?.uploadUrl;
  const imageUrn = body?.value?.image;
  if (!uploadUrl || !imageUrn) {
    report.tests.image = { attempted: true, ok: false, status: init.status, message: "réponse incomplète (uploadUrl ou image absent)", raw: body };
    return;
  }
  log(`  imageUrn: ${imageUrn}`);

  const png = tinyPng();
  const put = await fetch(uploadUrl, { method: "PUT", body: toBlob(png) });
  const putBody = await put.text();
  log(`\n[images.uploadPut] PUT ${uploadUrl.split("?")[0]}?…`);
  log(`  status: ${put.status} ${put.ok ? "OK" : "FAIL"}`);
  log(`  body: ${putBody.slice(0, 200) || "(empty)"}`);
  if (!put.ok) {
    report.tests.image = { attempted: true, ok: false, status: put.status, message: `upload PUT échoué: ${putBody.slice(0, 200)}` };
    return;
  }

  const postRes = await lhttp(env, "POST", "/rest/posts", {
    body: JSON.stringify(
      buildImagePayload(authorUrn, "Posty spike — image (à supprimer)", imageUrn, "PNG 4×4 rouge — test spike"),
    ),
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("posts.withImage", "POST", "/rest/posts", postRes);
  const urn = postRes.headers["x-restli-id"];
  if (postRes.ok && urn) report.createdUrns.push(urn);
  report.tests.image = {
    attempted: true,
    ok: postRes.ok,
    status: postRes.status,
    message: postRes.ok ? "ok" : shortError(postRes),
    urn,
    raw: postRes.bodyJson,
  };
  log(postRes.ok ? "→ RÉSULTAT : OK" : `→ RÉSULTAT : FAIL — ${shortError(postRes)}`);
}

async function testPdf(env: Env, authorUrn: string, dry: boolean): Promise<void> {
  section("TEST 4 — publication avec PDF (Documents API, INCERTAIN)");
  const initPayload = { initializeUploadRequest: { owner: authorUrn } };
  const initBody = JSON.stringify(initPayload);

  if (dry) {
    log("\n[dry] POST /rest/documents?action=initializeUpload");
    log("  body: " + initBody);
    log("[dry] PUT <uploadUrl> (binaire PDF)");
    log("[dry] POST /rest/posts (avec content.media.id + title)");
    report.tests.pdf = { attempted: false, ok: true, message: "dry-run" };
    return;
  }

  const init = await lhttp(env, "POST", "/rest/documents?action=initializeUpload", {
    body: initBody,
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("documents.initializeUpload", "POST", "/rest/documents?action=initializeUpload", init);
  if (!init.ok) {
    report.tests.pdf = {
      attempted: true,
      ok: false,
      status: init.status,
      message: `initializeUpload échoué : ${shortError(init)} — probablement scope w_member_social insuffisant pour Documents API.`,
      raw: init.bodyJson,
    };
    return;
  }

  const body = init.bodyJson as { value?: { uploadUrl?: string; document?: string } } | null;
  const uploadUrl = body?.value?.uploadUrl;
  const documentUrn = body?.value?.document;
  if (!uploadUrl || !documentUrn) {
    report.tests.pdf = { attempted: true, ok: false, status: init.status, message: "réponse incomplète (uploadUrl ou document absent)", raw: body };
    return;
  }

  const pdf = tinyPdf();
  const put = await fetch(uploadUrl, { method: "PUT", body: toBlob(pdf) });
  const putBody = await put.text();
  log(`\n[documents.uploadPut] PUT ${uploadUrl.split("?")[0]}?…`);
  log(`  status: ${put.status} ${put.ok ? "OK" : "FAIL"}`);
  log(`  body: ${putBody.slice(0, 200) || "(empty)"}`);
  if (!put.ok) {
    report.tests.pdf = { attempted: true, ok: false, status: put.status, message: `upload PUT échoué: ${putBody.slice(0, 200)}` };
    return;
  }

  const postRes = await lhttp(env, "POST", "/rest/posts", {
    body: JSON.stringify(
      buildDocumentPayload(authorUrn, "Posty spike — PDF (à supprimer)", documentUrn, "Posty spike — carrousel test"),
    ),
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("posts.withDocument", "POST", "/rest/posts", postRes);
  const urn = postRes.headers["x-restli-id"];
  if (postRes.ok && urn) report.createdUrns.push(urn);
  report.tests.pdf = {
    attempted: true,
    ok: postRes.ok,
    status: postRes.status,
    message: postRes.ok ? "ok" : shortError(postRes),
    urn,
    raw: postRes.bodyJson,
  };
  log(postRes.ok ? "→ RÉSULTAT : OK" : `→ RÉSULTAT : FAIL — ${shortError(postRes)}`);
}

async function testComment(env: Env, authorUrn: string, dry: boolean): Promise<void> {
  section("TEST 5 — premier commentaire (INCERTAIN)");

  // On a besoin d'un URN de post existant. Priorité :
  //   1. dernier post texte publié par ce spike ;
  //   2. sinon on en publie un exprès.
  let targetUrn: string | undefined = report.tests.text?.urn ?? report.createdUrns.at(-1);

  if (!targetUrn && !dry) {
    log("\nAucun URN de post disponible — publication d'un post support pour le commentaire.");
    const support = await publishText(
      env,
      authorUrn,
      "Posty spike — support pour test de commentaire (à supprimer)",
      false,
    );
    if (!support.ok || !support.urn) {
      report.tests.comment = {
        attempted: true,
        ok: false,
        status: support.status,
        message: `impossible de créer le post support : ${support.message}`,
      };
      return;
    }
    targetUrn = support.urn;
  }

  if (dry) {
    log("\n[dry] POST /rest/socialActions/{postUrn}/comments");
    log("  body: " + JSON.stringify({ actor: authorUrn, object: "urn:li:share:DRY", message: { text: "test" } }));
    report.tests.comment = { attempted: false, ok: true, message: "dry-run" };
    return;
  }

  const commentPayload = {
    actor: authorUrn,
    object: targetUrn,
    message: { text: "Posty spike — premier commentaire test (à supprimer)." },
  };
  const encoded = encodeURIComponent(targetUrn ?? "");
  const url = `/rest/socialActions/${encoded}/comments`;
  const res = await lhttp(env, "POST", url, {
    body: JSON.stringify(commentPayload),
    extraHeaders: { "Content-Type": "application/json" },
  });
  logHttp("firstComment", "POST", url, res);
  report.tests.comment = {
    attempted: true,
    ok: res.ok,
    status: res.status,
    message: res.ok ? "ok" : shortError(res),
    urn: res.headers["x-restli-id"],
    raw: res.bodyJson,
  };
  log(res.ok ? "→ RÉSULTAT : OK" : `→ RÉSULTAT : FAIL — ${shortError(res)}`);
}

// --- Cleanup -----------------------------------------------------------------

async function cleanup(env: Env, dry: boolean): Promise<void> {
  section(`CLEANUP — ${report.createdUrns.length} post(s) à supprimer`);
  const failures: Array<{ urn: string; status: number; body: string }> = [];
  let deleted = 0;
  for (const urn of report.createdUrns) {
    const encoded = encodeURIComponent(urn);
    const url = `/rest/posts/${encoded}`;
    if (dry) {
      log(`[dry] DELETE ${url}`);
      continue;
    }
    const res = await lhttp(env, "DELETE", url);
    if (res.ok || res.status === 204) {
      deleted++;
      log(`✓ DELETE ${urn} → ${res.status}`);
    } else {
      failures.push({ urn, status: res.status, body: res.bodyText.slice(0, 200) });
      log(`✗ DELETE ${urn} → ${res.status} ${shortError(res)}`);
    }
    await sleep(200);
  }
  report.cleanup = { attempted: report.createdUrns.length, deleted, failures };
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseCli();
  const env = loadEnv();

  report.mode = cli.live ? "live" : "dry";
  report.apiVersion = env.apiVersion;
  const dry = !cli.live;

  section(`SPIKE LINKEDIN — mode ${cli.live ? "LIVE" : "DRY"} — api ${env.apiVersion}`);
  log(`tests demandés : ${cli.only.join(", ")}`);
  if (cli.only.includes("chars")) log(`caractères testés : ${cli.chars.map((c) => JSON.stringify(c)).join(" ")}`);
  if (cli.cleanup) log("cleanup activé : les URN créés seront DELETE en fin de run.");
  if (dry) log("⚠️  --dry actif : aucun appel HTTP réel ne sera émis.");
  else log("🔴  --live actif : ce script publiera de vrais posts sur ton profil.");

  const authorUrn = await resolveAuthorUrn(env, dry);
  report.authorUrn = authorUrn;

  try {
    if (cli.only.includes("text")) await testText(env, authorUrn, dry);
    if (cli.only.includes("chars")) await testChars(env, authorUrn, cli.chars, cli.charBatchDelayMs, dry);
    if (cli.only.includes("image")) await testImage(env, authorUrn, dry);
    if (cli.only.includes("pdf")) await testPdf(env, authorUrn, dry);
    if (cli.only.includes("comment")) await testComment(env, authorUrn, dry);
  } finally {
    if (cli.cleanup) await cleanup(env, dry);
    const outPath = path.resolve("docs/spike-linkedin.json");
    await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
    log(`\nSynthèse écrite : ${outPath}`);
    if (report.createdUrns.length && !cli.cleanup) {
      log("\n⚠️  Posts créés et NON supprimés (ré-exécute avec --cleanup ou supprime-les à la main) :");
      for (const u of report.createdUrns) log(`  - ${u}`);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
