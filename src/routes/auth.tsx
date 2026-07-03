import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — ManhwaPedia" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? (typeof window !== "undefined" ? (window as any).__GOOGLE_CLIENT_ID__ : undefined);
  const hasGoogle = Boolean(googleClientId);

  const signInGoogle = async () => {
    setBusy(true);
    try {
      toast.error("O login com Google não está configurado neste ambiente. Use e-mail e senha para continuar.");
    } catch (err: any) {
      toast.error(err.message ?? "Erro no login com Google");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: username || undefined },
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Você já está logado.");
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo de volta!");
        navigate({ to: "/" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="font-display text-2xl font-bold mb-1">
          {mode === "signin" ? "Entrar" : "Criar conta"}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Você precisa estar logado para editar ou criar páginas.
        </p>

        {hasGoogle && (
          <>
            <button
              onClick={signInGoogle}
              disabled={busy}
              className="w-full h-10 rounded-md border border-border bg-surface hover:border-primary text-sm font-medium mb-4 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#EA4335" d="M5.3 14.5A7 7 0 0 1 5 12c0-.9.1-1.7.4-2.5V6.3H1.6A11 11 0 0 0 0 12c0 1.8.4 3.5 1.2 5l4.1-2.5z"/><path fill="#4285F4" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.6 6.3l4.1 3.2C6.7 6.9 9.1 4.8 12 4.8z" transform="translate(0 0)"/><path fill="#34A853" d="M12 19.2c-2.9 0-5.4-2-6.3-4.7L1.6 17.7C3.4 21.4 7.4 24 12 24c3.1 0 5.9-1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.1-4 1.1z"/><path fill="#FBBC05" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6l3.9 3c2.3-2.1 3.5-5.2 3.5-8.8z"/></svg>
              Continuar com Google
            </button>

            <div className="relative my-4">
              <div className="border-t border-border" />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-card px-2 text-xs text-muted-foreground">ou</span>
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="text-xs text-muted-foreground">Nome de usuário</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_-]+" className="mt-1 w-full h-10 px-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 w-full h-10 px-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="mt-1 w-full h-10 px-3 rounded-md bg-surface border border-border focus:border-primary focus:outline-none text-sm" />
          </div>
          <button disabled={busy} className="w-full h-10 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-4">
          {mode === "signin" ? (
            <>Não tem conta? <button onClick={() => setMode("signup")} className="text-primary hover:underline">Criar</button></>
          ) : (
            <>Já tem conta? <button onClick={() => setMode("signin")} className="text-primary hover:underline">Entrar</button></>
          )}
        </p>
        <p className="text-center text-xs text-muted-foreground mt-3">
          <Link to="/" className="hover:underline">Voltar para a home</Link>
        </p>
      </div>
    </div>
  );
}
