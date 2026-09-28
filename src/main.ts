import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use((req: any, _res: any, next: () => void) => {
    const override = req.headers['x-http-method-override'];
    if (req.method === 'POST' && typeof override === 'string') {
      const method = override.toUpperCase();
      if (method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        req.method = method;
      }
    }
    next();
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
