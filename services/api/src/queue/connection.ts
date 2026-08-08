// Opciones planas a propósito: BullMQ arma su propia conexión con los settings
// que necesita, en vez de reusar RedisService (maxRetriesPerRequest: 3 e
// ioredis v6, incompatibles con los comandos bloqueantes de BullMQ).
export const redisConnection = () => ({
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
});
