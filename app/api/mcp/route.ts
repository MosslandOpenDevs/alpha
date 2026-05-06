import { processMcpRequest } from "@/lib/mcp-server";

export const dynamic = "force-dynamic";

/**
 * MCP (Model Context Protocol) endpoint — Streamable HTTP transport.
 * https://modelcontextprotocol.io/specification
 *
 * Accept JSON-RPC 2.0 single message or batch.
 * Response: JSON (no SSE for now — read-only tools).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  // Batch support
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((m) => processMcpRequest(m))
    );
    const filtered = responses.filter((r) => r !== null);
    return Response.json(filtered, {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
      },
    });
  }

  const response = await processMcpRequest(
    body as Parameters<typeof processMcpRequest>[0]
  );
  if (response === null) {
    return new Response(null, {
      status: 202,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
  return Response.json(response, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** GET — sanity check + tool 목록 (개발 편의) */
export async function GET() {
  return Response.json({
    service: "Alpha MCP Server",
    transport: "Streamable HTTP",
    protocol_version: "2025-06-18",
    docs: "https://alpha.moss.land/mcp",
    note: "POST JSON-RPC 2.0 messages here. Use 'initialize' first, then 'tools/list', 'tools/call'.",
  });
}
