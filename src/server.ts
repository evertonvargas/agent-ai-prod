import { Glean } from "@gleanwork/api-client";
import fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import { z } from 'zod';

const app = fastify();

app.register(fastifyCors, {
  origin: '*',
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

const glean = new Glean({
  instance: process.env.GLEAN_INSTANCE!,
  apiToken: process.env.GLEAN_API_TOKEN!,
});

const createBodySchema = z.object({
  ticket: z.object({
    ticketId: z.any(),
    subject: z.string(),
    description: z.string(),
  }),
});

const sendSlackNotification = async (text: string) => {
  console.log("sendSlackNotification")
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('Erro ao enviar notificação ao Slack:', err);
  }
};

type Ticket = z.infer<typeof createBodySchema>['ticket'];

const agentProcess = async ({
  ticketId,
  subject,
  description,
}: Ticket) => {

  console.log("start process");

  try {
    const response = await glean.client.agents.run({
      agentId: process.env.AGENT_ID!,
      input: { subject, description },
    });

    const lastMessage = response.messages.at(-1)?.content?.[0]?.text;

    if (!lastMessage) throw new Error('Resposta do agente inválida');

    const ticketData = JSON.parse(lastMessage);

    const zendeskUrl = process.env.ZENDESK_URL;
    const relatedTickets = ticketData?.relatedTickets?.filter((ticket: string) => ticket !== ticketId);

    if (relatedTickets?.length > process.env.QTD_TICKETS) {
      await sendSlackNotification(`:rotating_light: Similar tickets found (last hour):rotating_light:
ticketId: ${zendeskUrl}${ticketId}
ticketTitle: ${ticketData.ticketTitle}
issueDescription: ${ticketData.issueDescription}
related tickets: ${relatedTickets.map((ticket: string) => `${zendeskUrl}${ticket}`).join(', ')}`);
    }

    return 'Agent processing started successfully'
  } catch (error) {
    console.error('Erro ao processar agente:', error);
    return error
  }
};

app.get('/', async (request, reply) => {
  return reply.status(200).send({ message: 'Hello World!' });
});

app.post('/agent', async (request, reply) => {
  const parsed = createBodySchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.format() });
  }

  try {
    const { ticket } = parsed.data;

    const data = await agentProcess(ticket);

    return reply.status(200).send({ message: data });
  } catch (error) {
    console.error('Erro ao processar agente:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

export default async function handler(req, reply) {
  await app.ready()
  app.server.emit('request', req, reply)
}

// app.listen({ host: '0.0.0.0', port: 3000 }).then(() => {
//   console.log('🚀 HTTP Server running on port 3000');
// });
