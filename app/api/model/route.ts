import { buildModelPayload } from "../../../lib/data/model";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
    return Response.json(
      { error: "Enter a valid U.S. public-equity ticker." },
      { status: 400 },
    );
  }
  try {
    const payload = await buildModelPayload(ticker);
    return Response.json(payload, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=1800" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The data source returned an unknown error.";
    const unsupported = message.startsWith("Unsupported");
    return Response.json(
      {
        error: message,
        refusal: unsupported ? "No consolidated FCFF share price was produced. A tailored model is required for this issuer."
          : "No valuation was produced because required financial statements could not be retrieved with sufficient coverage.",
      },
      { status: unsupported ? 422 : 502 },
    );
  }
}
