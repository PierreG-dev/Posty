import { hashPassword, encodeHashForEnv } from "@/modules/shared/auth/password";

async function main(): Promise<void> {
  const pwd = process.argv[2];
  if (!pwd) {
    console.error("Usage : npm run hash-password -- <motDePasse>");
    process.exit(1);
  }
  const phc = await hashPassword(pwd);
  const b64 = encodeHashForEnv(phc);
  console.log("");
  console.log("Colle cette ligne dans ton .env :");
  console.log("");
  console.log(`AUTH_PASSWORD_HASH=${b64}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
