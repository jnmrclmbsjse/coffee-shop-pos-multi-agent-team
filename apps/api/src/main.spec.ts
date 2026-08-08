import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));
jest.mock('helmet', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('./app.module', () => ({
  AppModule: class AppModule {},
}));

describe('API bootstrap', () => {
  it('trusts the first proxy and installs Helmet', async () => {
    const helmetMiddleware = jest.fn();
    const app = {
      enableCors: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      use: jest.fn(),
      useGlobalPipes: jest.fn(),
    };

    jest.mocked(NestFactory.create).mockResolvedValue(app as never);
    jest.mocked(helmet).mockReturnValue(helmetMiddleware);

    await import('./main');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(app.set).toHaveBeenCalledWith('trust proxy', 1);
    expect(app.use).toHaveBeenCalledWith(helmetMiddleware);
    expect(app.listen).toHaveBeenCalledWith(3000);
  });
});
