import { env } from "@/modules/shared/env";

// Fait un fetch brut sur GET /rest/companies/{id} pour chaque id passé en
// argument et imprime :
//   - status HTTP
//   - clés de premier niveau du JSON
//   - le body (tronqué à 1500 caractères)
//
// Permet de confirmer le shape réel renvoyé par Twenty en single-fetch et
// de le comparer avec le shape attendu par `coerceCompany` (data.company).
//
// Usage : npx tsx --env-file=.env scripts/probe-twenty-single.ts <id1> [<id2>...]

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage : npx tsx --env-file=.env scripts/probe-twenty-single.ts <id1> [<id2>...]");
    process.exit(1);
  }

  const e = env();
  if (!e.TWENTY_API_URL || !e.TWENTY_API_KEY) {
    console.error("TWENTY_API_URL ou TWENTY_API_KEY manquant dans .env");
    process.exit(1);
  }

  const baseUrl = e.TWENTY_API_URL.replace(/\/+$/, "");

  for (const id of ids) {
    const url = `${baseUrl}/rest/companies/${encodeURIComponent(id)}`;
    console.log(`\n=== ${id} ===`);
    console.log(`GET ${url}`);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${e.TWENTY_API_KEY}`,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      console.log(`status : ${res.status}`);

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.log("(body non-JSON)");
      }

      if (parsed && typeof parsed === "object") {
        const top = Object.keys(parsed as Record<string, unknown>);
        console.log(`top-level keys : ${JSON.stringify(top)}`);
        const data = (parsed as { data?: unknown }).data;
        if (data && typeof data === "object") {
          const dataKeys = Object.keys(data as Record<string, unknown>);
          console.log(`data.* keys    : ${JSON.stringify(dataKeys)}`);
        }
      }

      console.log("body (tronqué à 1500 char) :");
      console.log(text.length > 1500 ? text.slice(0, 1500) + "…" : text);
    } catch (err) {
      console.log(`throw : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
