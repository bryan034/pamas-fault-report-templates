import vinext from "vinext/server/fetch-handler";
import { handleWebRequest, type WebEnv } from "./gateway";

const worker = {
  async fetch(request: Request, env: WebEnv, ctx: ExecutionContext) {
    return handleWebRequest(request, env, async (authenticated) => {
      // run_worker_first ensures static PDFs/OCR assets cannot skip Access.
      const asset = await env.ASSETS.fetch(authenticated);
      if (asset.status !== 404) return asset;
      return vinext.fetch(authenticated, env, ctx);
    });
  },
};

export default worker;
