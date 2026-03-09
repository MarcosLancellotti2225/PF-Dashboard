import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const HARVESTR_BASE = "https://api.harvestr.io/v1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);

    // The path after /PFtool becomes the Harvestr API path
    // e.g. /PFtool/feedback?limit=200 → /v1/feedback?limit=200
    const pathPrefix = "/PFtool";
    let apiPath = url.pathname;
    if (apiPath.startsWith(pathPrefix)) {
      apiPath = apiPath.slice(pathPrefix.length);
    }
    if (!apiPath.startsWith("/")) {
      apiPath = "/" + apiPath;
    }

    const targetUrl = `${HARVESTR_BASE}${apiPath}${url.search}`;

    // Forward the Authorization header from the client
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const headers: Record<string, string> = {
      Authorization: authHeader,
      "Content-Type": "application/json",
    };

    // Forward the request body for non-GET methods
    let body: string | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type":
          response.headers.get("Content-Type") || "application/json",
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
