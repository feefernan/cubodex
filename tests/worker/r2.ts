/** Balde R2 em memória, com a forma que o Worker usa (head/get/put/delete). */
import type { Bucket } from '../../worker/src/bucket';

export const memoryBucket = () => {
  const objects = new Map<string, { body: ArrayBuffer; type: string }>();
  const bucket: Bucket = {
    head: async (key) => (objects.has(key) ? { key } : null),
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: new Response(o.body).body, httpMetadata: { contentType: o.type } } : null;
    },
    put: async (key, value, options) => {
      objects.set(key, { body: value, type: options.httpMetadata.contentType });
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
  return { bucket, objects };
};
