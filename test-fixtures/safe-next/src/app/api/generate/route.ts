import OpenAI from "openai";

const client = new OpenAI();

async function rateLimit(_request: Request) {
  return { allowed: true };
}

export async function POST(request: Request) {
  const limit = await rateLimit(request);
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });
  const body = await request.json();
  const response = await client.chat.completions.create({ model: "example", messages: body.messages });
  return Response.json(response);
}
