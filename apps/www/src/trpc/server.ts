import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { loggerLink } from "@trpc/client";
import { experimental_nextCacheLink as nextCacheLink } from "@trpc/next/app-dir/links/nextCache";
import { experimental_createTRPCNextAppDirServer as createTRPCNextAppDirServer } from "@trpc/next/app-dir/server";
import superjson from "superjson";

import { appRouter } from "@eboto/api";
import type { AppRouter } from "@eboto/api";
import { inngest } from "@eboto/inngest";
import * as payment from "@eboto/payment";

import type { Database } from "../../../../supabase/types";
import { endingLink } from "./shared";

export const api = createTRPCNextAppDirServer<AppRouter>({
  config() {
    return {
      transformer: superjson,
      links: [
        loggerLink({
          enabled: () => true,
        }),
        endingLink({
          headers: Object.fromEntries(headers().entries()),
        }),
        nextCacheLink({
          revalidate: false,
          router: appRouter,
          async createContext() {
            const supabase = createClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();

            let user_db: Database["public"]["Tables"]["users"]["Row"] | null =
              null;

            if (user) {
              const { data } = await supabase
                .from("users")
                .select()
                .eq("id", user.id)
                .single();

              user_db = data;
            }
            return {
              user:
                user && user_db
                  ? {
                      db: user_db,
                      auth: user,
                    }
                  : null,
              supabase,
              headers: {
                cookie: cookies().toString(),
                "x-trpc-source": "rsc-invoke",
              },
              payment,
              inngest,
            };
          },
        }),
      ],
    };
  },
});
