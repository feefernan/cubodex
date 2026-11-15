/** O pedaço do R2 que usamos (os testes usam um balde em memória). */
export interface Bucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string } } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  list(options: { prefix: string; limit?: number; include?: 'customMetadata'[] }): Promise<{
    objects: { key: string; uploaded: Date; customMetadata?: Record<string, string> }[];
  }>;
  delete(key: string): Promise<void>;
}
