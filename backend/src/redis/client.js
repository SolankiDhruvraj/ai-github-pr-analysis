import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// 1. General client (fails fast, used for caching/service)
const redis = new Redis(redisUrl, {
    enableOfflineQueue: false,
    connectTimeout: 5000,
    maxRetriesPerRequest: 3, // Fail after 3 attempts
    retryStrategy(times) {
        return null; // Stop retrying after first failure for the service client
    }
});

// 2. Queue client (infinite retries, used by BullMQ)
export const queueRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // REQUIRED for BullMQ
    connectTimeout: 10000,
});

redis.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
        // Suppress spamming logs if we know it's down
    } else {
        console.error('Redis Service Client error:', err.message);
    }
});

queueRedis.on('error', (err) => {
    // Silent fail-fast logs for queue client too if needed
});

redis.on('connect', () => console.log('Redis Service connected'));
queueRedis.on('connect', () => console.log('Redis Queue connected'));

export default redis;
