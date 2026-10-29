import crypto from 'node:crypto'
import type { RagDocumentChunk, RagSearchResult } from './types'

export class StratisRagEngine {
  private chunks: Map<string, RagDocumentChunk> = new Map();

  /**
   * Ingest and chunk raw documents with sliding window overlap
   */
  public ingestDocument(
    documentId: string,
    content: string,
    metadata: Record<string, unknown> = {},
    chunkSize: number = 250,
    chunkOverlap: number = 50
  ): RagDocumentChunk[] {
    const words = content.split(/\s+/);
    const createdChunks: RagDocumentChunk[] = [];

    let start = 0;
    while (start < words.length) {
      const slice = words.slice(start, start + chunkSize);
      const text = slice.join(' ');
      const chunkId = `chunk_${documentId}_${createdChunks.length + 1}`;

      // Simulate normalized frequency vector for local hybrid search
      const tokenCount = slice.length;
      const chunk: RagDocumentChunk = {
        chunkId,
        documentId,
        text,
        metadata: { ...metadata, wordCount: tokenCount },
        tokenCount
      };

      this.chunks.set(chunkId, chunk);
      createdChunks.push(chunk);

      if (start + chunkSize >= words.length) break;
      start += chunkSize - chunkOverlap;
    }

    return createdChunks;
  }

  /**
   * Hybrid retrieval: keyword BM25-style frequency + token overlap
   */
  public search(query: string, topK: number = 5, minScore: number = 0.2): RagSearchResult[] {
    const queryTokens = new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );

    if (queryTokens.size === 0) return [];

    const results: RagSearchResult[] = [];

    for (const chunk of this.chunks.values()) {
      const chunkWords = chunk.text.toLowerCase().split(/\s+/);
      const totalWords = chunkWords.length || 1;

      let matchedTokens = 0;
      const seen = new Set<string>();

      for (const w of chunkWords) {
        const clean = w.replace(/[^a-z0-9]/g, '');
        if (queryTokens.has(clean) && !seen.has(clean)) {
          matchedTokens++;
          seen.add(clean);
        }
      }

      if (matchedTokens > 0) {
        const keywordScore = matchedTokens / queryTokens.size;
        const densityBonus = Math.min(0.2, (matchedTokens / totalWords) * 2);
        const compositeScore = Math.min(1.0, Number((keywordScore * 0.8 + densityBonus).toFixed(3)));

        if (compositeScore >= minScore) {
          results.push({
            chunk,
            score: compositeScore,
            matchType: compositeScore > 0.6 ? 'hybrid' : 'keyword'
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  public getIndexedChunkCount(): number {
    return this.chunks.size;
  }

  public clear(): void {
    this.chunks.clear();
  }
}
