import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const HARVESTR_BASE = "https://rest.harvestr.io/v1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Requested-With, x-harvestr-token",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const pathPrefix = "/PFtool";
    let apiPath = url.pathname;
    if (apiPath.startsWith(pathPrefix)) {
      apiPath = apiPath.slice(pathPrefix.length);
    }
    if (!apiPath.startsWith("/")) {
      apiPath = "/" + apiPath;
    }
    const targetUrl = `${HARVESTR_BASE}${apiPath}${url.search}`;

    const harvestrToken = req.headers.get("x-harvestr-token");
    if (!harvestrToken) {
      return new Response(
        JSON.stringify({ error: "Missing x-harvestr-token header" }),
        {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const headers: Record<string, string> = {
      "X-Harvestr-Private-App-Token": harvestrToken,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    let body: string | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    const response = await fetch(targetUrl, { method: req.method, headers, body });
    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
