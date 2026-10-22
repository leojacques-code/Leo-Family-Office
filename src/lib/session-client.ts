import "server-only";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAuthConfiguration } from "@/lib/auth-config";

export function createSessionClient(adapter: CookieMethodsServer) {
  const { url, key } = supabaseAuthConfiguration();
  return createServerClient(url, key, {
    cookies: adapter,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  });
}

export async function serverSessionClient() {
  const store = await cookies();
  return createSessionClient({
    getAll: () => store.getAll(),
    setAll: (values) => {
      try {
        for (const { name, value, options } of values) store.set(name, value, options);
      } catch {
        /* Le proxy renouvelle les cookies avant le rendu des Server Components. */
      }
    },
  });
}
