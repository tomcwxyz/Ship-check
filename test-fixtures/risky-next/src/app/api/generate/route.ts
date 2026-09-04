import OpenAI from "openai";

const client = new OpenAI();

export async function POST(request: Request) {
  const body = await request.json();
  const response = await client.chat.completions.create({ model: "example", messages: body.messages });
  return Response.json(response);
}
