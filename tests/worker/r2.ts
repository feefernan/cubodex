/** Balde R2 em memória, com a forma que o Worker usa (head/get/put/delete). */
import type { Bucket } from '../../worker/src/bucket';

export const memoryBucket = () => {
  const objects = new Map<string, { body: ArrayBuffer; type: string; meta?: Record<string, string> }>();
  const uploaded = new Map<string, Date>();
  const bucket: Bucket = {
    head: async (key) => (objects.has(key) ? { key } : null),
    get: async (key) => {
      const o = objects.get(key);
      return o ? { body: new Response(o.body).body, httpMetadata: { contentType: o.type } } : null;
    },
    put: async (key, value, options) => {
      objects.set(key, { body: value, type: options.httpMetadata.contentType, meta: options.customMetadata });
      uploaded.set(key, new Date());
    },
    list: async ({ prefix }) => ({
      objects: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, o]) => ({ key, uploaded: uploaded.get(key) ?? new Date(), customMetadata: o.meta })),
    }),
    delete: async (key) => {
      objects.delete(key);
    },
  };
  return { bucket, objects, uploaded };
};
