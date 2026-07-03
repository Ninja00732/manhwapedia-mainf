import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "moderator" | "user";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
  roles: Role[];
  isMod: boolean;
  isAdmin: boolean;
  profile: { username: string; display_name: string | null; avatar_url: string | null } | null;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [profile, setProfile] = useState<AuthCtx["profile"]>(null);

  const loadForUser = async (uid: string | null) => {
    if (!uid) {
      setRoles([]);
      setProfile(null);
      return;
    }
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("username, display_name, avatar_url").eq("id", uid).maybeSingle(),
    ]);
    setRoles((r ?? []).map((row) => row.role as Role));
    setProfile(p ?? null);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Defer async
      setTimeout(() => loadForUser(s?.user?.id ?? null), 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadForUser(data.session?.user?.id ?? null).finally(() => setLoading(false));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    loading,
    roles,
    isMod: roles.includes("admin") || roles.includes("moderator"),
    isAdmin: roles.includes("admin"),
    profile,
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refreshRoles: async () => loadForUser(session?.user?.id ?? null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
