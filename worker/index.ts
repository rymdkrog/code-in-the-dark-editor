// The Audience layer's Worker. Nothing is served yet: the Durable Object, the protocol
// and the Host, Stage and Audience pages arrive in later tickets.
export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
