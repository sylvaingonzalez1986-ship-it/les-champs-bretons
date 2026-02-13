declare module 'https://deno.land/std@0.208.0/http/server.ts' {
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.38.0' {
  export type User = {
    id: string;
    email?: string | null;
  };

  export type SupabaseClient = any;

  export function createClient(url: string, key: string, options?: unknown): SupabaseClient;
}

declare module 'https://deno.land/x/zod@v3.22.4/mod.ts' {
  export namespace z {
    type infer<T> = any;
    interface ZodSchema<T = any> {
      safeParse(value: unknown): { success: true; data: T } | { success: false; error: { errors: { path: (string | number)[]; message: string }[] } };
    }
  }
  export const z: any;
}

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
