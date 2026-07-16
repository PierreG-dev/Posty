import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return <LoginPageInner searchParams={searchParams} />;
}

async function LoginPageInner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm p-8 rounded-lg border border-border bg-surface">
        <h1 className="text-xl font-semibold">Posty</h1>
        <p className="mt-1 text-sm text-fg-muted">Connexion.</p>
        <LoginForm error={error} />
      </div>
    </div>
  );
}
