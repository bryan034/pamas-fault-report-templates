import vinext from "vinext/server/fetch-handler";
import { handleWebRequest, type WebEnv } from "./gateway";

const worker = {
  async fetch(request: Request, env: WebEnv, ctx: ExecutionContext) {
    return handleWebRequest(request, env, async (authenticated) => {
      // The public shell/assets contain no saved documents. Python protects data.
      const asset = await env.ASSETS.fetch(authenticated);
      if (asset.status !== 404) return asset;
      return vinext.fetch(authenticated, env, ctx);
    });
  },
};

export default worker;
