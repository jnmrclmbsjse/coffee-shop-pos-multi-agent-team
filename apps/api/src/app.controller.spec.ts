import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  it('reports that the API is healthy', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    expect(moduleRef.get(AppController).health()).toEqual({ status: 'ok' });
  });
});
