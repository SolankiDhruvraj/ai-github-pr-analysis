import 'dotenv/config';
import http from 'http';
import bodyParser from 'body-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { createApp } from './app.js';
import worker from './queue/reviewQueue.js'; // starts the BullMQ background worker
import { typeDefs, resolvers } from './graphql/schema.js';

const PORT = process.env.PORT || 4000;

async function start() {
  const app = createApp();
  const httpServer = http.createServer(app);

  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers
  });

  await apolloServer.start();

  app.use(
    '/graphql',
    bodyParser.json(),
    expressMiddleware(apolloServer, {
      context: async () => ({})
    })
  );

  httpServer.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`GraphQL endpoint ready at http://localhost:${PORT}/graphql`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
